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
import { listSkillsWithTools } from "@/agent/skills/registry";

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

type WebUIAttachment = {
  source: "inline";
  fileName: string;
  mimeType?: string;
  base64: string;
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

function parseDataUrl(
  input: string,
): { mimeType?: string; base64: string } | null {
  const match = String(input).match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;

  const mimeType = match[1] || undefined;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  return {
    mimeType,
    base64: isBase64
      ? payload
      : Buffer.from(decodeURIComponent(payload), "utf8").toString("base64"),
  };
}

async function extractLastUserAttachments(
  req: Request,
  messages: UIMessage[],
): Promise<WebUIAttachment[]> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser || !Array.isArray(lastUser.parts)) return [];

  const attachments: WebUIAttachment[] = [];
  for (const part of lastUser.parts) {
    if (part.type !== "file") continue;

    const fileName =
      ("filename" in part && typeof part.filename === "string" && part.filename) ||
      "attachment";
    const mediaType =
      ("mediaType" in part && typeof part.mediaType === "string" && part.mediaType) ||
      undefined;
    const url = "url" in part && typeof part.url === "string" ? part.url : "";
    if (!url) continue;

    const dataUrl = parseDataUrl(url);
    if (dataUrl) {
      attachments.push({
        source: "inline",
        fileName,
        mimeType: dataUrl.mimeType || mediaType,
        base64: dataUrl.base64,
      });
      continue;
    }

    try {
      const target = new URL(url, req.url);
      const res = await fetch(target);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      attachments.push({
        source: "inline",
        fileName,
        mimeType: mediaType || res.headers.get("content-type") || undefined,
        base64: bytes.toString("base64"),
      });
    } catch {
      // Ignore attachment fetch failures and continue with the rest.
    }
  }

  return attachments;
}

function preprocessSlashCommand(rawContent: string): string {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith("/")) return rawContent;

  const activeSkills = listSkillsWithTools().filter((skill) => skill.active);

  if (trimmed === "/skills") {
    if (activeSkills.length === 0) {
      return "List the skills currently available to you. If none are active, say that clearly and continue with your built-in tools.";
    }

    const catalog = activeSkills
      .map((skill) => {
        const tools = skill.tools.length > 0 ? ` tools: ${skill.tools.join(", ")}` : "";
        const triggers = skill.triggers.length > 0 ? ` triggers: ${skill.triggers.join(", ")}` : "";
        return `- ${skill.id}: ${skill.description || skill.name}.${tools}${triggers}`;
      })
      .join("\n");

    return `List the active skills currently available to you and explain when to use each one.\n\nActive skills:\n${catalog}`;
  }

  const explicitSkill = trimmed.match(/^\/skill\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
  if (explicitSkill) {
    const [, skillIdRaw, taskRaw] = explicitSkill;
    const skillId = String(skillIdRaw || "").trim();
    const task = String(taskRaw || "").trim();
    const matched = activeSkills.find((skill) => skill.id === skillId);
    const context = matched
      ? `Skill details: ${matched.name} — ${matched.description || "No description provided."}`
      : `If the skill "${skillId}" is not available, say that briefly and continue with the best available tools.`;

    if (!task) {
      return `Explain what the skill "${skillId}" does, whether it is available, and when it should be used.\n\n${context}`;
    }

    return `Use the skill "${skillId}" if it is available and relevant. Prefer its tools when they fit the task.\n\n${context}\n\nUser task:\n${task}`;
  }

  const shorthand = trimmed.match(/^\/([^\s/]+)(?:\s+([\s\S]+))?$/);
  if (!shorthand) return rawContent;

  const [, command, taskRaw] = shorthand;
  const reserved = new Set(["skills", "skill"]);
  if (reserved.has(command)) return rawContent;

  const matched = activeSkills.find((skill) => skill.id === command);
  if (!matched) return rawContent;

  const task = String(taskRaw || "").trim();
  if (!task) {
    return `Explain what the skill "${matched.id}" does and when it should be used.\n\nSkill details: ${matched.name} — ${matched.description || "No description provided."}`;
  }

  return `Use the skill "${matched.id}" if it is available and relevant. Prefer its tools when they fit the task.\n\nSkill details: ${matched.name} — ${matched.description || "No description provided."}\n\nUser task:\n${task}`;
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

  const attachments = await extractLastUserAttachments(req, messages);
  const rawMessage = extractLastUserText(messages);
  const message = preprocessSlashCommand(rawMessage).trim() || (
    attachments.length > 0
      ? "Please analyze the attached files and use them as context for your answer."
      : ""
  );
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
            attachments,
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
