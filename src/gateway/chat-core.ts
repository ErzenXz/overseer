import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";
import { withToolContext } from "@/lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "@/lib/userfs";
import { hasAnyPermission, Permission } from "@/lib/permissions";
import { getRateLimiter } from "@/lib/rate-limiter";
import { SessionManager, estimateTokens } from "@/lib/session-manager";
import { extractMemoriesFromConversation } from "@/agent/super-memory";
import { runAgentStream } from "@/agent";
import type { AgentOptions } from "@/agent/agent";
import { getModelById } from "@/agent/providers";
import { conversationsModel, interfacesModel, messagesModel, usersModel } from "@/database";
import type { GatewayEvent } from "./sse";
import { formatToolReceiptText } from "./tool-receipts";
import { saveAttachmentsToSandbox, type GatewayAttachment } from "./attachments";

const logger = createLogger("gateway:chat-core");

export interface GatewayAuthContext {
  kind: "web" | "interface";

  // web-authenticated user (for /api/chat)
  webUserId?: number;

  // interface-authenticated worker (for /api/gateway/chat)
  interfaceId?: number;
  interfaceType?: string;
  externalChatId?: string;
  externalUserId?: string;
  externalUsername?: string | null;
}

export interface GatewayChatInput {
  message: string;
  conversationId?: number;
  providerId?: number;
  planMode?: boolean;
  steering?: AgentOptions["steering"];
  attachments?: GatewayAttachment[];
}

export interface GatewayChatResult {
  streamId: string;
  conversationId: number;
  sessionDbId: number;
  sessionExternalId: string;
  finalText: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface GatewayChatDeps {
  emit: (event: GatewayEvent) => void;
  streamId?: string;
}

export async function runGatewayChat(
  auth: GatewayAuthContext,
  input: GatewayChatInput,
  deps: GatewayChatDeps,
): Promise<GatewayChatResult> {
  const streamId = deps.streamId || randomUUID();

  if (!input.message || typeof input.message !== "string") {
    throw new Error("message is required");
  }

  // Resolve tenant + interface metadata.
  let ownerUserId: number;
  let interfaceType: string;
  let interfaceId: number | undefined;
  let externalChatId: string;
  let externalUserId: string;
  let externalUsername: string | null;
  let telegramBotToken: string | null = null;

  if (auth.kind === "web") {
    if (!auth.webUserId) throw new Error("webUserId is required");
    ownerUserId = auth.webUserId;
    interfaceType = "web";
    interfaceId = undefined;
    externalChatId = input.conversationId
      ? `web-${ownerUserId}-${input.conversationId}`
      : `web-${ownerUserId}-${Date.now()}`;
    externalUserId = String(ownerUserId);
    externalUsername = null;
  } else {
    if (!auth.interfaceId) throw new Error("interfaceId is required");
    if (!auth.interfaceType) throw new Error("interfaceType is required");
    if (!auth.externalChatId) throw new Error("externalChatId is required");
    if (!auth.externalUserId) throw new Error("externalUserId is required");

    interfaceId = auth.interfaceId;
    interfaceType = auth.interfaceType;
    externalChatId = auth.externalChatId;
    externalUserId = auth.externalUserId;
    externalUsername = auth.externalUsername ?? null;

    const iface = interfacesModel.findById(interfaceId);
    if (!iface || iface.is_active !== 1) {
      throw new Error("Interface not found or inactive");
    }
    ownerUserId = (iface as any).owner_user_id ?? 1;

    // allowed_users enforcement is gateway-owned (with per-interface normalization where helpful)
    const allowed = interfacesModel.getAllowedUsers(interfaceId);
    if (allowed.length > 0 && !isExternalUserAllowed(interfaceType, externalUserId, allowed)) {
      throw new Error("External user is not allowed on this interface");
    }

    if (interfaceType === "telegram") {
      const cfg = interfacesModel.getDecryptedConfig(interfaceId) || {};
      telegramBotToken = typeof cfg.bot_token === "string" ? cfg.bot_token : null;
    }
  }

  const user = usersModel.findById(ownerUserId);
  if (!user) {
    throw new Error("Owner user not found");
  }

  const allowSystem = hasAnyPermission(user, [
    Permission.SYSTEM_SHELL,
    Permission.SYSTEM_FILES_READ,
    Permission.SYSTEM_FILES_WRITE,
    Permission.SYSTEM_FILES_DELETE,
  ]);

  const sandboxRoot = getUserSandboxRoot({
    kind: "web",
    id: String(ownerUserId),
  });
  ensureDir(sandboxRoot);

  // Conversation: find or create
  const conversation = input.conversationId
    ? conversationsModel.findById(input.conversationId)
    : undefined;

  let conversationId = input.conversationId;
  let convo =
    conversation && (conversation as any).owner_user_id === ownerUserId
      ? conversation
      : null;

  if (!convo) {
    convo = conversationsModel.findOrCreate({
      owner_user_id: ownerUserId,
      interface_id: interfaceId,
      interface_type: interfaceType,
      external_chat_id: externalChatId,
      external_user_id: externalUserId,
      external_username: externalUsername ?? undefined,
      title: input.message.slice(0, 100),
      metadata:
        auth.kind === "interface"
          ? { interfaceId, interfaceType }
          : { source: "web-chat" },
    });
    conversationId = convo.id;
    deps.emit({ type: "conversation_id", conversationId });
  } else {
    conversationId = convo.id;
  }

  // Save user message
  messagesModel.create({
    conversation_id: conversationId!,
    role: "user",
    content: input.message,
  });

  const session = SessionManager.getOrCreateSession({
    conversation_id: conversationId!,
    interface_type: interfaceType,
    interface_id: interfaceId,
    external_user_id: externalUserId,
    external_chat_id: externalChatId,
    metadata: {
      interfaceId,
      interfaceType,
      streamId,
      source: auth.kind,
    },
  });
  SessionManager.addMessage(session.id, "user", input.message, {
    source: auth.kind,
    planMode: Boolean(input.planMode),
    providerId: input.providerId ?? null,
  });

  deps.emit({ type: "stream_initialized", conversationId, sessionId: session.id });

  // Rate limit precheck
  const rateLimiter = getRateLimiter();
  const model = input.providerId ? getModelById(input.providerId) : undefined;
  const modelId = (model as { modelId?: string } | undefined)?.modelId || "default";
  const preCheck = await rateLimiter.checkLimit({
    userId: String(ownerUserId),
    interfaceType,
    tokens: estimateTokens(input.message),
    modelId,
  });
  if (!preCheck.allowed) {
    throw new Error(
      rateLimiter.getErrorMessage(preCheck) || preCheck.reason || "Rate limit exceeded",
    );
  }

  // Attachments
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  let promptAppend = "";
  if (attachments.length > 0) {
    const saved = await saveAttachmentsToSandbox({
      sandboxRoot,
      interfaceType,
      conversationId: conversationId!,
      attachments,
      telegramBotToken,
    });
    promptAppend = saved.promptAppend;
  }

  const toolCalls: { name: string; args: unknown; result?: unknown }[] = [];
  let finalText = "";

  logger.info("Gateway chat start", {
    streamId,
    conversationId,
    interfaceType,
    interfaceId,
    ownerUserId,
    planMode: Boolean(input.planMode),
    attachmentCount: attachments.length,
  });

  const result = await withToolContext(
    {
      sandboxRoot,
      allowSystem,
      actor: { kind: "web", id: String(ownerUserId) },
      conversationId: conversationId!,
      agentSessionId: session.session_id,
      interface: {
        type: interfaceType,
        id: interfaceId,
        externalChatId,
        externalUserId,
      },
    },
    () =>
      runAgentStream(`${input.message}${promptAppend ? `\n\n${promptAppend}` : ""}`.trim(), {
        conversationId: conversationId!,
        model: model || undefined,
        planMode: Boolean(input.planMode),
        steering: input.steering,
        sandboxRoot,
        allowSystem,
        actor: { kind: "web", id: String(ownerUserId) },
        onToolCall: (toolName, args) => {
          SessionManager.recordToolCall(session.id);
          deps.emit({ type: "tool_call", toolName, args });
          toolCalls.push({ name: toolName, args });
        },
        onToolResult: (toolName, toolResult) => {
          deps.emit({ type: "tool_result", toolName, result: toolResult });
          const tc = toolCalls.find((t) => t.name === toolName && t.result === undefined);
          if (tc) tc.result = toolResult;
        },
      }),
  );

  for await (const chunk of result.textStream) {
    finalText += chunk;
    deps.emit({ type: "text_delta", text: chunk });
  }

  const fullText = await result.fullText;
  const usage = await result.usage;

  // Persist assistant message
  messagesModel.create({
    conversation_id: conversationId!,
    role: "assistant",
    content: fullText,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
  });

  const summariesBefore = SessionManager.getSession(session.id)?.summaries.length ?? 0;
  const updatedSession = SessionManager.addMessage(session.id, "assistant", fullText, {
    source: auth.kind,
    usage,
    model: modelId,
  });

  const summariesAfter = updatedSession?.summaries.length ?? summariesBefore;
  if (summariesAfter > summariesBefore) {
    const latestSummary = updatedSession?.summaries[summariesAfter - 1];
    deps.emit({
      type: "session_summarized",
      sessionId: session.id,
      messagesSummarized: latestSummary?.messages_summarized ?? 0,
    });
  }

  if (updatedSession && updatedSession.total_tokens >= updatedSession.token_limit * 0.95) {
    const nextSession = SessionManager.rolloverSession(session.id, {
      trigger: "context_limit_reached",
    });
    if (nextSession) {
      deps.emit({
        type: "session_rollover",
        previousSessionId: session.id,
        newSessionId: nextSession.id,
        reason: "context_limit_reached",
      });
    }
  }

  if (usage) {
    rateLimiter.recordRequest({
      userId: String(ownerUserId),
      interfaceType,
      conversationId: conversationId!,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model: modelId,
    });
  }

  // Tool receipt
  const receipts = await result.toolCalls;
  const receiptText = formatToolReceiptText(receipts);
  if (receiptText) {
    deps.emit({ type: "tool_receipt", text: receiptText });
  }

  deps.emit({ type: "done", fullText, usage });

  extractMemoriesFromConversation(
    ownerUserId,
    `user: ${input.message}\n\nassistant: ${fullText}`,
  ).catch((err) =>
    logger.warn("Memory extraction failed", {
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  return {
    streamId,
    conversationId: conversationId!,
    sessionDbId: session.id,
    sessionExternalId: session.session_id,
    finalText: fullText,
    usage,
  };
}

function normalizeWhatsAppId(raw: string): string {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) return s;
  const digits = s.replace(/\D+/g, "");
  return digits ? `${digits}@s.whatsapp.net` : s;
}

function isExternalUserAllowed(interfaceType: string, externalUserId: string, allowed: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;

  if (interfaceType === "whatsapp") {
    const sender = normalizeWhatsAppId(externalUserId);
    const normalizedAllowed = allowed.map(normalizeWhatsAppId).filter(Boolean);
    return normalizedAllowed.includes(sender);
  }

  return allowed.includes(externalUserId);
}
