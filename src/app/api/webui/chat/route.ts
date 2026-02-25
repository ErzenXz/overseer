import { randomUUID } from "crypto";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { getCurrentUser } from "@/lib/auth";
import { runGatewayChat } from "@/gateway/chat-core";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const logger = createLogger("webui-chat");

type Steering = {
  tone?: "concise" | "balanced" | "deep";
  responseStyle?: "direct" | "explanatory" | "mentor";
  includeReasoningSummary?: boolean;
  prioritizeSafety?: boolean;
  requireChecklist?: boolean;
};

function parseConversationId(rawId: unknown): number | undefined {
  if (typeof rawId !== "string" && typeof rawId !== "number") return undefined;
  const parsed = Number.parseInt(String(rawId), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function extractLastUserText(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";

  const text = (Array.isArray(lastUser.parts) ? lastUser.parts : [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? (body.messages as UIMessage[]) : [];
  const providerId = typeof body?.providerId === "number" ? body.providerId : undefined;
  const steering = (body?.steering ?? undefined) as Steering | undefined;
  const conversationId = parseConversationId(body?.id);

  const message = extractLastUserText(messages);
  if (!message) {
    const emptyStream = createUIMessageStream<UIMessage>({
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });

    return createUIMessageStreamResponse({ stream: emptyStream });
  }

  logger.info("WebUI gateway chat request", {
    userId: user.id,
    providerId,
    conversationId,
    messageLength: message.length,
    hasSteering: !!steering,
  });

  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      const textPartId = randomUUID();
      let textStarted = false;
      let finished = false;

      const pendingToolCallsByName = new Map<string, string[]>();

      const ensureTextStarted = () => {
        if (textStarted) return;
        writer.write({ type: "text-start", id: textPartId });
        textStarted = true;
      };

      const ensureToolCallId = (toolName: string) => {
        const queue = pendingToolCallsByName.get(toolName) ?? [];
        if (queue.length > 0) {
          const existing = queue.shift()!;
          pendingToolCallsByName.set(toolName, queue);
          return existing;
        }

        const fallbackId = `tool-${randomUUID()}`;
        writer.write({
          type: "tool-input-available",
          toolName,
          toolCallId: fallbackId,
          input: {},
          dynamic: true,
        } satisfies UIMessageChunk);
        return fallbackId;
      };

      const finishOnce = (reason: "stop" | "error") => {
        if (finished) return;
        finished = true;

        if (textStarted) {
          writer.write({ type: "text-end", id: textPartId });
        }

        writer.write({ type: "finish", finishReason: reason });
      };

      try {
        writer.write({ type: "start" });

        await runGatewayChat(
          { kind: "web", webUserId: user.id },
          {
            message,
            conversationId,
            providerId,
            steering,
            attachments: [],
          },
          {
            emit: (event) => {
              switch (event.type) {
                case "text_delta": {
                  ensureTextStarted();
                  writer.write({
                    type: "text-delta",
                    id: textPartId,
                    delta: event.text,
                  });
                  break;
                }

                case "tool_call": {
                  const toolCallId = `tool-${randomUUID()}`;
                  const queue = pendingToolCallsByName.get(event.toolName) ?? [];
                  queue.push(toolCallId);
                  pendingToolCallsByName.set(event.toolName, queue);

                  writer.write({
                    type: "tool-input-available",
                    toolName: event.toolName,
                    toolCallId,
                    input: event.args,
                    dynamic: true,
                  } satisfies UIMessageChunk);
                  break;
                }

                case "tool_result": {
                  const toolCallId = ensureToolCallId(event.toolName);
                  writer.write({
                    type: "tool-output-available",
                    toolCallId,
                    output: event.result,
                    dynamic: true,
                  } satisfies UIMessageChunk);
                  break;
                }

                case "conversation_id": {
                  writer.write({
                    type: "message-metadata",
                    messageMetadata: { conversationId: event.conversationId },
                  });
                  break;
                }

                case "done": {
                  finishOnce("stop");
                  break;
                }

                case "error": {
                  writer.write({
                    type: "error",
                    errorText: event.error,
                  });
                  finishOnce("error");
                  break;
                }

                // Currently ignored in WebUI message rendering.
                case "stream_initialized":
                case "tool_receipt":
                case "session_summarized":
                case "session_rollover":
                  break;
              }
            },
          },
        );

        finishOnce("stop");
      } catch (error) {
        const errorText = error instanceof Error ? error.message : "Unknown error";
        logger.error("WebUI gateway stream failed", {
          userId: user.id,
          conversationId,
          error: errorText,
        });

        writer.write({ type: "error", errorText });
        finishOnce("error");
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
