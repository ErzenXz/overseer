import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { getCurrentUser } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateRunRecord = {
  issueId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  exitCode: number | null;
  command: string;
  headBefore?: string | null;
  headAfter?: string | null;
  output: string;
};

function repoRoot(): string {
  // Next.js route handlers run with cwd at the project root in our deployment.
  // Allow override for unusual setups.
  return process.env.OVERSEER_ROOT
    ? path.resolve(process.env.OVERSEER_ROOT)
    : path.resolve(process.cwd());
}

function updateStatusPath(): string {
  return path.join(repoRoot(), "data", "system", "update", "last-run.json");
}

async function ensureUpdateStatusDir(): Promise<void> {
  await fs.mkdir(path.dirname(updateStatusPath()), { recursive: true });
}

async function readLastRun(): Promise<UpdateRunRecord | null> {
  try {
    const raw = await fs.readFile(updateStatusPath(), "utf-8");
    return JSON.parse(raw) as UpdateRunRecord;
  } catch {
    return null;
  }
}

async function writeLastRun(record: UpdateRunRecord): Promise<void> {
  await ensureUpdateStatusDir();
  await fs.writeFile(updateStatusPath(), JSON.stringify(record, null, 2), "utf-8");
}

async function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ exitCode: number | null; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let output = "";
    const push = (chunk: Buffer) => {
      output += chunk.toString("utf-8");
      // Avoid unbounded memory growth (keep last ~250KB).
      if (output.length > 250_000) output = output.slice(output.length - 250_000);
    };

    child.stdout.on("data", push);
    child.stderr.on("data", push);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ exitCode: null, output: output + "\n[overseer] update timed out\n" });
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output });
    });
  });
}

async function tryGitHead(cwd: string): Promise<string | null> {
  try {
    const r = await runProcess("git", ["rev-parse", "HEAD"], { cwd, timeoutMs: 20_000 });
    if (r.exitCode === 0) return r.output.trim() || null;
    return null;
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/update
 * Returns last update run status + current git HEAD (best-effort).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  requirePermission(user, Permission.SYSTEM_SETTINGS_READ, {
    resource: "system_update",
    metadata: { action: "view_update_status" },
  });

  const cwd = repoRoot();
  const head = await tryGitHead(cwd);
  const lastRun = await readLastRun();

  return NextResponse.json({
    head,
    lastRun,
  });
}

/**
 * POST /api/admin/update
 * Spawns ./scripts/update-wrapper.sh as a fully detached process so it
 * survives the service restart that update.sh performs.  Returns immediately.
 * Poll GET /api/admin/update to track progress.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  requirePermission(user, Permission.SYSTEM_UPDATE, {
    resource: "system_update",
    metadata: { action: "run_update" },
  });

  const cwd = repoRoot();
  const wrapperPath = path.join(cwd, "scripts", "update-wrapper.sh");
  const statusFile = updateStatusPath();

  const issueId = randomUUID();
  const headBefore = await tryGitHead(cwd);

  try {
    // Ensure the status directory exists before spawning
    await ensureUpdateStatusDir();

    // Spawn the wrapper fully detached so it survives systemd stop/restart.
    // The wrapper writes progress and final status to the status file.
    const child = spawn(
      "bash",
      [wrapperPath, statusFile, issueId, cwd],
      {
        cwd,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, OVERSEER_DIR: cwd },
      },
    );

    // Let the child run independently of this Node process
    child.unref();

    return NextResponse.json({
      success: true,
      started: true,
      issueId,
      headBefore,
      message: "Update started. Poll GET /api/admin/update for progress.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, issueId, error: msg }, { status: 500 });
  }
}
