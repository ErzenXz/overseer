import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runAgentStream } from "@/agent";
import { conversationsModel, messagesModel } from "@/database";
import { getModelById } from "@/agent/providers";
import { createLogger } from "@/lib/logger";

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
    const { message, conversationId: existingConversationId, providerId } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Get or create conversation
    let conversationId = existingConversationId;
    let conversation;

    if (conversationId) {
      conversation = conversationsModel.findById(conversationId);
      if (!conversation) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
    } else {
      // Create new conversation for web chat
      conversation = conversationsModel.findOrCreate({
        interface_type: "web",
        external_chat_id: `web-${user.username}-${Date.now()}`,
        external_user_id: user.username,
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

    logger.info("Starting chat stream", {
      conversationId,
      providerId,
      messageLength: message.length,
    });

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send conversation ID if newly created
          if (!existingConversationId) {
            const idEvent = `data: ${JSON.stringify({
              type: "conversation_id",
              conversationId,
            })}\n\n`;
            controller.enqueue(encoder.encode(idEvent));
          }

          let fullText = "";
          const toolCalls: { name: string; args: unknown; result?: unknown }[] = [];

          const result = await runAgentStream(message, {
            conversationId,
            model: model || undefined,
            onToolCall: (toolName, args) => {
              const event = `data: ${JSON.stringify({
                type: "tool_call",
                toolName,
                args,
              })}\n\n`;
              controller.enqueue(encoder.encode(event));
              toolCalls.push({ name: toolName, args });
            },
            onToolResult: (toolName, result) => {
              const event = `data: ${JSON.stringify({
                type: "tool_result",
                toolName,
                result: typeof result === "string" ? result.slice(0, 500) : result,
              })}\n\n`;
              controller.enqueue(encoder.encode(event));

              // Update tool call with result
              const tc = toolCalls.find(
                (t) => t.name === toolName && t.result === undefined
              );
              if (tc) {
                tc.result = result;
              }
            },
          });

          // Stream text
          for await (const chunk of result.textStream) {
            fullText += chunk;
            const event = `data: ${JSON.stringify({
              type: "text_delta",
              text: chunk,
            })}\n\n`;
            controller.enqueue(encoder.encode(event));
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

          // Send done event
          const doneEvent = `data: ${JSON.stringify({
            type: "done",
            fullText: finalText,
            usage,
          })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));

          controller.close();
        } catch (error) {
          logger.error("Chat stream error", {
            error: error instanceof Error ? error.message : String(error),
          });

          const errorEvent = `data: ${JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
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
      { status: 500 }
    );
  }
}

// Get active providers for model selection
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { providersModel } = await import("@/database");
    const providers = providersModel.findActive();

    return NextResponse.json({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        displayName: p.display_name,
        model: p.model,
        isDefault: p.is_default,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
