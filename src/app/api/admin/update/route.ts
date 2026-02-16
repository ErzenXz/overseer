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
 * Runs ./scripts/update.sh (self-hosted only; requires filesystem access).
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
  const scriptPath = path.join(cwd, "scripts", "update.sh");

  const issueId = randomUUID();
  const startedAt = new Date().toISOString();
  const headBefore = await tryGitHead(cwd);

  try {
    // update.sh supports: [--help] [--dry-run] [--yes] [--stash]
    // We default to non-interactive and safe-ish behavior.
    const { exitCode, output } = await runProcess(
      "bash",
      [scriptPath, "--yes", "--stash"],
      { cwd, timeoutMs: 15 * 60_000 },
    );

    const finishedAt = new Date().toISOString();
    const headAfter = await tryGitHead(cwd);

    const record: UpdateRunRecord = {
      issueId,
      startedAt,
      finishedAt,
      ok: exitCode === 0,
      exitCode,
      command: `bash ${scriptPath} --yes --stash`,
      headBefore,
      headAfter,
      output,
    };

    await writeLastRun(record);

    return NextResponse.json({
      success: record.ok,
      issueId,
      exitCode,
      headBefore,
      headAfter,
      output,
    });
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    const record: UpdateRunRecord = {
      issueId,
      startedAt,
      finishedAt,
      ok: false,
      exitCode: null,
      command: `bash ${scriptPath} --yes --stash`,
      headBefore,
      headAfter: await tryGitHead(cwd),
      output: msg,
    };
    await writeLastRun(record);
    return NextResponse.json({ success: false, issueId, error: msg }, { status: 500 });
  }
}
