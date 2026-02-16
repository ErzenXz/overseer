export type GatewayEvent =
  | { type: "stream_initialized"; conversationId?: number; sessionId?: number }
  | { type: "conversation_id"; conversationId: number }
  | { type: "tool_call"; toolName: string; args: unknown }
  | { type: "tool_result"; toolName: string; result: unknown }
  | { type: "text_delta"; text: string }
  | { type: "tool_receipt"; text: string }
  | { type: "session_summarized"; sessionId: number; messagesSummarized: number }
  | {
      type: "session_rollover";
      previousSessionId: number;
      newSessionId: number;
      reason: string;
    }
  | {
      type: "done";
      fullText: string;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; error: string; issueId?: string };

export function encodeSseData(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
