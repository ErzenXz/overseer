import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureDir, getUserSandboxRoot, resolveInSandbox } from "@/lib/userfs";
import {
  readdir,
  stat,
  readFile,
  writeFile,
  mkdir,
  rename as fsRename,
  rm,
} from "node:fs/promises";
import { dirname } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function guessContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".log") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".css") ||
    lower.endsWith(".html") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml")
  ) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "list";
  const path = searchParams.get("path") || ".";
  const disposition = searchParams.get("disposition") || "attachment";

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

  if (action === "download") {
    try {
      const st = await stat(abs);
      if (st.isDirectory()) return jsonError("Path is a directory", 400);
      const buf = await readFile(abs);
      const ct = guessContentType(path);
      const filename = path.split("/").filter(Boolean).pop() || "file";
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Content-Disposition": `${disposition}; filename="${filename.replaceAll('"', "")}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "Download failed", 500);
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

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return jsonError("Invalid form data", 400);
    const action = String(form.get("action") || "upload");
    if (action !== "upload") return jsonError("Unsupported action", 400);

    const dir = String(form.get("path") || ".");
    const file = form.get("file");
    if (!file || typeof file === "string") return jsonError("file is required", 400);
    const filename = file.name || "upload.bin";
    if (filename.includes("/") || filename.includes("\\")) {
      return jsonError("Invalid filename", 400);
    }

    const rel = `${dir.replace(/\/+$/, "")}/${filename}`.replace(/^\.\//, "");
    let abs: string;
    try {
      abs = resolveInSandbox(sandboxRoot, rel);
    } catch {
      return jsonError("Invalid path", 400);
    }

    try {
      await mkdir(dirname(abs), { recursive: true });
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(abs, buf);
      return NextResponse.json({ success: true, path: rel });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "Upload failed", 500);
    }
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: string;
        path?: string;
        content?: string;
        from?: string;
        to?: string;
      }
    | null;
  if (!body) return jsonError("Invalid JSON body", 400);

  const action = body.action || "write";

  if (action === "mkdir") {
    const path = body.path || "";
    let abs: string;
    try {
      abs = resolveInSandbox(sandboxRoot, path);
    } catch {
      return jsonError("Invalid path", 400);
    }
    try {
      await mkdir(abs, { recursive: true });
      return NextResponse.json({ success: true });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "mkdir failed", 500);
    }
  }

  if (action === "write") {
    const path = body.path || "";
    let abs: string;
    try {
      abs = resolveInSandbox(sandboxRoot, path);
    } catch {
      return jsonError("Invalid path", 400);
    }
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

  if (action === "delete") {
    const path = body.path || "";
    if (!path || path === "." || path === "/") {
      return jsonError("Refusing to delete root", 400);
    }
    let abs: string;
    try {
      abs = resolveInSandbox(sandboxRoot, path);
    } catch {
      return jsonError("Invalid path", 400);
    }
    try {
      await rm(abs, { recursive: true, force: true });
      return NextResponse.json({ success: true });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "delete failed", 500);
    }
  }

  if (action === "rename" || action === "move") {
    const from = body.from || "";
    const to = body.to || "";
    if (!from || !to) return jsonError("from and to are required", 400);
    let absFrom: string;
    let absTo: string;
    try {
      absFrom = resolveInSandbox(sandboxRoot, from);
      absTo = resolveInSandbox(sandboxRoot, to);
    } catch {
      return jsonError("Invalid path", 400);
    }
    try {
      await mkdir(dirname(absTo), { recursive: true });
      await fsRename(absFrom, absTo);
      return NextResponse.json({ success: true });
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "rename failed", 500);
    }
  }

  return jsonError("Unsupported action", 400);
}
