import { NextRequest, NextResponse } from "next/server";
import type { UIMessage } from "ai";
import { conversationsModel, messagesModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";

type StoredToolCall = {
  name?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
};

function safeParseToolCalls(raw: string | null): StoredToolCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredToolCall[]) : [];
  } catch {
    return [];
  }
}

function toTextParts(content: string) {
  const text = String(content ?? "");
  if (!text.trim()) return [] as Array<{ type: "text"; text: string }>;
  return [{ type: "text" as const, text }];
}

function dbMessageToUIMessage(message: {
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls: string | null;
}): UIMessage {
  if (message.role === "user") {
    return {
      id: `db-${message.id}`,
      role: "user",
      parts: toTextParts(message.content),
    };
  }

  if (message.role === "system") {
    return {
      id: `db-${message.id}`,
      role: "system",
      parts: toTextParts(message.content),
    };
  }

  const toolCalls = safeParseToolCalls(message.tool_calls);

  const toolParts = toolCalls.map((toolCall, idx) => {
    const toolName = String(toolCall.name ?? toolCall.toolName ?? "tool");
    const toolCallId = `db-tool-${message.id}-${idx}`;

    if (toolCall.result !== undefined) {
      return {
        type: "dynamic-tool" as const,
        toolName,
        toolCallId,
        state: "output-available" as const,
        input: toolCall.args ?? {},
        output: toolCall.result,
      };
    }

    return {
      type: "dynamic-tool" as const,
      toolName,
      toolCallId,
      state: "input-available" as const,
      input: toolCall.args ?? {},
    };
  });

  return {
    id: `db-${message.id}`,
    role: "assistant",
    parts: [...toolParts, ...toTextParts(message.content)],
  };
}

function parseConversationId(threadId: string): number | null {
  const parsed = Number.parseInt(threadId, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  const conversationId = parseConversationId(threadId);
  if (!conversationId) {
    return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  }

  const conversation = conversationsModel.findById(conversationId);
  if (!conversation || conversation.interface_type !== "web" || conversation.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const dbMessages = messagesModel.findByConversation(conversationId, 300);
  const uiMessages = dbMessages.map((message) => dbMessageToUIMessage(message));

  // Expected by runtime.thread.importExternalState in useChatRuntime/@assistant-ui/react-ai-sdk.
  let parentId: string | null = null;
  const externalState = {
    messages: uiMessages.map((message) => {
      const item = {
        parentId,
        message,
      };
      parentId = message.id;
      return item;
    }),
    headId: uiMessages.length > 0 ? uiMessages[uiMessages.length - 1]!.id : null,
  };

  return NextResponse.json({ externalState });
}
