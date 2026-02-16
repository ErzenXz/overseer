import { NextRequest } from "next/server";
import { createLogger } from "@/lib/logger";
import { interfacesModel } from "@/database";
import { runGatewayChat } from "@/gateway/chat-core";
import { encodeSseData, type GatewayEvent } from "@/gateway/sse";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("gateway-api");

export async function POST(request: NextRequest) {
  const interfaceIdRaw = request.headers.get("x-overseer-interface-id") || "";
  const token = request.headers.get("x-overseer-interface-token") || "";
  const interfaceId = Number.parseInt(interfaceIdRaw, 10);

  if (!Number.isFinite(interfaceId) || interfaceId <= 0 || !token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const iface = interfacesModel.findById(interfaceId);
  if (!iface || iface.is_active !== 1) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cfg = interfacesModel.getDecryptedConfig(interfaceId) || {};
  const expected = typeof cfg.gateway_token === "string" ? cfg.gateway_token : "";
  if (!expected || expected !== token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = body?.message;
  const externalChatId = body?.externalChatId;
  const externalUserId = body?.externalUserId;
  const externalUsername = body?.externalUsername ?? null;
  const planMode = Boolean(body?.planMode);
  const steering = body?.steering;
  const providerId = typeof body?.providerId === "number" ? body.providerId : undefined;
  const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!externalChatId || typeof externalChatId !== "string") {
    return new Response(JSON.stringify({ error: "externalChatId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!externalUserId || typeof externalUserId !== "string") {
    return new Response(JSON.stringify({ error: "externalUserId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: GatewayEvent) => {
        controller.enqueue(encoder.encode(encodeSseData(event)));
      };

      try {
        await runGatewayChat(
          {
            kind: "interface",
            interfaceId,
            interfaceType: iface.type,
            externalChatId,
            externalUserId,
            externalUsername,
          },
          {
            message,
            planMode,
            steering,
            providerId,
            attachments,
          },
          { emit },
        );
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const issueId = randomUUID();
        logger.error("Gateway chat error", { interfaceId, error: msg });
        emit({ type: "error", error: msg, issueId });
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
}
