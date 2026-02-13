import { mkdirSync } from "fs";
import { resolve, join, relative } from "path";

function safeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getUserSandboxRoot(input: {
  kind: "web" | "external";
  id: string;
  interfaceType?: string;
}): string {
  const base = resolve(process.cwd(), "data", "userfs");
  if (input.kind === "web") {
    return join(base, "web", safeSegment(input.id));
  }
  const iface = safeSegment(input.interfaceType || "unknown");
  return join(base, iface, safeSegment(input.id));
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function resolveInSandbox(sandboxRoot: string, userPath: string): string {
  const root = resolve(sandboxRoot);
  const candidate = resolve(root, userPath);
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !rel.includes(".."))) {
    return candidate;
  }
  throw new Error("Path escapes sandbox root");
}

