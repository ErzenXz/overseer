import { db } from "../db";
import type { CronJob, CronExecution } from "../../types/database";
import { CronExpressionParser } from "cron-parser";

// =====================================================
// Input types
// =====================================================

export interface CronJobInput {
  owner_user_id?: number;
  name: string;
  description?: string;
  cron_expression: string;
  prompt: string;
  enabled?: number;
  created_by?: string;
  timezone?: string;
  max_retries?: number;
  timeout_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface CronExecutionInput {
  cron_job_id: number;
  owner_user_id?: number;
  conversation_id?: number;
  status?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

// =====================================================
// Helpers
// =====================================================

/**
 * Calculate the next run time from a cron expression
 */
export function calculateNextRun(cronExpression: string, timezone = "UTC"): string {
  try {
    const expr = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz: timezone,
    });
    const next = expr.next().toISOString();
    if (!next) throw new Error(`Could not calculate next run for: ${cronExpression}`);
    return next;
  } catch {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }
}

/**
 * Validate a cron expression
 */
export function isValidCronExpression(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a human-readable description of a cron expression
 */
export function describeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Simple common patterns
  if (expr === "* * * * *") return "Every minute";
  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every hour at minute ${minute}`;
  }
  if (minute !== "*" && hour !== "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
  }
  if (minute !== "*" && hour !== "*" && dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = dayOfWeek.split(",").map((d) => days[parseInt(d)] || d).join(", ");
    return `${dayNames} at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
  }

  return expr;
}

// =====================================================
// Cron Jobs Model
// =====================================================

export const cronJobsModel = {
  findById(id: number): CronJob | undefined {
    return db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as CronJob | undefined;
  },

  findAll(limit = 100, offset = 0): CronJob[] {
    return db
      .prepare("SELECT * FROM cron_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as CronJob[];
  },

  findAllByOwner(ownerUserId: number, limit = 100, offset = 0): CronJob[] {
    return db
      .prepare(
        "SELECT * FROM cron_jobs WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      )
      .all(ownerUserId, limit, offset) as CronJob[];
  },

  findEnabled(): CronJob[] {
    return db
      .prepare("SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY next_run_at ASC")
      .all() as CronJob[];
  },

  findEnabledByOwner(ownerUserId: number): CronJob[] {
    return db
      .prepare(
        "SELECT * FROM cron_jobs WHERE owner_user_id = ? AND enabled = 1 ORDER BY next_run_at ASC",
      )
      .all(ownerUserId) as CronJob[];
  },

  findDue(now?: string): CronJob[] {
    const currentTime = now || new Date().toISOString();
    return db
      .prepare(
        "SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?"
      )
      .all(currentTime) as CronJob[];
  },

  findDueByOwner(ownerUserId: number, now?: string): CronJob[] {
    const currentTime = now || new Date().toISOString();
    return db
      .prepare(
        "SELECT * FROM cron_jobs WHERE owner_user_id = ? AND enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?",
      )
      .all(ownerUserId, currentTime) as CronJob[];
  },

  create(input: CronJobInput): CronJob {
    const nextRun = calculateNextRun(input.cron_expression, input.timezone || "UTC");

    const result = db
      .prepare(
        `INSERT INTO cron_jobs (owner_user_id, name, description, cron_expression, prompt, enabled, created_by, timezone, max_retries, timeout_ms, next_run_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.owner_user_id ?? 1,
        input.name,
        input.description || null,
        input.cron_expression,
        input.prompt,
        input.enabled ?? 1,
        input.created_by || "system",
        input.timezone || "UTC",
        input.max_retries ?? 3,
        input.timeout_ms ?? 300000,
        nextRun,
        input.metadata ? JSON.stringify(input.metadata) : null
      );

    return this.findById(result.lastInsertRowid as number)!;
  },

  update(id: number, updates: Partial<CronJobInput>): CronJob | undefined {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description || null);
    }
    if (updates.cron_expression !== undefined) {
      fields.push("cron_expression = ?");
      values.push(updates.cron_expression);
      // Recalculate next run
      const tz = updates.timezone || this.findById(id)?.timezone || "UTC";
      fields.push("next_run_at = ?");
      values.push(calculateNextRun(updates.cron_expression, tz));
    }
    if (updates.prompt !== undefined) {
      fields.push("prompt = ?");
      values.push(updates.prompt);
    }
    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled);
    }
    if (updates.timezone !== undefined) {
      fields.push("timezone = ?");
      values.push(updates.timezone);
    }
    if (updates.max_retries !== undefined) {
      fields.push("max_retries = ?");
      values.push(updates.max_retries);
    }
    if (updates.timeout_ms !== undefined) {
      fields.push("timeout_ms = ?");
      values.push(updates.timeout_ms);
    }
    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length > 0) {
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      db.prepare(
        `UPDATE cron_jobs SET ${fields.join(", ")} WHERE id = ?`
      ).run(...values);
    }

    return this.findById(id);
  },

  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);
    return result.changes > 0;
  },

  enable(id: number): CronJob | undefined {
    const job = this.findById(id);
    if (!job) return undefined;

    const nextRun = calculateNextRun(job.cron_expression, job.timezone);
    db.prepare(
      "UPDATE cron_jobs SET enabled = 1, next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(nextRun, id);

    return this.findById(id);
  },

  disable(id: number): CronJob | undefined {
    db.prepare(
      "UPDATE cron_jobs SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(id);
    return this.findById(id);
  },

  /**
   * Mark a job as currently running without incrementing run_count.
   * (run_count increments when a run finishes successfully/failed)
   */
  markRunning(id: number): void {
    db.prepare(
      "UPDATE cron_jobs SET last_status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(id);
  },

  updateLastRun(id: number, status: string): void {
    db.prepare(
      `UPDATE cron_jobs 
       SET last_run_at = CURRENT_TIMESTAMP, 
           last_status = ?,
           run_count = run_count + 1,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`
    ).run(status, id);
  },

  updateNextRun(id: number, nextRunAt: string): void {
    db.prepare(
      "UPDATE cron_jobs SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(nextRunAt, id);
  },

  count(ownerUserId?: number): number {
    if (typeof ownerUserId === "number") {
      const result = db
        .prepare("SELECT COUNT(*) as count FROM cron_jobs WHERE owner_user_id = ?")
        .get(ownerUserId) as { count: number };
      return result.count;
    }
    const result = db
      .prepare("SELECT COUNT(*) as count FROM cron_jobs")
      .get() as { count: number };
    return result.count;
  },

  countEnabled(ownerUserId?: number): number {
    if (typeof ownerUserId === "number") {
      const result = db
        .prepare("SELECT COUNT(*) as count FROM cron_jobs WHERE owner_user_id = ? AND enabled = 1")
        .get(ownerUserId) as { count: number };
      return result.count;
    }
    const result = db
      .prepare("SELECT COUNT(*) as count FROM cron_jobs WHERE enabled = 1")
      .get() as { count: number };
    return result.count;
  },
};

// =====================================================
// Cron Executions Model
// =====================================================

export const cronExecutionsModel = {
  findById(id: number): CronExecution | undefined {
    return db.prepare("SELECT * FROM cron_executions WHERE id = ?").get(id) as
      | CronExecution
      | undefined;
  },

  findByJobId(jobId: number, limit = 20): CronExecution[] {
    return db
      .prepare(
        "SELECT * FROM cron_executions WHERE cron_job_id = ? ORDER BY started_at DESC LIMIT ?"
      )
      .all(jobId, limit) as CronExecution[];
  },

  findByJobIdForOwner(ownerUserId: number, jobId: number, limit = 20): CronExecution[] {
    return db
      .prepare(
        "SELECT * FROM cron_executions WHERE owner_user_id = ? AND cron_job_id = ? ORDER BY started_at DESC LIMIT ?",
      )
      .all(ownerUserId, jobId, limit) as CronExecution[];
  },

  findRecent(limit = 50): CronExecution[] {
    return db
      .prepare(
        `SELECT ce.*, cj.name as job_name 
         FROM cron_executions ce 
         LEFT JOIN cron_jobs cj ON ce.cron_job_id = cj.id 
         ORDER BY ce.started_at DESC LIMIT ?`
      )
      .all(limit) as (CronExecution & { job_name?: string })[];
  },

  create(input: CronExecutionInput): CronExecution {
    const result = db
      .prepare(
        `INSERT INTO cron_executions (cron_job_id, owner_user_id, conversation_id, status, prompt, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.cron_job_id,
        input.owner_user_id ?? 1,
        input.conversation_id || null,
        input.status || "running",
        input.prompt,
        input.metadata ? JSON.stringify(input.metadata) : null
      );

    return this.findById(result.lastInsertRowid as number)!;
  },

  update(
    id: number,
    updates: {
      status?: string;
      conversation_id?: number;
      completed_at?: string;
      duration_ms?: number;
      output_summary?: string;
      error?: string;
      input_tokens?: number;
      output_tokens?: number;
      tool_calls_count?: number;
    }
  ): CronExecution | undefined {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.conversation_id !== undefined) {
      fields.push("conversation_id = ?");
      values.push(updates.conversation_id);
    }
    if (updates.completed_at !== undefined) {
      fields.push("completed_at = ?");
      values.push(updates.completed_at);
    }
    if (updates.duration_ms !== undefined) {
      fields.push("duration_ms = ?");
      values.push(updates.duration_ms);
    }
    if (updates.output_summary !== undefined) {
      fields.push("output_summary = ?");
      values.push(updates.output_summary);
    }
    if (updates.error !== undefined) {
      fields.push("error = ?");
      values.push(updates.error);
    }
    if (updates.input_tokens !== undefined) {
      fields.push("input_tokens = ?");
      values.push(updates.input_tokens);
    }
    if (updates.output_tokens !== undefined) {
      fields.push("output_tokens = ?");
      values.push(updates.output_tokens);
    }
    if (updates.tool_calls_count !== undefined) {
      fields.push("tool_calls_count = ?");
      values.push(updates.tool_calls_count);
    }

    if (fields.length > 0) {
      values.push(id);
      db.prepare(
        `UPDATE cron_executions SET ${fields.join(", ")} WHERE id = ?`
      ).run(...values);
    }

    return this.findById(id);
  },

  getRecentByJob(jobId: number, limit = 5): CronExecution[] {
    return db
      .prepare(
        "SELECT * FROM cron_executions WHERE cron_job_id = ? ORDER BY started_at DESC LIMIT ?"
      )
      .all(jobId, limit) as CronExecution[];
  },

  getRunningCount(): number {
    const result = db
      .prepare("SELECT COUNT(*) as count FROM cron_executions WHERE status = 'running'")
      .get() as { count: number };
    return result.count;
  },

  count(): number {
    const result = db
      .prepare("SELECT COUNT(*) as count FROM cron_executions")
      .get() as { count: number };
    return result.count;
  },
};
