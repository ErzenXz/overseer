import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { runAgentStream } from "@/agent";
import { conversationsModel, messagesModel } from "@/database";
import { getModelById } from "@/agent/providers";
import { createLogger } from "@/lib/logger";
import { resumableStreams } from "@/lib/resumable-streams";
import { getRateLimiter } from "@/lib/rate-limiter";
import { estimateTokens, SessionManager } from "@/lib/session-manager";
import { extractMemoriesFromConversation } from "@/agent/super-memory";
import { withToolContext } from "@/lib/tool-context";
import { ensureDir, getUserSandboxRoot } from "@/lib/userfs";
import { hasAnyPermission, hasPermission, Permission } from "@/lib/permissions";

const logger = createLogger("chat-api");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Streaming chat endpoint
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      message,
      conversationId: existingConversationId,
      providerId,
      planMode,
      steering,
      streamId: requestedStreamId,
    } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 },
      );
    }

    // Get or create conversation
    let conversationId = existingConversationId;
    let conversation;

    if (conversationId) {
      conversation = conversationsModel.findById(conversationId);
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
      if (!canViewAll && conversation.owner_user_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      // Create new conversation for web chat (per web user)
      conversation = conversationsModel.findOrCreate({
        owner_user_id: user.id,
        interface_type: "web",
        external_chat_id: `web-${user.id}-${Date.now()}`,
        external_user_id: String(user.id),
        external_username: user.username,
        title: message.slice(0, 100),
      });
      conversationId = conversation.id;
    }

    // Save user message
    messagesModel.create({
      conversation_id: conversationId,
      role: "user",
      content: message,
    });

    // Get model
    const model = providerId ? getModelById(providerId) : undefined;
    const modelId =
      (model as { modelId?: string } | undefined)?.modelId || "default";

    // Check multi-tier limits and user policy before starting the stream
    const rateLimiter = getRateLimiter();
    const preCheck = await rateLimiter.checkLimit({
      userId: user.username,
      interfaceType: "web",
      tokens: estimateTokens(message),
      modelId,
    });

    if (!preCheck.allowed) {
      return NextResponse.json(
        {
          error:
            rateLimiter.getErrorMessage(preCheck) ||
            preCheck.reason ||
            "Rate limit exceeded",
        },
        { status: 429 },
      );
    }

    logger.info("Starting chat stream", {
      conversationId,
      providerId,
      messageLength: message.length,
      planMode: Boolean(planMode),
    });

    // Ensure there is an active session for this conversation (web interface)
    const session = SessionManager.getOrCreateSession({
      conversation_id: conversationId,
      interface_type: "web",
      external_user_id: String(user.id),
      external_chat_id: `web-${user.username}-${conversationId}`,
      metadata: {
        source: "web-chat",
      },
    });

    SessionManager.addMessage(session.id, "user", message, {
      source: "web-chat",
      providerId: providerId ?? null,
      planMode: Boolean(planMode),
    });

    const streamId = requestedStreamId || randomUUID();
    resumableStreams.create(streamId, conversationId);

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: unknown) => {
          const seq = resumableStreams.appendEvent(streamId, event);
          const payload = {
            ...(event as Record<string, unknown>),
            seq,
            streamId,
          };
          const line = `data: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(line));
        };

        try {
          sendEvent({
            type: "stream_initialized",
            conversationId,
            sessionId: session.id,
          });

          // Send conversation ID if newly created
          if (!existingConversationId) {
            sendEvent({
              type: "conversation_id",
              conversationId,
            });
          }

          let fullText = "";
          const toolCalls: { name: string; args: unknown; result?: unknown }[] =
            [];

          const sandboxRoot = getUserSandboxRoot({
            kind: "web",
            id: String(user.id),
          });
          ensureDir(sandboxRoot);

          const allowSystem = hasAnyPermission(user, [
            Permission.SYSTEM_SHELL,
            Permission.SYSTEM_FILES_READ,
            Permission.SYSTEM_FILES_WRITE,
            Permission.SYSTEM_FILES_DELETE,
          ]);

          const result = await withToolContext(
            {
              sandboxRoot,
              allowSystem,
              actor: { kind: "web", id: String(user.id) },
            },
            () =>
              runAgentStream(message, {
                conversationId,
                model: model || undefined,
                planMode: planMode === undefined ? true : Boolean(planMode),
                steering,
                sandboxRoot,
                allowSystem,
                actor: { kind: "web", id: String(user.id) },
                onToolCall: (toolName, args) => {
                  SessionManager.recordToolCall(session.id);
                  sendEvent({
                    type: "tool_call",
                    toolName,
                    args,
                  });
                  toolCalls.push({ name: toolName, args });
                },
                onToolResult: (toolName, result) => {
                  sendEvent({
                    type: "tool_result",
                    toolName,
                    result:
                      typeof result === "string" ? result.slice(0, 500) : result,
                  });

                  // Update tool call with result
                  const tc = toolCalls.find(
                    (t) => t.name === toolName && t.result === undefined,
                  );
                  if (tc) {
                    tc.result = result;
                  }
                },
              }),
          );

          // Stream text
          for await (const chunk of result.textStream) {
            fullText += chunk;
            sendEvent({
              type: "text_delta",
              text: chunk,
            });
          }

          // Wait for final text
          const finalText = await result.fullText;
          const usage = await result.usage;

          // Save assistant message
          messagesModel.create({
            conversation_id: conversationId,
            role: "assistant",
            content: finalText,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            input_tokens: usage?.inputTokens,
            output_tokens: usage?.outputTokens,
          });

          const summariesBefore =
            SessionManager.getSession(session.id)?.summaries.length ?? 0;
          const updatedSession = SessionManager.addMessage(
            session.id,
            "assistant",
            finalText,
            {
              source: "web-chat",
              usage,
              model: modelId,
            },
          );

          const summariesAfter =
            updatedSession?.summaries.length ?? summariesBefore;
          if (summariesAfter > summariesBefore) {
            const latestSummary = updatedSession?.summaries[summariesAfter - 1];
            sendEvent({
              type: "session_summarized",
              sessionId: session.id,
              messagesSummarized: latestSummary?.messages_summarized ?? 0,
            });
          }

          if (
            updatedSession &&
            updatedSession.total_tokens >= updatedSession.token_limit * 0.95
          ) {
            const nextSession = SessionManager.rolloverSession(session.id, {
              trigger: "context_limit_reached",
            });

            if (nextSession) {
              sendEvent({
                type: "session_rollover",
                previousSessionId: session.id,
                newSessionId: nextSession.id,
                reason: "context_limit_reached",
              });
            }
          }

          if (usage) {
            rateLimiter.recordRequest({
              userId: String(user.id),
              interfaceType: "web",
              conversationId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              model: modelId,
            });
          }

          // Send done event
          sendEvent({
            type: "done",
            fullText: finalText,
            usage,
          });

          // Fire-and-forget: extract memories from this exchange
          extractMemoriesFromConversation(
            user.id,
            `user: ${message}\n\nassistant: ${finalText}`,
          ).catch((err) =>
            logger.warn("Memory extraction failed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          );

          resumableStreams.complete(streamId, "completed");

          controller.close();
        } catch (error) {
          logger.error("Chat stream error", {
            error: error instanceof Error ? error.message : String(error),
          });

          SessionManager.recordError(session.id);

          sendEvent({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          resumableStreams.complete(streamId, "error");
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logger.error("Chat API error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Get active providers for model selection
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const streamId = searchParams.get("streamId");
    const fromSeq = Number(searchParams.get("from") ?? "0");

    if (streamId) {
      const status = resumableStreams.getStatus(streamId);
      if (!status) {
        return NextResponse.json(
          { error: "Stream not found" },
          { status: 404 },
        );
      }

      const events = resumableStreams.getFrom(
        streamId,
        Number.isFinite(fromSeq) ? fromSeq : 0,
      );
      return NextResponse.json({
        streamId,
        conversationId: status.conversation_id,
        status: status.status,
        updatedAt: status.updated_at,
        events,
      });
    }

    const { providersModel } = await import("@/database");
    const { getModelInfo } = await import("@/agent/provider-info");
    const { findDynamicModelInfo } =
      await import("@/agent/dynamic-provider-catalog");
    const providers = providersModel.findActive();

    return NextResponse.json({
      providers: await Promise.all(
        providers.map(async (p) => {
          const dynamicInfo = await findDynamicModelInfo(p.name, p.model);
          const modelInfo =
            dynamicInfo ??
            getModelInfo(p.name as Parameters<typeof getModelInfo>[0], p.model);
          return {
            id: p.id,
            name: p.name,
            displayName: p.display_name,
            model: p.model,
            isDefault: p.is_default,
            // Model capability fields (undefined if model not found in registry)
            supportsThinking: modelInfo?.supportsThinking ?? false,
            supportsTools: modelInfo?.supportsTools ?? false,
            supportsMultimodal: modelInfo?.supportsMultimodal ?? false,
            reasoning: modelInfo?.reasoning ?? false,
            costTier: modelInfo?.costTier ?? "medium",
            contextWindow: modelInfo?.contextWindow ?? 0,
            maxOutput: modelInfo?.maxOutput ?? 0,
          };
        }),
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
