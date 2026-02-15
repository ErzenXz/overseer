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

import { runAgentStream } from "../agent/agent";
import {
  conversationsModel,
  messagesModel,
  interfacesModel,
  usersModel,
} from "../database/index";
import { initializeSchema } from "../database/db";
import { SessionManager } from "../lib/session-manager";
import { extractMemoriesFromConversation } from "../agent/super-memory";
import { createBotLogger, isRateLimited } from "./shared";
import { withToolContext } from "../lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "../lib/userfs";
import { getRateLimiter } from "../lib/rate-limiter";
import { hasAnyPermission, Permission } from "../lib/permissions";
import { recordChannelEvent } from "../lib/channel-observability";

// Load environment
config({ path: resolve(process.cwd(), ".env") });

// Initialize database
initializeSchema();

const COOLDOWN_MS = 2000;

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
    // Backwards-compat: allow a single env-based bot.
    return [
      {
        id: -1,
        owner_user_id: getFallbackOwnerUserId(),
        name: "Telegram (env)",
        config: { bot_token: process.env.TELEGRAM_BOT_TOKEN },
        allowed_users: (process.env.TELEGRAM_ALLOWED_USERS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    ];
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
  const owner = usersModel.findById(instance.owner_user_id);
  const allowSystem = owner
    ? hasAnyPermission(owner, [
        Permission.SYSTEM_SHELL,
        Permission.SYSTEM_FILES_READ,
        Permission.SYSTEM_FILES_WRITE,
        Permission.SYSTEM_FILES_DELETE,
      ])
    : false;
  const logger = createBotLogger("telegram", instance.owner_user_id);

  const token = String(instance.config.bot_token || "");
  if (!token) {
    logger.warn("No bot token; skipping instance", {
      interfaceId: instance.id,
      name: instance.name,
    });
    return;
  }

  const bot = new Telegraf(token);
  const sandboxRoot = getUserSandboxRoot({
    kind: "web",
    id: String(instance.owner_user_id),
  });
  ensureDir(sandboxRoot);

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
    await ctx.reply(
      "Hi. I am your assistant. Send a message and I will respond.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Send a message to chat. If tools require confirmation, I’ll ask first.",
    );
  });

  bot.on(message("text"), async (ctx) => {
    const externalUserId = String(ctx.from?.id || "");
    const chatId = String(ctx.chat?.id || "");

    // Allowed-users check per interface.
    if (instance.allowed_users.length > 0 && !instance.allowed_users.includes(externalUserId)) {
      await ctx.reply("You are not allowed to use this bot.");
      return;
    }

    if (isRateLimited(`${instance.id}:${externalUserId}`, { cooldownMs: COOLDOWN_MS })) {
      return;
    }

    const messageText = String(ctx.message.text || "").trim();
    if (!messageText) return;

    const conversation = conversationsModel.findOrCreate({
      owner_user_id: instance.owner_user_id,
      interface_id: instance.id > 0 ? instance.id : undefined,
      interface_type: "telegram",
      external_chat_id: chatId,
      external_user_id: externalUserId,
      external_username: ctx.from?.username,
      metadata: {
        interfaceName: instance.name,
      },
    });

    const session = SessionManager.getOrCreateSession({
      conversation_id: conversation.id,
      interface_type: "telegram",
      external_user_id: externalUserId,
      external_chat_id: chatId,
      metadata: {
        interfaceId: instance.id,
        ownerUserId: instance.owner_user_id,
      },
    });

    SessionManager.addMessage(session.id, "user", messageText);

    messagesModel.create({
      conversation_id: conversation.id,
      role: "user",
      content: messageText,
    });

    try {
      // Best-effort: indicate we are working without sending placeholder messages.
      await ctx.sendChatAction("typing");
    } catch {}

    const rateLimiter = getRateLimiter();

    await withToolContext(
      {
        sandboxRoot,
        allowSystem,
        actor: { kind: "web", id: String(instance.owner_user_id) },
        conversationId: conversation.id,
        agentSessionId: session.session_id,
        interface: {
          type: "telegram",
          id: instance.id,
          externalChatId: chatId,
          externalUserId,
        },
      },
      async () => {
        const result = await runAgentStream(messageText, {
          conversationId: conversation.id,
          planMode: false,
          sandboxRoot,
          allowSystem,
          actor: { kind: "web", id: String(instance.owner_user_id) },
        });

        let fullText = "";
        for await (const chunk of result.textStream) {
          fullText += chunk;
        }

        const finalText = await result.fullText;
        const usage = await result.usage;

        await ctx.reply(finalText || "I couldn't generate a response. Try again.");

        if (usage) {
          rateLimiter.recordRequest({
            userId: String(instance.owner_user_id),
            conversationId: conversation.id,
            interfaceType: "telegram",
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            model: "default",
          });
        }

        messagesModel.create({
          conversation_id: conversation.id,
          role: "assistant",
          content: finalText,
          input_tokens: usage?.inputTokens,
          output_tokens: usage?.outputTokens,
        });

        extractMemoriesFromConversation(
          instance.owner_user_id,
          `user: ${messageText}\n\nassistant: ${finalText}`,
        ).catch(() => {});

        recordChannelEvent({
          channel: "telegram",
          event: "message_processing",
          ok: true,
          details: {
            interfaceId: instance.id,
            ownerUserId: String(instance.owner_user_id),
            conversationId: conversation.id,
            responseLength: finalText?.length,
          },
        });
      },
    );
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
