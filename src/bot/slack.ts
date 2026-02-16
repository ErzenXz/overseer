/**
 * Slack Bot Runner (Multi-Instance, Per-User) - Bolt Socket Mode
 *
 * Loads all active `interfaces` rows of type "slack" and starts one Bolt App
 * per row. Each interface row belongs to a web user (owner_user_id), and all
 * executions run inside that tenant's sandbox root: data/userfs/web/<owner>.
 */

import { App } from "@slack/bolt";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

import { initializeSchema } from "../database/db";
import {
  interfacesModel,
  usersModel,
} from "../database/index";
import { createBotLogger, isRateLimited, splitText } from "./shared";
import { recordChannelEvent } from "../lib/channel-observability";
import { streamGatewayChat } from "../gateway/sse-client";

dotenvConfig({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const COOLDOWN_MS = 1500;
const MAX_SLACK_MESSAGE = 3000;
const STREAM_UPDATE_DEBOUNCE_MS = 1200;
const STREAM_MIN_CHARS_BEFORE_UPDATE = 64;

function getGatewayBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.GATEWAY_BASE_URL || process.env.BASE_URL || `http://localhost:${port}`;
}

function getFallbackOwnerUserId(): number {
  const admin = usersModel.findAll().find((u) => u.role === "admin");
  return admin?.id ?? usersModel.findAll()[0]?.id ?? 1;
}

function getActiveSlackInterfaces(): Array<{
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}> {
  const rows = interfacesModel.findActiveByType("slack");
  if (rows.length === 0 && process.env.SLACK_BOT_TOKEN) {
    // Backwards-compat: auto-create a DB-backed interface so gateway auth works.
    const ownerId = getFallbackOwnerUserId();
    const allowedUsers = (process.env.SLACK_ALLOWED_USERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const created = interfacesModel.create({
        type: "slack",
        name: "Slack (env)",
        owner_user_id: ownerId,
        config: {
          bot_token: process.env.SLACK_BOT_TOKEN,
          app_token: process.env.SLACK_APP_TOKEN,
          signing_secret: process.env.SLACK_SIGNING_SECRET,
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
          name: "Slack (env)",
          config: {
            bot_token: process.env.SLACK_BOT_TOKEN,
            app_token: process.env.SLACK_APP_TOKEN,
            signing_secret: process.env.SLACK_SIGNING_SECRET,
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

async function startSlackInstance(instance: {
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}) {
  const logger = createBotLogger("slack", instance.owner_user_id);

  const botToken = typeof instance.config.bot_token === "string" ? instance.config.bot_token : null;
  const appToken = typeof instance.config.app_token === "string" ? instance.config.app_token : null;
  const signingSecret =
    typeof instance.config.signing_secret === "string" ? instance.config.signing_secret : null;
  const gatewayToken = String((instance.config as any).gateway_token || "");

  if (!botToken || !appToken || !signingSecret) {
    logger.error("Slack instance missing credentials; skipping", {
      interfaceId: instance.id,
      hasBotToken: !!botToken,
      hasAppToken: !!appToken,
      hasSigningSecret: !!signingSecret,
    });
    return;
  }

  if (!gatewayToken || instance.id <= 0) {
    logger.warn("Gateway auth not configured for slack interface", { interfaceId: instance.id });
  }

  const app = new App({
    token: botToken,
    appToken,
    signingSecret,
    socketMode: true,
  });

  app.message(async ({ message, say, client }) => {
    const m = message as any;
    const externalUserId = String(m.user || "");
    const channelId = String(m.channel || "");
    const text = typeof m.text === "string" ? m.text.trim() : "";

    if (!externalUserId || !channelId || !text) return;
    if (m.subtype === "bot_message" || m.bot_id) return;

    if (isRateLimited(`${instance.id}:${externalUserId}`, { cooldownMs: COOLDOWN_MS })) {
      await say("⏳ Please wait a moment before sending another request.");
      return;
    }

    if (!gatewayToken || instance.id <= 0) {
      await say("Gateway auth is not configured for this interface. Create/enable the interface in the admin panel.");
      return;
    }

    const thinking = await say("…");
    const ts = (thinking as any)?.ts as string | undefined;

    let buffer = "";
    let lastUpdateAt = 0;
    let lastSentLen = 0;
    let finalText = "";
    let receiptText = "";

    for await (const evt of streamGatewayChat({
      baseUrl: getGatewayBaseUrl(),
      interfaceId: instance.id,
      interfaceToken: gatewayToken,
      body: {
        message: text,
        externalChatId: channelId,
        externalUserId,
        externalUsername: externalUserId,
        planMode: false,
        attachments: [],
      },
    })) {
      if (evt.type === "text_delta") {
        buffer += evt.text || "";
        const now = Date.now();
        const shouldUpdate =
          ts &&
          now - lastUpdateAt >= STREAM_UPDATE_DEBOUNCE_MS &&
          buffer.length - lastSentLen >= STREAM_MIN_CHARS_BEFORE_UPDATE;
        if (!shouldUpdate) continue;
        const preview =
          buffer.length > MAX_SLACK_MESSAGE
            ? buffer.slice(0, MAX_SLACK_MESSAGE - 32) + "\n\n(continuing…)"
            : buffer;
        try {
          await client.chat.update({ channel: channelId, ts, text: preview });
          lastUpdateAt = now;
          lastSentLen = buffer.length;
        } catch {}
      } else if (evt.type === "tool_receipt") {
        receiptText = evt.text;
      } else if (evt.type === "done") {
        finalText = evt.fullText || buffer;
      } else if (evt.type === "error") {
        await say(`Error: ${evt.error || "Unknown error"}`);
        return;
      }
    }

    const chunks = splitText(finalText || "(no output)", MAX_SLACK_MESSAGE);

    if (ts) {
      await client.chat.update({ channel: channelId, ts, text: chunks[0] || "(no output)" });
    } else {
      await say(chunks[0] || "(no output)");
    }

    for (let i = 1; i < chunks.length; i++) {
      await say(chunks[i]);
    }
    if (receiptText) {
      const rchunks = splitText(receiptText, MAX_SLACK_MESSAGE);
      for (const ch of rchunks) {
        await say(ch);
      }
    }

    recordChannelEvent({
      channel: "slack",
      event: "message_processing",
      ok: true,
      details: {
        interfaceId: instance.id,
        ownerUserId: String(instance.owner_user_id),
        externalChatId: channelId,
        responseLength: finalText?.length,
      },
    });
  });

  await app.start();
  logger.info("Slack instance started", {
    interfaceId: instance.id,
    ownerUserId: instance.owner_user_id,
    name: instance.name,
  });
}

async function main() {
  const instances = getActiveSlackInterfaces();
  if (instances.length === 0) {
    const logger = createBotLogger("slack");
    logger.info("Slack interface not enabled; no active interface rows found.");
    process.exit(0);
  }

  await Promise.all(instances.map((i) => startSlackInstance(i)));
}

main().catch((err) => {
  const logger = createBotLogger("slack");
  logger.error("Slack runner failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
