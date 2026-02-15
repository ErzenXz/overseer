import { AsyncLocalStorage } from "node:async_hooks";

export interface ToolContext {
  sandboxRoot?: string;
  allowSystem?: boolean;
  actor?: {
    kind: "web" | "external";
    id: string;
    interfaceType?: string;
  };

  // Optional correlation identifiers so tools (especially subagents/tasks) can
  // reliably link work back to a specific tenant conversation/session.
  conversationId?: number;
  agentSessionId?: string; // canonical agent_sessions.session_id (e.g. "conversation:16")
  interface?: {
    type?: string;
    id?: number;
    externalChatId?: string;
    externalUserId?: string;
  };
}

const storage = new AsyncLocalStorage<ToolContext>();

export function withToolContext<T>(ctx: ToolContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getToolContext(): ToolContext | undefined {
  return storage.getStore();
}
