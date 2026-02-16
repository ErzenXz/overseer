import type { GatewayEvent } from "./sse";

export interface StreamGatewayChatInput {
  baseUrl: string;
  interfaceId: number;
  interfaceToken: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export async function* streamGatewayChat(
  input: StreamGatewayChatInput,
): AsyncGenerator<GatewayEvent> {
  const url = joinUrl(input.baseUrl, "/api/gateway/chat");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-overseer-interface-id": String(input.interfaceId),
      "x-overseer-interface-token": input.interfaceToken,
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });

  if (!res.ok) {
    let msg = `Gateway request failed (${res.status})`;
    try {
      const j = (await res.json()) as any;
      if (j?.error) msg = String(j.error);
    } catch {}
    yield { type: "error", error: msg };
    return;
  }

  if (!res.body) {
    yield { type: "error", error: "Gateway response body is missing" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });

    // SSE events are separated by blank lines.
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const lines = block.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const json = trimmed.slice("data:".length).trim();
        if (!json) continue;
        try {
          const evt = JSON.parse(json) as GatewayEvent;
          yield evt;
        } catch {
          // ignore malformed event
        }
      }
    }
  }

  // Flush any remaining complete event
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const json = tail.slice("data:".length).trim();
    try {
      const evt = JSON.parse(json) as GatewayEvent;
      yield evt;
    } catch {}
  }
}

