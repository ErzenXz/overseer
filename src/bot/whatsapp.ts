/**
 * WhatsApp Bot Runner (Multi-Instance, Per-User) - Baileys
 *
 * Each active `interfaces` row of type "whatsapp" spawns one Baileys socket and
 * stores auth state under data/whatsapp/<interfaceId>/.
 *
 * Note: WhatsApp pairing/login is required on first run. This runner prints the
 * pairing info in logs/terminal.
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { mkdirSync, existsSync } from "fs";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser,
  Browsers,
  type WAMessage,
} from "@whiskeysockets/baileys";

import { initializeSchema } from "../database/db";
import {
  conversationsModel,
  messagesModel,
  interfacesModel,
  usersModel,
} from "../database/index";
import { runAgentStream } from "../agent/agent";
import { createBotLogger, splitText } from "./shared";
import { SessionManager } from "../lib/session-manager";
import { getRateLimiter } from "../lib/rate-limiter";
import { recordChannelEvent } from "../lib/channel-observability";
import { withToolContext } from "../lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "../lib/userfs";
import { hasAnyPermission, Permission } from "../lib/permissions";
import { extractMemoriesFromConversation } from "../agent/super-memory";

dotenvConfig({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const MAX_WA_MESSAGE = 3500;

function normalizeAllowedEntry(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return jidNormalizedUser(trimmed);
  const digits = trimmed.replace(/\D+/g, "");
  return digits ? jidNormalizedUser(`${digits}@s.whatsapp.net`) : "";
}

function isAllowedUser(senderJid: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const normalizedSender = jidNormalizedUser(senderJid);
  const normalizedAllowed = allowed.map(normalizeAllowedEntry).filter(Boolean);
  return normalizedAllowed.includes(normalizedSender);
}

function getTextFromMessage(msg: WAMessage): string {
  const m = msg.message as any;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  );
}

function getFallbackOwnerUserId(): number {
  const admin = usersModel.findAll().find((u) => u.role === "admin");
  return admin?.id ?? usersModel.findAll()[0]?.id ?? 1;
}

function getActiveWhatsAppInterfaces(): Array<{
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}> {
  const rows = interfacesModel.findActiveByType("whatsapp");
  if (rows.length === 0 && process.env.WHATSAPP_ENABLED) {
    return [
      {
        id: -1,
        owner_user_id: getFallbackOwnerUserId(),
        name: "WhatsApp (env)",
        config: { phone_number: process.env.WHATSAPP_PHONE_NUMBER },
        allowed_users: [],
      },
    ];
  }

  return rows.map((r) => {
    const cfg =
      (interfacesModel.getDecryptedConfig(r.id) || {}) as Record<string, unknown>;
    return {
      id: r.id,
      owner_user_id: (r as any).owner_user_id ?? 1,
      name: r.name,
      config: cfg,
      allowed_users: interfacesModel.getAllowedUsers(r.id),
    };
  });
}

async function startWhatsAppInstance(instance: {
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
  const logger = createBotLogger("whatsapp", instance.owner_user_id);

  const authDir = resolve(
    process.cwd(),
    "data",
    "whatsapp",
    instance.id > 0 ? String(instance.id) : "env",
  );
  if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const phoneNumber =
    typeof instance.config.phone_number === "string"
      ? instance.config.phone_number
      : process.env.WHATSAPP_PHONE_NUMBER || null;

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: phoneNumber ? false : true,
    browser: Browsers.macOS("Overseer"),
    markOnlineOnConnect: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      logger.info("WhatsApp connected", {
        interfaceId: instance.id,
        ownerUserId: instance.owner_user_id,
      });
      return;
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.warn("WhatsApp connection closed", { code, shouldReconnect });
    }
  });

  // Pairing code flow (optional)
  if (phoneNumber) {
    try {
      const code = await sock.requestPairingCode(phoneNumber.replace(/\D+/g, ""));
      logger.info("WhatsApp pairing code", { code });
    } catch (err) {
      logger.warn("WhatsApp pairing code request failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sandboxRoot = getUserSandboxRoot({
    kind: "web",
    id: String(instance.owner_user_id),
  });
  ensureDir(sandboxRoot);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const senderJid = msg.key.participant || msg.key.remoteJid || "";
      const chatJid = msg.key.remoteJid || "";

      if (!senderJid || !chatJid) continue;
      if (!isAllowedUser(senderJid, instance.allowed_users)) continue;

      const text = getTextFromMessage(msg).trim();
      if (!text) continue;

      const conversation = conversationsModel.findOrCreate({
        owner_user_id: instance.owner_user_id,
        interface_id: instance.id > 0 ? instance.id : undefined,
        interface_type: "whatsapp",
        external_chat_id: chatJid,
        external_user_id: senderJid,
        external_username: senderJid,
        metadata: { interfaceName: instance.name },
      });

      const session = SessionManager.getOrCreateSession({
        conversation_id: conversation.id,
        interface_type: "whatsapp",
        external_user_id: senderJid,
        external_chat_id: chatJid,
        metadata: { interfaceId: instance.id, ownerUserId: instance.owner_user_id },
      });

      SessionManager.addMessage(session.id, "user", text);
      messagesModel.create({ conversation_id: conversation.id, role: "user", content: text });

      const rateLimiter = getRateLimiter();

      await withToolContext(
        {
          sandboxRoot,
          allowSystem,
          actor: { kind: "web", id: String(instance.owner_user_id) },
        },
        async () => {
          const result = await runAgentStream(text, {
            conversationId: conversation.id,
            planMode: true,
            sandboxRoot,
            allowSystem,
            actor: { kind: "web", id: String(instance.owner_user_id) },
          });

          const finalText = await result.fullText;
          const usage = await result.usage;

          const chunks = splitText(finalText || "(no output)", MAX_WA_MESSAGE);
          for (const ch of chunks) {
            await sock.sendMessage(chatJid, { text: ch });
          }

          if (usage) {
            rateLimiter.recordRequest({
              userId: String(instance.owner_user_id),
              conversationId: conversation.id,
              interfaceType: "whatsapp",
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
            `user: ${text}\n\nassistant: ${finalText}`,
          ).catch(() => {});

          recordChannelEvent({
            channel: "whatsapp",
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
    }
  });

  logger.info("WhatsApp instance started", {
    interfaceId: instance.id,
    ownerUserId: instance.owner_user_id,
    authDir,
  });
}

async function main() {
  const instances = getActiveWhatsAppInterfaces();
  if (instances.length === 0) {
    createBotLogger("whatsapp").info(
      "WhatsApp interface not enabled; no active interface rows found.",
    );
    process.exit(0);
  }

  await Promise.all(instances.map((i) => startWhatsAppInstance(i)));
}

main().catch((err) => {
  createBotLogger("whatsapp").error("WhatsApp runner failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
