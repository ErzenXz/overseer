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
  Browsers,
  type WAMessage,
} from "@whiskeysockets/baileys";

import { initializeSchema } from "../database/db";
import {
  interfacesModel,
  usersModel,
} from "../database/index";
import { createBotLogger, splitText } from "./shared";
import { recordChannelEvent } from "../lib/channel-observability";
import { streamGatewayChat } from "../gateway/sse-client";

dotenvConfig({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const MAX_WA_MESSAGE = 3500;
const STREAM_FIRST_SEND_MIN_CHARS = 900;
const STREAM_FIRST_SEND_MAX_WAIT_MS = 2500;

function getGatewayBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.GATEWAY_BASE_URL || process.env.BASE_URL || `http://localhost:${port}`;
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
    const ownerId = getFallbackOwnerUserId();
    try {
      const created = interfacesModel.create({
        type: "whatsapp",
        name: "WhatsApp (env)",
        owner_user_id: ownerId,
        config: { phone_number: process.env.WHATSAPP_PHONE_NUMBER },
        allowed_users: [],
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
          name: "WhatsApp (env)",
          config: { phone_number: process.env.WHATSAPP_PHONE_NUMBER },
          allowed_users: [],
        },
      ];
    }
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

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const senderJid = msg.key.participant || msg.key.remoteJid || "";
      const chatJid = msg.key.remoteJid || "";

      if (!senderJid || !chatJid) continue;

      const text = getTextFromMessage(msg).trim();
      if (!text) continue;

      const gatewayToken = String((instance.config as any).gateway_token || "");
      if (!gatewayToken || instance.id <= 0) {
        logger.warn("Gateway token missing; cannot process message", { interfaceId: instance.id });
        continue;
      }

      const gatewayBody: Record<string, unknown> = {
        message: text,
        externalChatId: chatJid,
        externalUserId: senderJid,
        externalUsername: senderJid,
        planMode: false,
        attachments: [],
      };

      const startAt = Date.now();
      let buffer = "";
      let firstSent = false;
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
          if (!firstSent) {
            const elapsed = Date.now() - startAt;
            if (buffer.length >= STREAM_FIRST_SEND_MIN_CHARS || elapsed >= STREAM_FIRST_SEND_MAX_WAIT_MS) {
              const first = buffer.slice(0, MAX_WA_MESSAGE) || "(no output)";
              await sock.sendMessage(chatJid, { text: first });
              buffer = buffer.slice(first.length);
              firstSent = true;
            }
          }
        } else if (evt.type === "tool_receipt") {
          receiptText = evt.text;
        } else if (evt.type === "done") {
          finalText = evt.fullText || buffer;
        } else if (evt.type === "error") {
          await sock.sendMessage(chatJid, { text: `Error: ${evt.error || "Unknown error"}` });
          buffer = "";
          finalText = "";
          receiptText = null;
          break;
        }
      }

      const remaining = firstSent ? buffer + finalText : finalText;
      const chunks = splitText(remaining || "(no output)", MAX_WA_MESSAGE);
      for (const ch of chunks) {
        await sock.sendMessage(chatJid, { text: ch });
      }

      if (receiptText) {
        const receiptChunks = splitText(receiptText, MAX_WA_MESSAGE);
        for (const ch of receiptChunks) {
          await sock.sendMessage(chatJid, { text: ch });
        }
      }

      recordChannelEvent({
        channel: "whatsapp",
        event: "message_processing",
        ok: true,
        details: {
          interfaceId: instance.id,
          ownerUserId: String(instance.owner_user_id),
          externalChatId: chatJid,
          responseLength: remaining?.length,
        },
      });
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
