import { AsyncLocalStorage } from "node:async_hooks";

export interface ToolContext {
  sandboxRoot?: string;
  allowSystem?: boolean;
  actor?: {
    kind: "web" | "external";
    id: string;
    interfaceType?: string;
  };
}

const storage = new AsyncLocalStorage<ToolContext>();

export function withToolContext<T>(ctx: ToolContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getToolContext(): ToolContext | undefined {
  return storage.getStore();
}

