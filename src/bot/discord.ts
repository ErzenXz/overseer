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
import { createBotLogger, isRateLimited, splitText } from "./shared";
import { withToolContext } from "../lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "../lib/userfs";
import { getRateLimiter } from "../lib/rate-limiter";
import { hasAnyPermission, Permission } from "../lib/permissions";
import { recordChannelEvent } from "../lib/channel-observability";

config({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const COOLDOWN_MS = 2000;
const MAX_MESSAGE_LEN = 1900;

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
    return [
      {
        id: -1,
        owner_user_id: getFallbackOwnerUserId(),
        name: "Discord (env)",
        config: {
          bot_token: process.env.DISCORD_BOT_TOKEN,
          allowed_guilds: (process.env.DISCORD_ALLOWED_GUILDS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
        allowed_users: (process.env.DISCORD_ALLOWED_USERS || "")
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
  const owner = usersModel.findById(instance.owner_user_id);
  const allowSystem = owner
    ? hasAnyPermission(owner, [
        Permission.SYSTEM_SHELL,
        Permission.SYSTEM_FILES_READ,
        Permission.SYSTEM_FILES_WRITE,
        Permission.SYSTEM_FILES_DELETE,
      ])
    : false;
  const logger = createBotLogger("discord", instance.owner_user_id);

  const token = String(instance.config.bot_token || "");
  if (!token) return;

  const sandboxRoot = getUserSandboxRoot({
    kind: "web",
    id: String(instance.owner_user_id),
  });
  ensureDir(sandboxRoot);

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
    if (instance.allowed_users.length > 0 && !instance.allowed_users.includes(externalUserId)) {
      return;
    }

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

    const conversation = conversationsModel.findOrCreate({
      owner_user_id: instance.owner_user_id,
      interface_id: instance.id > 0 ? instance.id : undefined,
      interface_type: "discord",
      external_chat_id: isDm ? `dm:${externalUserId}` : String(msg.channelId),
      external_user_id: externalUserId,
      external_username: msg.author.username,
      metadata: { interfaceName: instance.name, guildId },
    });

    const session = SessionManager.getOrCreateSession({
      conversation_id: conversation.id,
      interface_type: "discord",
      external_user_id: externalUserId,
      external_chat_id: isDm ? `dm:${externalUserId}` : String(msg.channelId),
      metadata: { interfaceId: instance.id, ownerUserId: instance.owner_user_id },
    });

    SessionManager.addMessage(session.id, "user", prompt);
    messagesModel.create({ conversation_id: conversation.id, role: "user", content: prompt });

    try {
      if ("sendTyping" in msg.channel) {
        await (msg.channel as any).sendTyping();
      }
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
          type: "discord",
          id: instance.id,
          externalChatId: isDm ? `dm:${externalUserId}` : String(msg.channelId),
          externalUserId,
        },
      },
      async () => {
        const result = await runAgentStream(prompt, {
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

        const chunks = splitText(finalText || "No response.", MAX_MESSAGE_LEN);
        for (const ch of chunks) {
          await msg.reply(ch);
        }

        if (usage) {
          rateLimiter.recordRequest({
            userId: String(instance.owner_user_id),
            conversationId: conversation.id,
            interfaceType: "discord",
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
          `user: ${prompt}\n\nassistant: ${finalText}`,
        ).catch(() => {});

        recordChannelEvent({
          channel: "discord",
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
