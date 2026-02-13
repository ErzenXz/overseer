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
  conversationsModel,
  messagesModel,
  interfacesModel,
  usersModel,
} from "../database/index";
import { runAgentStream } from "../agent/agent";
import { createBotLogger, isRateLimited, splitText } from "./shared";
import { getRateLimiter } from "../lib/rate-limiter";
import { SessionManager, estimateTokens } from "../lib/session-manager";
import { recordChannelEvent } from "../lib/channel-observability";
import { getDefaultModel } from "../agent/providers";
import { withToolContext } from "../lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "../lib/userfs";
import { hasAnyPermission, Permission } from "../lib/permissions";
import { extractMemoriesFromConversation } from "../agent/super-memory";

dotenvConfig({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const COOLDOWN_MS = 1500;
const MAX_SLACK_MESSAGE = 3000;

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
    return [
      {
        id: -1,
        owner_user_id: getFallbackOwnerUserId(),
        name: "Slack (env)",
        config: {
          bot_token: process.env.SLACK_BOT_TOKEN,
          app_token: process.env.SLACK_APP_TOKEN,
          signing_secret: process.env.SLACK_SIGNING_SECRET,
        },
        allowed_users: (process.env.SLACK_ALLOWED_USERS || "")
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

function isUserAllowed(userId: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.includes(userId);
}

async function startSlackInstance(instance: {
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
  const logger = createBotLogger("slack", instance.owner_user_id);

  const botToken = typeof instance.config.bot_token === "string" ? instance.config.bot_token : null;
  const appToken = typeof instance.config.app_token === "string" ? instance.config.app_token : null;
  const signingSecret =
    typeof instance.config.signing_secret === "string" ? instance.config.signing_secret : null;

  if (!botToken || !appToken || !signingSecret) {
    logger.error("Slack instance missing credentials; skipping", {
      interfaceId: instance.id,
      hasBotToken: !!botToken,
      hasAppToken: !!appToken,
      hasSigningSecret: !!signingSecret,
    });
    return;
  }

  const sandboxRoot = getUserSandboxRoot({
    kind: "web",
    id: String(instance.owner_user_id),
  });
  ensureDir(sandboxRoot);

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

    if (!isUserAllowed(externalUserId, instance.allowed_users)) {
      await say("⛔ You are not authorized to use this bot.");
      return;
    }

    if (isRateLimited(`${instance.id}:${externalUserId}`, { cooldownMs: COOLDOWN_MS })) {
      await say("⏳ Please wait a moment before sending another request.");
      return;
    }

    const rateLimiter = getRateLimiter();
    const estimatedTokenCount = estimateTokens(text);
    const activeModelId =
      (getDefaultModel() as { modelId?: string } | null)?.modelId || "default";

    const preCheck = await rateLimiter.checkLimit({
      userId: String(instance.owner_user_id),
      interfaceType: "slack",
      tokens: estimatedTokenCount,
      modelId: activeModelId,
    });

    if (!preCheck.allowed) {
      await say(
        rateLimiter.getErrorMessage(preCheck) ||
          preCheck.reason ||
          "Rate limit exceeded",
      );
      recordChannelEvent({
        channel: "slack",
        event: "rate_limit",
        ok: false,
        details: { ownerUserId: String(instance.owner_user_id), reason: preCheck.reason },
      });
      return;
    }

    const conversation = conversationsModel.findOrCreate({
      owner_user_id: instance.owner_user_id,
      interface_id: instance.id > 0 ? instance.id : undefined,
      interface_type: "slack",
      external_chat_id: channelId,
      external_user_id: externalUserId,
      external_username: externalUserId,
      metadata: { interfaceName: instance.name },
    });

    const session = SessionManager.getOrCreateSession({
      conversation_id: conversation.id,
      interface_type: "slack",
      external_user_id: externalUserId,
      external_chat_id: channelId,
      metadata: { interfaceId: instance.id, ownerUserId: instance.owner_user_id },
    });

    SessionManager.addMessage(session.id, "user", text);
    messagesModel.create({ conversation_id: conversation.id, role: "user", content: text });

    const thinking = await say("Thinking...");
    const ts = (thinking as any)?.ts as string | undefined;

    const { fullText, usage } = await withToolContext(
      {
        sandboxRoot,
        allowSystem,
        actor: { kind: "web", id: String(instance.owner_user_id) },
      },
      () =>
        runAgentStream(text, {
          conversationId: conversation.id,
          sandboxRoot,
          allowSystem,
          planMode: true,
          actor: { kind: "web", id: String(instance.owner_user_id) },
          onToolCall: () => SessionManager.recordToolCall(session.id),
        }),
    );

    const finalText = (await fullText) || "";
    const chunks = splitText(finalText || "(no output)", MAX_SLACK_MESSAGE);

    if (ts) {
      await client.chat.update({ channel: channelId, ts, text: chunks[0] || "(no output)" });
    } else {
      await say(chunks[0] || "(no output)");
    }

    for (let i = 1; i < chunks.length; i++) {
      await say(chunks[i]);
    }

    SessionManager.addMessage(session.id, "assistant", finalText);
    const usageData = await usage;
    messagesModel.create({
      conversation_id: conversation.id,
      role: "assistant",
      content: finalText,
      input_tokens: usageData?.inputTokens,
      output_tokens: usageData?.outputTokens,
    });

    if (usageData) {
      rateLimiter.recordRequest({
        userId: String(instance.owner_user_id),
        conversationId: conversation.id,
        interfaceType: "slack",
        inputTokens: usageData.inputTokens,
        outputTokens: usageData.outputTokens,
        model: activeModelId,
      });
    }

    extractMemoriesFromConversation(
      instance.owner_user_id,
      `user: ${text}\n\nassistant: ${finalText}`,
    ).catch(() => {});
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
