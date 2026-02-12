import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as mcpClient from "@/agent/mcp/client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseKeyValueLines(raw: string, separator: ":" | "=") {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

async function createMcpServerAction(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const serverType = String(formData.get("server_type") ?? "stdio").trim().toLowerCase();
  const command = String(formData.get("command") ?? "").trim();
  const argsRaw = String(formData.get("args") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const envVarsRaw = String(formData.get("env_vars") ?? "").trim();
  const headersRaw = String(formData.get("headers") ?? "").trim();
  const autoConnect = String(formData.get("auto_connect") ?? "") === "on";

  if (!name) {
    redirect("/mcp/add?error=Server%20name%20is%20required");
  }

  if (serverType !== "stdio" && serverType !== "sse") {
    redirect("/mcp/add?error=Invalid%20server%20type");
  }

  if (serverType === "stdio" && !command) {
    redirect("/mcp/add?error=Command%20is%20required%20for%20STDIO%20servers");
  }

  if (serverType === "sse" && !url) {
    redirect("/mcp/add?error=URL%20is%20required%20for%20SSE%20servers");
  }

  const args = argsRaw
    ? argsRaw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;

  const envVars = envVarsRaw ? parseKeyValueLines(envVarsRaw, "=") : undefined;
  const headers = headersRaw ? parseKeyValueLines(headersRaw, ":") : undefined;

  const created = mcpClient.createServer({
    name,
    server_type: serverType as "stdio" | "sse",
    command: serverType === "stdio" ? command : undefined,
    args,
    env_vars: envVars,
    url: serverType === "sse" ? url : undefined,
    headers,
    auto_connect: autoConnect,
  });

  if (autoConnect) {
    await mcpClient.connectToServer(created.id);
  }

  revalidatePath("/mcp");
  redirect("/mcp/add?success=MCP%20server%20created%20successfully");
}

export default async function AddMcpServerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const success = typeof params.success === "string" ? params.success : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Add MCP Server</h1>
          <p className="text-text-secondary mt-1 text-pretty">
            Register a new Model Context Protocol server and optionally connect immediately.
          </p>
        </div>
        <Link
          href="/mcp"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back to MCP
        </Link>
      </div>

      <div className="max-w-3xl bg-surface-raised border border-border rounded-lg p-6">
        <form action={createMcpServerAction} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="block text-sm text-white mb-2">
                Server name
              </label>
              <input
                id="name"
                name="name"
                required
                placeholder="filesystem-tools"
                className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="server_type" className="block text-sm text-white mb-2">
                Transport type
              </label>
              <select
                id="server_type"
                name="server_type"
                defaultValue="stdio"
                className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="stdio">STDIO</option>
                <option value="sse">SSE</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="command" className="block text-sm text-white mb-2">
              Command (for STDIO)
            </label>
            <input
              id="command"
              name="command"
              placeholder="npx"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="args" className="block text-sm text-white mb-2">
              Args (comma separated)
            </label>
            <input
              id="args"
              name="args"
              placeholder="-y,@modelcontextprotocol/server-filesystem,/path"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="url" className="block text-sm text-white mb-2">
              SSE URL
            </label>
            <input
              id="url"
              name="url"
              placeholder="https://mcp.example.com/sse"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="env_vars" className="block text-sm text-white mb-2">
                Env vars (one per line: KEY=VALUE)
              </label>
              <textarea
                id="env_vars"
                name="env_vars"
                rows={4}
                className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="headers" className="block text-sm text-white mb-2">
                Headers (one per line: Name: Value)
              </label>
              <textarea
                id="headers"
                name="headers"
                rows={4}
                className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              name="auto_connect"
              type="checkbox"
              className="rounded border-border bg-surface-overlay text-accent focus:ring-accent"
            />
            Connect immediately after saving
          </label>

          {error ? <p className="text-sm text-red-400 text-pretty">{error}</p> : null}
          {success ? <p className="text-sm text-green-400 text-pretty">{success}</p> : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium transition-colors"
            >
              Add server
            </button>
            <p className="text-xs text-text-muted text-pretty">
              For STDIO, provide command + args. For SSE, provide URL and optional headers.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
