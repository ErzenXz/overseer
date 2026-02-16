/**
 * Discord Bot Runner (Multi-Instance, Per-User)
 *
 * Loads all active `interfaces` rows of type "discord" and starts one discord.js
 * client per row. Each interface row belongs to a web user (owner_user_id), and
 * all executions run inside that tenant's sandbox root: data/userfs/web/<owner>.
 *
 * Note: This is a pragmatic implementation (DMs + !ask). It intentionally avoids
 * global slash-command registration to keep multi-instance behavior reliable.
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
} from "discord.js";
import { config } from "dotenv";
import { resolve } from "path";

import { interfacesModel, usersModel } from "../database/index";
import { initializeSchema } from "../database/db";
import { createBotLogger, isRateLimited, splitText } from "./shared";
import { recordChannelEvent } from "../lib/channel-observability";
import { streamGatewayChat } from "../gateway/sse-client";

config({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const COOLDOWN_MS = 2000;
const MAX_MESSAGE_LEN = 1900;

function getGatewayBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.GATEWAY_BASE_URL || process.env.BASE_URL || `http://localhost:${port}`;
}

function getFallbackOwnerUserId(): number {
  const admin = usersModel.findAll().find((u) => u.role === "admin");
  return admin?.id ?? usersModel.findAll()[0]?.id ?? 1;
}

function getActiveDiscordInterfaces(): Array<{
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}> {
  const rows = interfacesModel.findActiveByType("discord");
  if (rows.length === 0 && process.env.DISCORD_BOT_TOKEN) {
    // Backwards-compat: auto-create a DB-backed interface so gateway auth works.
    const ownerId = getFallbackOwnerUserId();
    const allowedUsers = (process.env.DISCORD_ALLOWED_USERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedGuilds = (process.env.DISCORD_ALLOWED_GUILDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const created = interfacesModel.create({
        type: "discord",
        name: "Discord (env)",
        owner_user_id: ownerId,
        config: {
          bot_token: process.env.DISCORD_BOT_TOKEN,
          allowed_guilds: allowedGuilds,
        },
        allowed_users: allowedUsers,
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
      return [
        {
          id: -1,
          owner_user_id: ownerId,
          name: "Discord (env)",
          config: {
            bot_token: process.env.DISCORD_BOT_TOKEN,
            allowed_guilds: allowedGuilds,
          },
          allowed_users: allowedUsers,
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

function isAllowedGuild(
  cfg: Record<string, unknown>,
  guildId: string | null,
): boolean {
  const allowed = Array.isArray(cfg.allowed_guilds)
    ? cfg.allowed_guilds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (allowed.length === 0) return true;
  if (!guildId) return true; // DMs ok
  return allowed.includes(guildId);
}

async function startDiscordInstance(instance: {
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}) {
  const logger = createBotLogger("discord", instance.owner_user_id);

  const token = String(instance.config.bot_token || "");
  const gatewayToken = String((instance.config as any).gateway_token || "");
  if (!token) return;
  if (!gatewayToken || instance.id <= 0) {
    logger.warn("Gateway token missing; cannot start discord instance for gateway mode", {
      interfaceId: instance.id,
    });
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info("Discord client ready", {
      interfaceId: instance.id,
      ownerUserId: instance.owner_user_id,
      botUser: c.user?.tag,
    });
  });

  client.on(Events.MessageCreate, async (msg: Message) => {
    if (msg.author.bot) return;
    const externalUserId = msg.author.id;
    const guildId = msg.guild?.id ?? null;

    if (!isAllowedGuild(instance.config, guildId)) return;
    if (isRateLimited(`${instance.id}:${externalUserId}`, { cooldownMs: COOLDOWN_MS })) {
      return;
    }

    const content = msg.content?.trim() || "";
    const isDm = msg.channel.isDMBased();
    const isAsk = content.startsWith("!ask ");
    const shouldRespond = isDm || isAsk;
    if (!shouldRespond) return;

    const prompt = isAsk ? content.slice("!ask ".length).trim() : content;
    if (!prompt) return;

    try {
      if ("sendTyping" in msg.channel) {
        await (msg.channel as any).sendTyping();
      }
    } catch {}

    if (!gatewayToken || instance.id <= 0) {
      await msg.reply("Gateway auth is not configured for this interface. Create/enable the interface in the admin panel.");
      return;
    }

    const externalChatId = isDm ? `dm:${externalUserId}` : String(msg.channelId);
    const gatewayBody: Record<string, unknown> = {
      message: prompt,
      externalChatId,
      externalUserId,
      externalUsername: msg.author.username,
      planMode: false,
      attachments: [],
    };

    let buffer = "";
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
      } else if (evt.type === "tool_receipt") {
        receiptText = evt.text;
      } else if (evt.type === "done") {
        finalText = evt.fullText || buffer;
      } else if (evt.type === "error") {
        await msg.reply(`Error: ${evt.error || "Unknown error"}`);
        return;
      }
    }

    const chunks = splitText(finalText || "No response.", MAX_MESSAGE_LEN);
    for (const ch of chunks) {
      await msg.reply(ch);
    }

    if (receiptText) {
      const receiptChunks = splitText(receiptText, MAX_MESSAGE_LEN);
      for (const ch of receiptChunks) {
        await msg.reply(ch);
      }
    }

    recordChannelEvent({
      channel: "discord",
      event: "message_processing",
      ok: true,
      details: {
        interfaceId: instance.id,
        ownerUserId: String(instance.owner_user_id),
        externalChatId,
        responseLength: finalText?.length,
      },
    });
  });

  await client.login(token);
}

async function main() {
  const instances = getActiveDiscordInterfaces();
  if (instances.length === 0) {
    const logger = createBotLogger("discord");
    logger.info(
      "Discord interface not enabled; no active interface rows found. Enable it in the admin panel.",
    );
    process.exit(0);
  }

  await Promise.all(instances.map((i) => startDiscordInstance(i)));
}

main().catch((err) => {
  const logger = createBotLogger("discord");
  logger.error("Discord runner failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
