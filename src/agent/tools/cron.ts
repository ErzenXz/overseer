/**
 * Cron Job Tools
 * AI-callable tools for creating, listing, and managing scheduled cron jobs.
 */

import { tool } from "ai";
import { z } from "zod";
import {
  cronJobsModel,
  cronExecutionsModel,
  isValidCronExpression,
  describeCronExpression,
} from "../../database/models/cron";
import { triggerJob } from "../../lib/cron-engine";
import { createLogger } from "../../lib/logger";
import { getToolContext } from "../../lib/tool-context";

const logger = createLogger("tools:cron");

function getOwnerUserIdFromContext(): number | null {
  const ctx = getToolContext();
  if (ctx?.actor?.kind === "web" && ctx.actor.id) {
    const n = Number.parseInt(ctx.actor.id, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// =====================================================
// createCronJob
// =====================================================

export const createCronJob = tool({
  description: `Create a new scheduled cron job that will automatically run an AI prompt on a schedule.

WHEN TO USE:
- User asks to schedule a recurring task (e.g. "check disk space every hour")
- User wants automated monitoring, reporting, backups, or maintenance
- User says "remind me", "every day at", "schedule", "cron", "recurring"

CRON EXPRESSION FORMAT (5 fields):
  minute hour day-of-month month day-of-week
  ┬      ┬    ┬            ┬     ┬
  │      │    │            │     └─ 0=Sun, 1=Mon, ..., 6=Sat
  │      │    │            └─────── 1-12
  │      │    └──────────────────── 1-31
  │      └───────────────────────── 0-23
  └──────────────────────────────── 0-59

COMMON PATTERNS:
  "0 * * * *"     = Every hour at :00
  "*/5 * * * *"   = Every 5 minutes
  "0 9 * * *"     = Daily at 9:00 AM UTC
  "0 9 * * 1-5"   = Weekdays at 9:00 AM UTC
  "0 0 * * 0"     = Weekly on Sunday at midnight
  "0 0 1 * *"     = Monthly on the 1st at midnight

IMPORTANT:
- The prompt should be a complete, standalone instruction for the AI agent
- Include all necessary context in the prompt (the cron job runs in a fresh session)
- Times are in UTC by default`,

  inputSchema: z.object({
    name: z
      .string()
      .describe("Short descriptive name for the job (e.g. 'Daily disk check')"),
    cron_expression: z
      .string()
      .describe("Standard 5-field cron expression (e.g. '0 9 * * *' for daily at 9 AM UTC)"),
    prompt: z
      .string()
      .describe("The complete AI prompt to execute when the cron job fires. Should be self-contained."),
    description: z
      .string()
      .optional()
      .describe("Optional longer description of what this job does"),
    timezone: z
      .string()
      .optional()
      .describe("Timezone for the cron schedule (default: UTC). Use IANA timezone names like 'America/New_York'"),
  }),

  execute: async ({ name, cron_expression, prompt, description, timezone }) => {
    const startTime = Date.now();

    try {
      const ownerUserId = getOwnerUserIdFromContext();
      if (!ownerUserId) {
        return { success: false, error: "No authenticated user context for cron job creation." };
      }

      // Validate cron expression
      if (!isValidCronExpression(cron_expression)) {
        return {
          success: false,
          error: `Invalid cron expression: "${cron_expression}". Use standard 5-field format: minute hour day-of-month month day-of-week`,
        };
      }

      const job = cronJobsModel.create({
        owner_user_id: ownerUserId,
        name,
        cron_expression,
        prompt,
        description,
        timezone: timezone || "UTC",
        created_by: `user:${ownerUserId}`,
      });

      const schedule = describeCronExpression(cron_expression);
      const nextRun = job.next_run_at;

      logger.info("Cron job created by agent", {
        jobId: job.id,
        name,
        cron: cron_expression,
        executionTimeMs: Date.now() - startTime,
      });

      return {
        success: true,
        job_id: job.id,
        name: job.name,
        schedule,
        cron_expression: job.cron_expression,
        next_run_at: nextRun,
        timezone: job.timezone,
        message: `Cron job "${name}" created successfully. Schedule: ${schedule}. Next run: ${nextRun}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to create cron job", { error, name });
      return { success: false, error };
    }
  },
});

// =====================================================
// listCronJobs
// =====================================================

export const listCronJobs = tool({
  description: `List all scheduled cron jobs, optionally filtered by status.

WHEN TO USE:
- User asks "what cron jobs are scheduled?" or "show my scheduled tasks"
- Before creating a new job, to check for duplicates
- To check status of scheduled automation`,

  inputSchema: z.object({
    enabled_only: z
      .boolean()
      .optional()
      .describe("If true, only show enabled jobs (default: false, shows all)"),
    include_history: z
      .boolean()
      .optional()
      .describe("If true, include recent execution history for each job (default: false)"),
  }),

  execute: async ({ enabled_only, include_history }) => {
    try {
      const ownerUserId = getOwnerUserIdFromContext();
      if (!ownerUserId) {
        return { success: false, error: "No authenticated user context for cron listing." };
      }

      const jobs = enabled_only
        ? cronJobsModel.findEnabledByOwner(ownerUserId)
        : cronJobsModel.findAllByOwner(ownerUserId);

      const result = jobs.map((job) => {
        const base = {
          id: job.id,
          name: job.name,
          description: job.description,
          cron_expression: job.cron_expression,
          schedule: describeCronExpression(job.cron_expression),
          prompt: job.prompt.length > 100 ? job.prompt.slice(0, 100) + "..." : job.prompt,
          enabled: !!job.enabled,
          created_by: job.created_by,
          timezone: job.timezone,
          last_run_at: job.last_run_at,
          last_status: job.last_status,
          next_run_at: job.next_run_at,
          run_count: job.run_count,
        };

        if (include_history) {
          const executions = cronExecutionsModel.findByJobIdForOwner(
            ownerUserId,
            job.id,
            3,
          );
          return {
            ...base,
            recent_executions: executions.map((e) => ({
              id: e.id,
              status: e.status,
              started_at: e.started_at,
              duration_ms: e.duration_ms,
              error: e.error,
            })),
          };
        }

        return base;
      });

      return {
        success: true,
        total: jobs.length,
        enabled: jobs.filter((j) => j.enabled).length,
        jobs: result,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to list cron jobs", { error });
      return { success: false, error };
    }
  },
});

// =====================================================
// deleteCronJob
// =====================================================

export const deleteCronJob = tool({
  description: `Delete a scheduled cron job by its ID. This permanently removes the job and all its execution history.

WHEN TO USE:
- User asks to remove/delete a scheduled task
- User says "stop the cron job" or "cancel the schedule"`,

  inputSchema: z.object({
    job_id: z
      .number()
      .describe("The ID of the cron job to delete. Use listCronJobs to find IDs."),
  }),

  execute: async ({ job_id }) => {
    try {
      const ownerUserId = getOwnerUserIdFromContext();
      if (!ownerUserId) {
        return { success: false, error: "No authenticated user context for cron deletion." };
      }

      const job = cronJobsModel.findById(job_id);
      if (!job) {
        return { success: false, error: `Cron job with ID ${job_id} not found` };
      }
      if (job.owner_user_id !== ownerUserId) {
        return { success: false, error: "Forbidden: cron job belongs to a different user." };
      }

      const deleted = cronJobsModel.delete(job_id);

      logger.info("Cron job deleted by agent", { jobId: job_id, name: job.name });

      return {
        success: deleted,
        message: deleted
          ? `Cron job "${job.name}" (ID: ${job_id}) deleted successfully`
          : `Failed to delete cron job ${job_id}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to delete cron job", { error, jobId: job_id });
      return { success: false, error };
    }
  },
});

// =====================================================
// toggleCronJob
// =====================================================

export const toggleCronJob = tool({
  description: `Enable or disable a cron job without deleting it.

WHEN TO USE:
- User wants to pause a scheduled task temporarily
- User wants to resume a paused task
- User says "disable", "enable", "pause", "unpause" a cron job`,

  inputSchema: z.object({
    job_id: z
      .number()
      .describe("The ID of the cron job to enable/disable"),
    enabled: z
      .boolean()
      .describe("Set to true to enable, false to disable the cron job"),
  }),

  execute: async ({ job_id, enabled }) => {
    try {
      const ownerUserId = getOwnerUserIdFromContext();
      if (!ownerUserId) {
        return { success: false, error: "No authenticated user context for cron toggle." };
      }

      const existing = cronJobsModel.findById(job_id);
      if (!existing) {
        return { success: false, error: `Cron job with ID ${job_id} not found` };
      }
      if (existing.owner_user_id !== ownerUserId) {
        return { success: false, error: "Forbidden: cron job belongs to a different user." };
      }

      const job = enabled ? cronJobsModel.enable(job_id) : cronJobsModel.disable(job_id);

      if (!job) {
        return { success: false, error: `Cron job with ID ${job_id} not found` };
      }

      logger.info("Cron job toggled by agent", {
        jobId: job_id,
        name: job.name,
        enabled,
      });

      return {
        success: true,
        job_id: job.id,
        name: job.name,
        enabled: !!job.enabled,
        next_run_at: job.next_run_at,
        message: `Cron job "${job.name}" ${enabled ? "enabled" : "disabled"}${enabled && job.next_run_at ? `. Next run: ${job.next_run_at}` : ""}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to toggle cron job", { error, jobId: job_id });
      return { success: false, error };
    }
  },
});

// =====================================================
// runCronJobNow
// =====================================================

export const runCronJobNow = tool({
  description: `Manually trigger an immediate execution of a cron job, regardless of its schedule.

WHEN TO USE:
- User wants to test a cron job without waiting for the next scheduled time
- User says "run it now", "execute immediately", "trigger the job"`,

  inputSchema: z.object({
    job_id: z
      .number()
      .describe("The ID of the cron job to run immediately"),
  }),

  execute: async ({ job_id }) => {
    try {
      const ownerUserId = getOwnerUserIdFromContext();
      if (!ownerUserId) {
        return { success: false, error: "No authenticated user context for cron run-now." };
      }

      const job = cronJobsModel.findById(job_id);
      if (!job) {
        return { success: false, error: `Cron job with ID ${job_id} not found` };
      }
      if (job.owner_user_id !== ownerUserId) {
        return { success: false, error: "Forbidden: cron job belongs to a different user." };
      }

      logger.info("Cron job manually triggered by agent", {
        jobId: job_id,
        name: job.name,
      });

      // Trigger async execution
      const result = await triggerJob(job_id);

      return {
        success: result.success,
        job_id,
        name: job.name,
        message: result.success
          ? `Cron job "${job.name}" triggered successfully`
          : `Failed to trigger: ${result.error}`,
        error: result.error,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("Failed to trigger cron job", { error, jobId: job_id });
      return { success: false, error };
    }
  },
});
