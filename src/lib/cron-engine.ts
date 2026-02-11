/**
 * Cron Engine
 * In-process scheduler that polls the database for due cron jobs and executes them.
 * Follows the module-level singleton pattern (like session-manager.ts).
 */

import { cronJobsModel, cronExecutionsModel } from "../database/models/cron";
import { calculateNextRun } from "../database/models/cron";
import { conversationsModel } from "../database/index";
import { executeAgent } from "../agent/runner";
import { createLogger } from "./logger";
import type { CronJob } from "../types/database";

const logger = createLogger("cron-engine");

// =====================================================
// Configuration
// =====================================================

const POLL_INTERVAL_MS = 60_000; // Check for due jobs every 60 seconds
const MAX_CONCURRENT_JOBS = 3;   // Max simultaneous cron executions
const JOB_TIMEOUT_DEFAULT = 300_000; // 5 minute default timeout

// =====================================================
// State
// =====================================================

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let activeJobs = 0;

// =====================================================
// Core Functions
// =====================================================

/**
 * Start the cron engine polling loop
 */
export function startCronEngine(): void {
  if (isRunning) {
    logger.info("Cron engine already running");
    return;
  }

  isRunning = true;
  logger.info("Cron engine started", { pollIntervalMs: POLL_INTERVAL_MS });

  // Run an initial check immediately
  checkDueJobs().catch((err) => {
    logger.error("Initial cron check failed", { error: String(err) });
  });

  // Start the poll loop
  pollTimer = setInterval(() => {
    checkDueJobs().catch((err) => {
      logger.error("Cron poll check failed", { error: String(err) });
    });
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the cron engine
 */
export function stopCronEngine(): void {
  if (!isRunning) return;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  isRunning = false;
  logger.info("Cron engine stopped");
}

/**
 * Check if the cron engine is running
 */
export function isCronEngineRunning(): boolean {
  return isRunning;
}

/**
 * Get the number of currently executing jobs
 */
export function getActiveJobCount(): number {
  return activeJobs;
}

/**
 * Check for and execute due cron jobs
 */
async function checkDueJobs(): Promise<void> {
  if (!isRunning) return;

  try {
    const dueJobs = cronJobsModel.findDue();

    if (dueJobs.length === 0) return;

    logger.info(`Found ${dueJobs.length} due cron job(s)`);

    for (const job of dueJobs) {
      if (activeJobs >= MAX_CONCURRENT_JOBS) {
        logger.warn("Max concurrent cron jobs reached, deferring remaining", {
          active: activeJobs,
          max: MAX_CONCURRENT_JOBS,
          deferred: dueJobs.length - dueJobs.indexOf(job),
        });
        break;
      }

      // Execute job in background (don't await — allows concurrency)
      executeJob(job).catch((err) => {
        logger.error("Cron job execution failed", {
          jobId: job.id,
          jobName: job.name,
          error: String(err),
        });
      });
    }
  } catch (err) {
    logger.error("Error checking due jobs", { error: String(err) });
  }
}

/**
 * Execute a single cron job
 */
async function executeJob(job: CronJob): Promise<void> {
  activeJobs++;
  const startTime = Date.now();

  logger.info("Executing cron job", {
    jobId: job.id,
    jobName: job.name,
    cronExpression: job.cron_expression,
  });

  // Mark job as running
  cronJobsModel.updateLastRun(job.id, "running");

  // Create a conversation for this cron execution
  const conversation = conversationsModel.findOrCreate({
    interface_type: "cron",
    external_chat_id: `cron-job-${job.id}`,
    external_user_id: "cron-engine",
    external_username: "Cron Engine",
    title: `[Cron] ${job.name}`,
  });

  // Create execution record
  const execution = cronExecutionsModel.create({
    cron_job_id: job.id,
    conversation_id: conversation.id,
    prompt: job.prompt,
  });

  try {
    // Execute the agent with the job's prompt
    const timeout = job.timeout_ms || JOB_TIMEOUT_DEFAULT;
    const result = await Promise.race([
      executeAgent(job.prompt, {
        conversationId: conversation.id,
        onToolCall: (toolName) => {
          logger.info("Cron job tool call", {
            jobId: job.id,
            tool: toolName,
          });
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Cron job timed out after ${timeout}ms`)), timeout)
      ),
    ]);

    const durationMs = Date.now() - startTime;

    // Update execution record with results
    cronExecutionsModel.update(execution.id, {
      status: result.success ? "success" : "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      output_summary: result.text?.slice(0, 2000) || undefined,
      error: result.error || undefined,
      input_tokens: result.inputTokens || 0,
      output_tokens: result.outputTokens || 0,
      tool_calls_count: result.toolCalls?.length || 0,
    });

    // Update job status
    cronJobsModel.updateLastRun(job.id, result.success ? "success" : "failed");

    logger.info("Cron job completed", {
      jobId: job.id,
      jobName: job.name,
      success: result.success,
      durationMs,
      steps: result.steps,
      tokens: (result.inputTokens || 0) + (result.outputTokens || 0),
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Update execution record with error
    cronExecutionsModel.update(execution.id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      error: errorMsg,
    });

    // Update job status
    cronJobsModel.updateLastRun(job.id, "failed");

    logger.error("Cron job failed", {
      jobId: job.id,
      jobName: job.name,
      error: errorMsg,
      durationMs,
    });
  } finally {
    activeJobs--;

    // Calculate and set next run time
    try {
      const nextRun = calculateNextRun(job.cron_expression, job.timezone);
      cronJobsModel.updateNextRun(job.id, nextRun);
    } catch (err) {
      logger.error("Failed to calculate next run for job", {
        jobId: job.id,
        error: String(err),
      });
    }
  }
}

/**
 * Manually trigger a cron job (run-now)
 */
export async function triggerJob(jobId: number): Promise<{
  success: boolean;
  executionId?: number;
  error?: string;
}> {
  const job = cronJobsModel.findById(jobId);
  if (!job) {
    return { success: false, error: `Cron job ${jobId} not found` };
  }

  logger.info("Manually triggering cron job", { jobId, jobName: job.name });

  try {
    await executeJob(job);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Get cron engine status
 */
export function getCronEngineStatus(): {
  running: boolean;
  activeJobs: number;
  totalJobs: number;
  enabledJobs: number;
  pollIntervalMs: number;
} {
  return {
    running: isRunning,
    activeJobs,
    totalJobs: cronJobsModel.count(),
    enabledJobs: cronJobsModel.countEnabled(),
    pollIntervalMs: POLL_INTERVAL_MS,
  };
}
