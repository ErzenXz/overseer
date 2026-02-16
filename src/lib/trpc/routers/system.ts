import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { router, authedProcedure } from "../trpc";
import { Permission, requirePermission } from "@/lib/permissions";

function repoRoot(): string {
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

async function readLastRun() {
  try {
    const raw = await fs.readFile(updateStatusPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function tryGitHead(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) => resolve(code === 0 ? out.trim() || null : null));
    child.on("error", () => resolve(null));
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 20_000);
  });
}

export const systemRouter = router({
  updateStatus: authedProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.user, Permission.SYSTEM_SETTINGS_READ, {
      resource: "system_update",
    });
    const cwd = repoRoot();
    const head = await tryGitHead(cwd);
    const lastRun = await readLastRun();
    return { head, lastRun };
  }),

  runUpdate: authedProcedure.mutation(async ({ ctx }) => {
    requirePermission(ctx.user, Permission.SYSTEM_UPDATE, {
      resource: "system_update",
      metadata: { action: "run_update" },
    });

    const cwd = repoRoot();
    const wrapperPath = path.join(cwd, "scripts", "update-wrapper.sh");
    const statusFile = updateStatusPath();
    const issueId = randomUUID();
    const headBefore = await tryGitHead(cwd);

    await ensureUpdateStatusDir();

    const child = spawn("bash", [wrapperPath, statusFile, issueId, cwd], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, OVERSEER_DIR: cwd },
    });
    child.unref();

    return { success: true, started: true, issueId, headBefore };
  }),

  enableAutoUpdate: authedProcedure.mutation(async ({ ctx }) => {
    requirePermission(ctx.user, Permission.SYSTEM_UPDATE, {
      resource: "system_update",
    });

    // Forward to existing cron API
    const { cronJobsModel } = await import("@/database");
    const job = cronJobsModel.create({
      name: "Overseer Auto Update",
      description: "Weekly self-update via scripts/update.sh",
      cron_expression: "0 3 * * 0",
      timezone: "UTC",
      enabled: 1,
      prompt:
        "Run the shell tool to execute exactly: bash ./scripts/update.sh --yes --stash\nReturn a brief status including the exit code.",
    });

    return { success: true, jobId: job.id };
  }),
});
