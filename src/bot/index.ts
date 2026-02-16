/**
 * Telegram Bot Runner (Multi-Instance, Per-User)
 *
 * Loads all active `interfaces` rows of type "telegram" and starts one Telegraf
 * bot per row. Each interface row belongs to a web user (owner_user_id), and
 * all executions run inside that tenant's sandbox root: data/userfs/web/<owner>.
 */

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "dotenv";
import { resolve } from "path";

import {
  interfacesModel,
  usersModel,
} from "../database/index";
import { initializeSchema } from "../database/db";
import { createBotLogger, getHelpMessage, isRateLimited, splitText } from "./shared";
import { recordChannelEvent } from "../lib/channel-observability";
import { streamGatewayChat } from "../gateway/sse-client";

// Load environment
config({ path: resolve(process.cwd(), ".env") });

// Initialize database
initializeSchema();

const COOLDOWN_MS = 2000;
const TELEGRAM_MAX_MESSAGE = 3900; // keep margin under Telegram 4096 limit
const STREAM_EDIT_DEBOUNCE_MS = 1100;
const STREAM_MIN_CHARS_BEFORE_EDIT = 32;

function getGatewayBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.GATEWAY_BASE_URL || process.env.BASE_URL || `http://localhost:${port}`;
}

function getFallbackOwnerUserId(): number {
  const admin = usersModel.findAll().find((u) => u.role === "admin");
  return admin?.id ?? usersModel.findAll()[0]?.id ?? 1;
}

function getActiveTelegramInterfaces(): Array<{
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}> {
  const rows = interfacesModel.findActiveByType("telegram");
  if (rows.length === 0 && process.env.TELEGRAM_BOT_TOKEN) {
    // Backwards-compat: auto-create a DB-backed interface so gateway auth works.
    const ownerId = getFallbackOwnerUserId();
    const allowed = (process.env.TELEGRAM_ALLOWED_USERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const created = interfacesModel.create({
        type: "telegram",
        name: "Telegram (env)",
        owner_user_id: ownerId,
        config: { bot_token: process.env.TELEGRAM_BOT_TOKEN },
        allowed_users: allowed,
        is_active: true,
      } as any);
      return [
        {
          id: created.id,
          owner_user_id: (created as any).owner_user_id ?? ownerId,
          name: created.name,
          config: (interfacesModel.getDecryptedConfig(created.id) || {}) as Record<string, unknown>,
          allowed_users: interfacesModel.getAllowedUsers(created.id),
        },
      ];
    } catch {
      // If creation fails, fall back to env-only (gateway will be unavailable).
      return [
        {
          id: -1,
          owner_user_id: ownerId,
          name: "Telegram (env)",
          config: { bot_token: process.env.TELEGRAM_BOT_TOKEN },
          allowed_users: allowed,
        },
      ];
    }
  }

  return rows
    .map((r) => {
      const cfg =
        (interfacesModel.getDecryptedConfig(r.id) || {}) as Record<string, unknown>;
      return {
        id: r.id,
        owner_user_id: (r as any).owner_user_id ?? 1,
        name: r.name,
        config: cfg,
        allowed_users: interfacesModel.getAllowedUsers(r.id),
      };
    })
    .filter((r) => typeof r.config.bot_token === "string" && r.config.bot_token.length > 0);
}

async function startTelegramInstance(instance: {
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}) {
  const logger = createBotLogger("telegram", instance.owner_user_id);

  const token = String(instance.config.bot_token || "");
  const gatewayToken = String((instance.config as any).gateway_token || "");
  if (!token) {
    logger.warn("No bot token; skipping instance", {
      interfaceId: instance.id,
      name: instance.name,
    });
    return;
  }

  const bot = new Telegraf(token);

  try {
    const me = await bot.telegram.getMe();
    logger.info("Telegram bot authenticated", {
      interfaceId: instance.id,
      ownerUserId: instance.owner_user_id,
      botId: me.id,
      username: me.username,
    });
  } catch (error) {
    logger.error("Telegram startup validation failed", {
      interfaceId: instance.id,
      ownerUserId: instance.owner_user_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  bot.catch((err: unknown, ctx) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    recordChannelEvent({
      channel: "telegram",
      event: "runtime_error",
      ok: false,
      details: {
        phase: "bot.catch",
        ownerUserId: String(instance.owner_user_id),
        userId: String(ctx.from?.id),
        error: errorMessage,
      },
    });
    logger.error("Bot error", {
      interfaceId: instance.id,
      error: errorMessage,
      userId: String(ctx.from?.id),
    });
  });

  bot.start(async (ctx) => {
    await ctx.reply("Hi. I am your assistant. Send a message and I will respond.");
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(getHelpMessage("Overseer"));
  });

  async function handleTelegramInput(ctx: any, input: { text?: string; attachment?: { kind: "photo" | "document"; fileId: string; fileName?: string } }) {
    const externalUserId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    if (isRateLimited(`${instance.id}:${externalUserId}`, { cooldownMs: COOLDOWN_MS })) {
      return;
    }

    const messageTextRaw = String(input.text || "").trim();
    const hasAttachment = !!input.attachment?.fileId;
    const messageText = messageTextRaw || (hasAttachment ? "Analyze the attached file." : "");
    if (!messageText && !hasAttachment) return;

    if (!gatewayToken || instance.id <= 0) {
      await ctx.reply("Gateway auth is not configured for this interface. Create/enable the interface in the admin panel.");
      return;
    }

    const gatewayBody: Record<string, unknown> = {
      message: messageText,
      externalChatId: chatId,
      externalUserId,
      externalUsername: ctx.from?.username ?? null,
      planMode: false,
      steering: undefined,
      attachments: hasAttachment && input.attachment ? [
        {
          source: "telegram",
          fileId: input.attachment.fileId,
          fileName: input.attachment.fileName ?? null,
          kind: input.attachment.kind,
          caption: messageTextRaw || null,
        },
      ] : [],
    };

    // Placeholder message we will edit while streaming.
    const placeholder = await ctx.reply("…");
    const placeholderMessageId = placeholder?.message_id;

    let buffer = "";
    let lastEditAt = 0;
    let lastSentLen = 0;
    let finalText = "";
    let receiptText: string | null = null;

    for await (const evt of streamGatewayChat({
      baseUrl: getGatewayBaseUrl(),
      interfaceId: instance.id,
      interfaceToken: gatewayToken,
      body: gatewayBody,
    })) {
      if (evt.type === "text_delta") {
        buffer += evt.text || "";
        const now = Date.now();
        const shouldEdit =
          placeholderMessageId &&
          now - lastEditAt >= STREAM_EDIT_DEBOUNCE_MS &&
          buffer.length - lastSentLen >= STREAM_MIN_CHARS_BEFORE_EDIT;
        if (!shouldEdit) continue;

        const toShow =
          buffer.length > TELEGRAM_MAX_MESSAGE
            ? buffer.slice(0, TELEGRAM_MAX_MESSAGE - 32) + "\n\n(continuing…)"
            : buffer;

        try {
          await ctx.telegram.editMessageText(chatId, placeholderMessageId, undefined, toShow);
          lastEditAt = now;
          lastSentLen = buffer.length;
        } catch {}
      } else if (evt.type === "tool_receipt") {
        receiptText = evt.text;
      } else if (evt.type === "done") {
        finalText = evt.fullText || buffer;
      } else if (evt.type === "error") {
        const msg = evt.error || "Unknown error";
        try {
          if (placeholderMessageId) {
            await ctx.telegram.editMessageText(chatId, placeholderMessageId, undefined, `Error: ${msg}`);
            return;
          }
        } catch {}
        await ctx.reply(`Error: ${msg}`);
        return;
      }
    }

    const chunks = splitText(finalText || "(no output)", TELEGRAM_MAX_MESSAGE);
    if (placeholderMessageId) {
      try {
        await ctx.telegram.editMessageText(chatId, placeholderMessageId, undefined, chunks[0] || "(no output)");
      } catch {
        await ctx.reply(chunks[0] || "(no output)");
      }
      for (const ch of chunks.slice(1)) {
        await ctx.reply(ch);
      }
    } else {
      for (const ch of chunks) await ctx.reply(ch);
    }

    if (receiptText) {
      const receiptChunks = splitText(receiptText, TELEGRAM_MAX_MESSAGE);
      for (const ch of receiptChunks) await ctx.reply(ch);
    }

    recordChannelEvent({
      channel: "telegram",
      event: "message_processing",
      ok: true,
      details: {
        interfaceId: instance.id,
        ownerUserId: String(instance.owner_user_id),
        externalChatId: chatId,
        responseLength: finalText?.length,
      },
    });
  }

  bot.on(message("text"), async (ctx) => {
    const messageText = String(ctx.message.text || "").trim();
    await handleTelegramInput(ctx, { text: messageText });
  });

  bot.on(message("photo"), async (ctx: any) => {
    const photos = Array.isArray(ctx.message?.photo) ? ctx.message.photo : [];
    const best = photos.length > 0 ? photos[photos.length - 1] : null;
    const caption = String(ctx.message?.caption || "").trim();
    if (!best?.file_id) return;
    await handleTelegramInput(ctx, {
      text: caption,
      attachment: { kind: "photo", fileId: String(best.file_id), fileName: `photo-${Date.now()}.jpg` },
    });
  });

  bot.on(message("document"), async (ctx: any) => {
    const doc = ctx.message?.document;
    if (!doc?.file_id) return;
    const caption = String(ctx.message?.caption || "").trim();
    await handleTelegramInput(ctx, {
      text: caption,
      attachment: { kind: "document", fileId: String(doc.file_id), fileName: String(doc.file_name || `document-${Date.now()}`) },
    });
  });

  await bot.launch();
  logger.info("Telegram instance launched", {
    interfaceId: instance.id,
    ownerUserId: instance.owner_user_id,
    name: instance.name,
  });
}

async function main() {
  const instances = getActiveTelegramInterfaces();
  if (instances.length === 0) {
    const logger = createBotLogger("telegram");
    logger.info(
      "Telegram interface not enabled; no active interface rows found. Enable it in the admin panel.",
    );
    process.exit(0);
  }

  await Promise.all(instances.map((i) => startTelegramInstance(i)));
}

main().catch((err) => {
  const logger = createBotLogger("telegram");
  logger.error("Telegram runner failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
