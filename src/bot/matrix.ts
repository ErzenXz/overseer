/**
 * Matrix Bot Runner (Multi-Instance, Per-User) - matrix-js-sdk
 *
 * Replaces matrix-bot-sdk to avoid deprecated request/request-promise dependency chain.
 *
 * Supports:
 * - Multiple instances (one per interfaces row type=matrix)
 * - Per-tenant sandbox roots
 * - Basic invite auto-join
 * - Room message handling (plain m.text)
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { initializeSchema } from "../database/db";
import {
  interfacesModel,
  usersModel,
} from "../database/index";
import { createBotLogger, splitText } from "./shared";
import { recordChannelEvent } from "../lib/channel-observability";
import { streamGatewayChat } from "../gateway/sse-client";

import sdk, {
  MsgType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";

dotenvConfig({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const MAX_MATRIX_MESSAGE = 3500;

function getGatewayBaseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.GATEWAY_BASE_URL || process.env.BASE_URL || `http://localhost:${port}`;
}

function getFallbackOwnerUserId(): number {
  const admin = usersModel.findAll().find((u) => u.role === "admin");
  return admin?.id ?? usersModel.findAll()[0]?.id ?? 1;
}

function getActiveMatrixInterfaces(): Array<{
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}> {
  const rows = interfacesModel.findActiveByType("matrix");
  if (rows.length === 0 && process.env.MATRIX_ACCESS_TOKEN) {
    // Backwards-compat: auto-create a DB-backed interface so gateway auth works.
    const ownerId = getFallbackOwnerUserId();
    try {
      const created = interfacesModel.create({
        type: "matrix",
        name: "Matrix (env)",
        owner_user_id: ownerId,
        config: {
          homeserver: process.env.MATRIX_HOMESERVER,
          access_token: process.env.MATRIX_ACCESS_TOKEN,
        },
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
          name: "Matrix (env)",
          config: {
            homeserver: process.env.MATRIX_HOMESERVER,
            access_token: process.env.MATRIX_ACCESS_TOKEN,
          },
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

async function sendText(client: MatrixClient, roomId: string, body: string) {
  await client.sendMessage(roomId, { msgtype: MsgType.Text, body });
}

async function startMatrixInstance(instance: {
  id: number;
  owner_user_id: number;
  name: string;
  config: Record<string, unknown>;
  allowed_users: string[];
}) {
  const logger = createBotLogger("matrix", instance.owner_user_id);
  const gatewayToken = String((instance.config as any).gateway_token || "");

  const homeserver =
    typeof instance.config.homeserver === "string"
      ? instance.config.homeserver
      : process.env.MATRIX_HOMESERVER || null;
  const accessToken =
    typeof instance.config.access_token === "string"
      ? instance.config.access_token
      : process.env.MATRIX_ACCESS_TOKEN || null;
  const roomIds =
    Array.isArray(instance.config.room_ids) &&
    instance.config.room_ids.every((x) => typeof x === "string")
      ? (instance.config.room_ids as string[])
      : null;

  if (!homeserver || !accessToken) {
    logger.error("Matrix instance missing credentials; skipping", {
      interfaceId: instance.id,
      hasHomeserver: !!homeserver,
      hasAccessToken: !!accessToken,
    });
    return;
  }

  const client = sdk.createClient({
    baseUrl: homeserver,
    accessToken,
  }) as unknown as MatrixClient;
  if (!gatewayToken || instance.id <= 0) {
    logger.warn("Gateway auth not configured for matrix interface", { interfaceId: instance.id });
  }

  let me = "";
  client.on("sync" as any, (state: string) => {
    if (state === "PREPARED" && !me) {
      me = client.getUserId() || "";
      logger.info("Matrix client prepared", {
        interfaceId: instance.id,
        ownerUserId: instance.owner_user_id,
        userId: me,
      });
    }
  });

  // Auto-join on invite.
  client.on("RoomMember.membership" as any, async (_event: MatrixEvent, member: any) => {
    try {
      const myId = client.getUserId();
      if (!myId) return;
      if (member?.userId !== myId) return;
      if (member?.membership !== "invite") return;
      if (!member?.roomId) return;
      await client.joinRoom(member.roomId);
      logger.info("Joined room", { roomId: member.roomId });
    } catch (err) {
      logger.warn("Failed to auto-join room", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  client.on("Room.timeline" as any, async (event: MatrixEvent, room: Room, toStartOfTimeline: boolean) => {
    try {
      if (toStartOfTimeline) return;
      if (!event) return;
      if (event.getType?.() !== "m.room.message") return;
      if (event.getSender?.() === client.getUserId()) return;
      if (roomIds && room && !roomIds.includes(room.roomId)) return;

      const content = (event as any).getContent?.() ?? (event as any).event?.content;
      if (!content || content.msgtype !== "m.text") return;

      const externalUserId = String(event.getSender?.() || "");

      const text = String(content.body || "").trim();
      if (!text) return;

      const roomId = room?.roomId;
      if (!roomId) return;

      if (!gatewayToken || instance.id <= 0) {
        await sendText(client, roomId, "Gateway auth is not configured for this interface. Create/enable the interface in the admin panel.");
        return;
      }

      await sendText(client, roomId, "…");

      let buffer = "";
      let finalText = "";
      let receiptText = "";

      for await (const evt of streamGatewayChat({
        baseUrl: getGatewayBaseUrl(),
        interfaceId: instance.id,
        interfaceToken: gatewayToken,
        body: {
          message: text,
          externalChatId: roomId,
          externalUserId: externalUserId,
          externalUsername: externalUserId,
          planMode: false,
          attachments: [],
        },
      })) {
        if (evt.type === "text_delta") {
          buffer += evt.text || "";
        } else if (evt.type === "tool_receipt") {
          receiptText = evt.text;
        } else if (evt.type === "done") {
          finalText = evt.fullText || buffer;
        } else if (evt.type === "error") {
          await sendText(client, roomId, `Error: ${evt.error || "Unknown error"}`);
          return;
        }
      }

      const chunks = splitText(finalText || "(no output)", MAX_MATRIX_MESSAGE);
      for (const ch of chunks) {
        await sendText(client, roomId, ch);
      }
      if (receiptText) {
        const rchunks = splitText(receiptText, MAX_MATRIX_MESSAGE);
        for (const ch of rchunks) {
          await sendText(client, roomId, ch);
        }
      }

      recordChannelEvent({
        channel: "matrix",
        event: "message_processing",
        ok: true,
        details: {
          interfaceId: instance.id,
          ownerUserId: String(instance.owner_user_id),
          externalChatId: roomId,
          responseLength: finalText?.length,
        },
      });
    } catch (err) {
      logger.error("Matrix message handling failed", {
        interfaceId: instance.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  client.startClient({ initialSyncLimit: 10 } as any);
  logger.info("Matrix instance started", {
    interfaceId: instance.id,
    ownerUserId: instance.owner_user_id,
  });
}

async function main() {
  const instances = getActiveMatrixInterfaces();
  if (instances.length === 0) {
    createBotLogger("matrix").info(
      "Matrix interface not enabled; no active interface rows found.",
    );
    process.exit(0);
  }

  await Promise.all(instances.map((i) => startMatrixInstance(i)));
}

main().catch((err) => {
  createBotLogger("matrix").error("Matrix runner failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
