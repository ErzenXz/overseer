import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureDir, getUserSandboxRoot, resolveInSandbox } from "@/lib/userfs";
import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "list";
  const path = searchParams.get("path") || ".";

  const sandboxRoot = getUserSandboxRoot({ kind: "web", id: String(user.id) });
  ensureDir(sandboxRoot);

  let abs: string;
  try {
    abs = resolveInSandbox(sandboxRoot, path);
  } catch {
    return jsonError("Invalid path", 400);
  }

  if (action === "read") {
    try {
      const st = await stat(abs);
      if (st.isDirectory()) return jsonError("Path is a directory", 400);
      const content = await readFile(abs, "utf-8");
      return NextResponse.json({
        success: true,
        path,
        content,
      });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "Read failed", 500);
    }
  }

  // list
  try {
    const st = await stat(abs);
    if (!st.isDirectory()) return jsonError("Path is not a directory", 400);

    const entries = await readdir(abs);
    const enriched = await Promise.all(
      entries.map(async (name) => {
        const p = `${path.replace(/\/+$/, "")}/${name}`.replace(/^\.\//, "");
        const full = resolveInSandbox(sandboxRoot, p === "./" ? "." : p);
        const s = await stat(full);
        return {
          name,
          path: p,
          type: s.isDirectory() ? "directory" : "file",
          size: s.isDirectory() ? null : s.size,
          modifiedAt: s.mtime.toISOString(),
        };
      }),
    );

    enriched.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      path,
      sandboxRoot,
      entries: enriched,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "List failed", 500);
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Unauthorized", 401);

  const sandboxRoot = getUserSandboxRoot({ kind: "web", id: String(user.id) });
  ensureDir(sandboxRoot);

  const body = (await request.json().catch(() => null)) as
    | { action?: string; path?: string; content?: string }
    | null;
  if (!body) return jsonError("Invalid JSON body", 400);

  const action = body.action || "write";
  const path = body.path || "";

  let abs: string;
  try {
    abs = resolveInSandbox(sandboxRoot, path);
  } catch {
    return jsonError("Invalid path", 400);
  }

  if (action === "mkdir") {
    try {
      await mkdir(abs, { recursive: true });
      return NextResponse.json({ success: true });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "mkdir failed", 500);
    }
  }

  if (action === "write") {
    if (typeof body.content !== "string") {
      return jsonError("content is required", 400);
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body.content, "utf-8");
      return NextResponse.json({ success: true });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "write failed", 500);
    }
  }

  return jsonError("Unsupported action", 400);
}
