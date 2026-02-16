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
  conversationsModel,
  interfacesModel,
  messagesModel,
  usersModel,
} from "../database/index";
import { runAgentStream } from "../agent/agent";
import { createBotLogger, splitText } from "./shared";
import { SessionManager, estimateTokens } from "../lib/session-manager";
import { getRateLimiter } from "../lib/rate-limiter";
import { recordChannelEvent } from "../lib/channel-observability";
import { getDefaultModel } from "../agent/providers";
import { withToolContext } from "../lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "../lib/userfs";
import { hasAnyPermission, Permission } from "../lib/permissions";
import { extractMemoriesFromConversation } from "../agent/super-memory";

import sdk, {
  MsgType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";

dotenvConfig({ path: resolve(process.cwd(), ".env") });
initializeSchema();

const MAX_MATRIX_MESSAGE = 3500;

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
    return [
      {
        id: -1,
        owner_user_id: getFallbackOwnerUserId(),
        name: "Matrix (env)",
        config: {
          homeserver: process.env.MATRIX_HOMESERVER,
          access_token: process.env.MATRIX_ACCESS_TOKEN,
        },
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

function isAllowedUser(userId: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.includes(userId);
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
  const owner = usersModel.findById(instance.owner_user_id);
  const allowSystem = owner
    ? hasAnyPermission(owner, [
        Permission.SYSTEM_SHELL,
        Permission.SYSTEM_FILES_READ,
        Permission.SYSTEM_FILES_WRITE,
        Permission.SYSTEM_FILES_DELETE,
      ])
    : false;
  const logger = createBotLogger("matrix", instance.owner_user_id);

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

  const sandboxRoot = getUserSandboxRoot({
    kind: "web",
    id: String(instance.owner_user_id),
  });
  ensureDir(sandboxRoot);

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
      if (!isAllowedUser(externalUserId, instance.allowed_users)) return;

      const text = String(content.body || "").trim();
      if (!text) return;

      const roomId = room?.roomId;
      if (!roomId) return;

      const rateLimiter = getRateLimiter();
      const estimatedTokenCount = estimateTokens(text);
      const activeModelId =
        (getDefaultModel() as { modelId?: string } | null)?.modelId || "default";

      const preCheck = await rateLimiter.checkLimit({
        userId: String(instance.owner_user_id),
        interfaceType: "matrix",
        tokens: estimatedTokenCount,
        modelId: activeModelId,
      });

      if (!preCheck.allowed) {
        await sendText(
          client,
          roomId,
          rateLimiter.getErrorMessage(preCheck) ||
            preCheck.reason ||
            "Rate limit exceeded",
        );
        return;
      }

      const conversation = conversationsModel.findOrCreate({
        owner_user_id: instance.owner_user_id,
        interface_id: instance.id > 0 ? instance.id : undefined,
        interface_type: "matrix",
        external_chat_id: roomId,
        external_user_id: externalUserId,
        external_username: externalUserId,
        metadata: { interfaceName: instance.name },
      });

      const session = SessionManager.getOrCreateSession({
        conversation_id: conversation.id,
        interface_type: "matrix",
        external_user_id: externalUserId,
        external_chat_id: roomId,
        metadata: { interfaceId: instance.id, ownerUserId: instance.owner_user_id },
      });

      SessionManager.addMessage(session.id, "user", text);
      messagesModel.create({
        conversation_id: conversation.id,
        role: "user",
        content: text,
      });

      // Minimal "thinking" notice (plain text).
      await sendText(client, roomId, "Thinking...");

      const { fullText, usage } = await withToolContext(
        {
          sandboxRoot,
          allowSystem,
          actor: { kind: "web", id: String(instance.owner_user_id) },
          conversationId: conversation.id,
          agentSessionId: session.session_id,
          interface: {
            type: "matrix",
            id: instance.id,
            externalChatId: roomId,
            externalUserId: externalUserId,
          },
        },
        () =>
          runAgentStream(text, {
            conversationId: conversation.id,
            planMode: false,
            sandboxRoot,
            allowSystem,
            actor: { kind: "web", id: String(instance.owner_user_id) },
            onToolCall: () => SessionManager.recordToolCall(session.id),
          }),
      );

      const finalText = (await fullText) || "";
      const chunks = splitText(finalText || "(no output)", MAX_MATRIX_MESSAGE);
      for (const ch of chunks) {
        await sendText(client, roomId, ch);
      }

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
          interfaceType: "matrix",
          inputTokens: usageData.inputTokens,
          outputTokens: usageData.outputTokens,
          model: activeModelId,
        });
      }

      extractMemoriesFromConversation(
        instance.owner_user_id,
        `user: ${text}\n\nassistant: ${finalText}`,
      ).catch(() => {});

      recordChannelEvent({
        channel: "matrix",
        event: "message_processing",
        ok: true,
        details: {
          interfaceId: instance.id,
          ownerUserId: String(instance.owner_user_id),
          conversationId: conversation.id,
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
