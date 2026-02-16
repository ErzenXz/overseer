import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { conversationsModel, messagesModel } from "@/database";
import { createLogger } from "@/lib/logger";
import { resumableStreams } from "@/lib/resumable-streams";
import { hasPermission, Permission } from "@/lib/permissions";
import { runGatewayChat } from "@/gateway/chat-core";
import type { GatewayEvent } from "@/gateway/sse";

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
      attachments,
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
    // (handled by gateway core)

    logger.info("Starting chat stream", {
      conversationId,
      providerId,
      messageLength: message.length,
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
          // Send conversation ID if newly created
          if (!existingConversationId) {
            sendEvent({
              type: "conversation_id",
              conversationId,
            });
          }

          const emit = (evt: GatewayEvent) => {
            // Preserve legacy behavior: truncate large string tool results in the web stream.
            if (evt.type === "tool_result" && typeof evt.result === "string") {
              sendEvent({
                ...evt,
                result: evt.result.slice(0, 500),
              });
              return;
            }
            sendEvent(evt);
          };

          await runGatewayChat(
            { kind: "web", webUserId: user.id },
            {
              message,
              conversationId,
              providerId,
              planMode: Boolean(planMode),
              steering,
              attachments: Array.isArray(attachments) ? attachments : [],
            },
            { emit, streamId },
          );

          resumableStreams.complete(streamId, "completed");

          controller.close();
        } catch (error) {
          logger.error("Chat stream error", {
            error: error instanceof Error ? error.message : String(error),
          });

          const issueId = randomUUID();
          sendEvent({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
            issueId,
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
