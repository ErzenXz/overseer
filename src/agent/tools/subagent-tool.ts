/**
 * Sub-Agent Tool
 * 
 * Spawns a generic sub-agent that has access to EVERYTHING the main agent has:
 * - All built-in tools (shell, files, cron)
 * - All MCP server tools
 * - All skill tools
 * 
 * The main agent gives it a specific task, it runs autonomously, 
 * returns the result for the main agent to synthesize.
 */

import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "../../lib/logger";
import { getDefaultModel } from "../providers";
import { getToolContext } from "../../lib/tool-context";
import {
  createSubAgent,
  executeTask,
  findBySubAgentId,
  resumeTask,
  type SubAgentType,
} from "../subagents/manager";
import { agentTasksModel } from "../../database";
import { builtinTools } from "./builtin-tools";
import { getAllMCPTools } from "../mcp/client";
import { getAllActiveSkillTools } from "../skills/registry";
import type { Tool } from "ai";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("tools:subagent");

function getToolsForSubAgent(): Record<string, Tool> {
  // Avoid importing ./index here (circular). Build the same combined toolset.
  const tools: Record<string, Tool> = { ...builtinTools };
  const mcp = getAllMCPTools();
  for (const [name, t] of Object.entries(mcp)) tools[name] = t;
  const skills = getAllActiveSkillTools();
  for (const [name, t] of Object.entries(skills)) tools[name] = t;
  return tools;
}

/**
 * Spawn a generic sub-agent to handle a focused task.
 * 
 * This sub-agent has EVERYTHING:
 * - Shell commands (bash, git, npm, docker, etc.)
 * - File operations (read, write, list)
 * - Cron job management
 * - MCP tools from connected servers
 * - Skill tools
 * 
 * Think of it as: "Hey, go do this task and come back with results"
 * 
 * EXAMPLES:
 * 
 * // Simple task
 * spawnSubAgent({ task: "Check if nginx is running on prod-server" })
 * 
 * // Detailed task with context
 * spawnSubAgent({
 *   task: "Find all users in the database who haven't logged in for 90 days",
 *   context: "We need to send them a re-engagement email. The database is at /data/myapp.db"
 * })
 * 
 * // Background work - don't wait
 * spawnSubAgent({
 *   task: "Migrate all data from old-api to new-api. Handle rate limits.",
 *   mode: "background"
 * })
 * // Continue conversation, check status later
 * 
 * // Need result immediately - wait
 * const result = spawnSubAgent({
 *   task: "Write a unit test for the auth function",
 *   context: "File: src/auth.ts, function: validateToken",
 *   mode: "wait"
 * })
 */
export const spawnSubAgent = tool<any, any>({
  description: `Spawn a generic sub-agent to handle a focused task.

The sub-agent has FULL ACCESS to everything:
- All shell commands (bash, git, npm, docker, etc.)
- All file operations (read, write, list)
- Cron job management
- All MCP server tools
- All skill tools

Think of it as: "Go do this task and come back with results"

TASK WRITING:
- Be specific about what you want done
- Include relevant file paths, URLs, or context
- Define what "done" looks like

EXECUTION:
- mode: "auto" (default) → Start in background, wait briefly, then return a handle if it takes too long
- mode: "background" → Fire and forget, continue immediately
- mode: "wait" → Block until complete (only when you need the result now)

EXAMPLES:
spawnSubAgent({ task: "Check if nginx is running on prod-server" })
spawnSubAgent({ task: "Find all users who haven't logged in 90 days", context: "Database at /data/app.db" })
spawnSubAgent({ task: "Write tests for auth.ts validateToken function", mode: "wait" })`,
  inputSchema: z.object({
    task: z.string().describe(
      `The specific task for the sub-agent to complete.
       
       Be specific! Include:
       - Exact file paths or URLs
       - What "done" looks like
       - Any relevant context or background
       
       Examples:
       BAD: "fix the bug"
       GOOD: "In /app/src/auth.ts function validateToken(), change line 45 to throw 
              AuthError('TOKEN_EXPIRED') instead of returning undefined. Test with expired JWT."`,
    ),
    context: z
      .string()
      .optional()
      .describe(
        `Additional background information.
         
         Useful for:
         - Why you're doing this task
         - Relevant files, URLs, or configs
         - Previous attempts that didn't work
         - Constraints or requirements`,
      ),
    agent_type: z
      .enum(["generic", "planner", "code", "system", "security", "evaluator"])
      .optional()
      .describe("Optional sub-agent type. If omitted, defaults to generic."),
    mode: z
      .enum(["auto", "wait", "background"])
      .optional()
      .describe(
        `Execution mode:

         - auto (default): Start in background, but wait briefly for a result. If it takes too long, return a handle.
         - wait: Wait until the sub-agent completes (use only when you need the result now).
         - background: Fire and forget; return immediately with a handle.`,
      ),
    max_wait_ms: z
      .number()
      .optional()
      .describe("For mode=auto, how long to wait before returning a handle (default: 12000ms)."),
    // Backwards compatibility:
    // - wait_for_result=false maps to mode=background
    // - wait_for_result=true maps to mode=wait
    wait_for_result: z
      .boolean()
      .optional()
      .describe("Deprecated. Use mode instead."),
  }),
  execute: async ({
    task,
    context,
    agent_type,
    mode,
    max_wait_ms,
    wait_for_result,
  }: {
    task: string;
    context?: string;
    agent_type?: SubAgentType;
    mode?: "auto" | "wait" | "background";
    max_wait_ms?: number;
    wait_for_result?: boolean;
  }) => {
    const startTime = Date.now();
    const ctx = getToolContext();

    const effectiveMode: "auto" | "wait" | "background" =
      mode ||
      (typeof wait_for_result === "boolean"
        ? wait_for_result
          ? "wait"
          : "background"
        : "auto");
    const effectiveMaxWaitMs =
      typeof max_wait_ms === "number" && Number.isFinite(max_wait_ms)
        ? Math.max(0, Math.min(120_000, max_wait_ms))
        : 12_000;

    logger.info("Spawning sub-agent", {
      task: task.substring(0, 100),
      mode: effectiveMode,
    });

    try {
      const fullTask = context ? `${task}\n\nContext: ${context}` : task;

      const ownerUserId =
        ctx?.actor?.kind === "web" ? parseInt(ctx.actor.id, 10) : 1;

      const parentSessionId =
        ctx?.agentSessionId ||
        (typeof ctx?.conversationId === "number"
          ? `conversation:${ctx.conversationId}`
          : `session:${uuidv4()}`);

      const subAgent = createSubAgent({
        parent_session_id: parentSessionId,
        agent_type: (agent_type || "generic") as SubAgentType,
        owner_user_id: Number.isFinite(ownerUserId) ? ownerUserId : 1,
        assigned_task: fullTask,
        metadata: {
          spawned_at: new Date().toISOString(),
          mode: effectiveMode,
          max_wait_ms: effectiveMaxWaitMs,
        },
      });

      const taskRow = agentTasksModel.create({
        owner_user_id: Number.isFinite(ownerUserId) ? ownerUserId : 1,
        conversation_id:
          typeof ctx?.conversationId === "number" ? ctx.conversationId : null,
        title: `Sub-agent: ${task.slice(0, 60)}`,
        input: fullTask,
        status: "running",
        priority: effectiveMode === "background" ? 6 : 5,
        assigned_sub_agent_id: subAgent.sub_agent_id,
        started_at: new Date().toISOString(),
        artifacts: {
          parentSessionId,
          agentType: agent_type || "generic",
          mode: effectiveMode,
          interface: ctx?.interface ?? null,
        },
      });

      const model = getDefaultModel();
      if (!model) {
        agentTasksModel.update(taskRow.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "No LLM provider configured for sub-agent",
        });
        return {
          success: false,
          error: "No LLM provider configured for sub-agent",
          sub_agent_id: subAgent.sub_agent_id,
          execution_time_ms: Date.now() - startTime,
        };
      }

      // Always start in background so we can "auto-wait" without blocking forever.
      const execPromise = executeTask(subAgent.sub_agent_id, model, getToolsForSubAgent(), {
        toolContext: ctx,
      }).then((result) => {
        agentTasksModel.update(taskRow.id, {
          status: result.success ? "completed" : "failed",
          finished_at: new Date().toISOString(),
          result_summary: result.success ? "Completed" : "Failed",
          result_full: result.result || null,
          error: result.success ? null : result.error || "Sub-agent failed",
          artifacts: {
            parentSessionId,
            agentType: agent_type || "generic",
            mode: effectiveMode,
            interface: ctx?.interface ?? null,
            steps: result.steps,
            tokens_used: result.tokens_used,
            execution_time_ms: result.execution_time_ms,
          } as any,
        });
        return result;
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        agentTasksModel.update(taskRow.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: msg,
        });
        throw err;
      });

      if (effectiveMode === "background") {
        void execPromise.catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("Background sub-agent execution failed", {
            sub_agent_id: subAgent.sub_agent_id,
            error: errorMessage,
          });
        });

        return {
          success: true,
          sub_agent_id: subAgent.sub_agent_id,
          status: "working",
          mode: "background",
          message: `Sub-agent spawned and running in background. ID: ${subAgent.sub_agent_id}`,
          next_steps:
            "Continue helping the user. Use checkSubAgentStatus to get the result later.",
          execution_time_ms: Date.now() - startTime,
          task_id: taskRow.id,
        };
      }

      if (effectiveMode === "auto") {
        const result = await Promise.race([
          execPromise,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), effectiveMaxWaitMs)),
        ]);

        if (result === null) {
          // Still working. Return a handle.
          return {
            success: true,
            sub_agent_id: subAgent.sub_agent_id,
            status: "working",
            mode: "auto",
            message:
              "Sub-agent started. It's still working; use checkSubAgentStatus to retrieve the result shortly.",
            execution_time_ms: Date.now() - startTime,
            task_id: taskRow.id,
          };
        }

        logger.info("Sub-agent completed (auto)", {
          success: result.success,
          steps: result.steps,
          execution_time_ms: result.execution_time_ms,
        });

        return {
          success: result.success,
          sub_agent_id: subAgent.sub_agent_id,
          status: result.success ? "completed" : "error",
          mode: "auto",
          result: result.result,
          steps: result.steps,
          tokens_used: result.tokens_used,
          error: result.error,
          execution_time_ms: result.execution_time_ms,
          task_id: taskRow.id,
        };
      }

      // wait
      const result = await execPromise;

      logger.info("Sub-agent completed", {
        success: result.success,
        steps: result.steps,
        execution_time_ms: result.execution_time_ms,
      });

      return {
        success: result.success,
        sub_agent_id: subAgent.sub_agent_id,
        status: result.success ? "completed" : "error",
        mode: "wait",
        result: result.result,
        steps: result.steps,
        tokens_used: result.tokens_used,
        error: result.error,
        execution_time_ms: result.execution_time_ms,
        task_id: taskRow.id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("Failed to spawn sub-agent", { error: errorMessage });

      return {
        success: false,
        error: `Failed to spawn sub-agent: ${errorMessage}`,
        execution_time_ms: Date.now() - startTime,
      };
    }
  },
});

/**
 * Check the status of a background sub-agent.
 * 
 * Use after spawning with wait_for_result: false to see if it's done.
 */
export const checkSubAgentStatus = tool<any, any>({
  description: `Check status of a background sub-agent.

Returns:
- idle: Just created
- working: Currently running
- completed: Done - check result field
- error: Failed - check error field

Poll every 5-10 seconds. Don't poll more than 30 times.`,
  inputSchema: z.object({
    sub_agent_id: z.string().describe("The sub-agent ID from spawnSubAgent response"),
  }),
  execute: async ({ sub_agent_id }: { sub_agent_id: string }) => {
    const subAgent = findBySubAgentId(sub_agent_id);

    if (!subAgent) {
      return {
        success: false,
        error: `Sub-agent ${sub_agent_id} not found`,
      };
    }

    return {
      success: true,
      sub_agent_id: subAgent.sub_agent_id,
      type: subAgent.agent_type,
      status: subAgent.status,
      task: subAgent.assigned_task,
      result: subAgent.task_result,
      steps: subAgent.step_count,
      tokens_used: subAgent.tokens_used,
      created_at: subAgent.created_at,
      started_at: subAgent.started_at,
      completed_at: subAgent.completed_at,
    };
  },
});

/**
 * Resume a failed sub-agent with more context.
 */
export const resumeSubAgent = tool<any, any>({
  description: `Resume a failed or interrupted sub-agent.

Use when:
- Status shows "error"
- Task was interrupted
- You have new info that might help`,
  inputSchema: z.object({
    sub_agent_id: z.string().describe("Sub-agent ID to resume"),
    reason: z.string().optional().describe("Why resuming"),
    bypass_circuit_breaker: z.boolean().default(false).describe("Skip protection"),
  }),
  execute: async ({
    sub_agent_id,
    reason,
    bypass_circuit_breaker,
  }: {
    sub_agent_id: string;
    reason?: string;
    bypass_circuit_breaker: boolean;
  }) => {
    const model = getDefaultModel();
    if (!model) {
      return { success: false, error: "No LLM provider configured" };
    }

    const ctx = getToolContext();
    const resumed = await resumeTask(sub_agent_id, model, getToolsForSubAgent(), {
      reason,
      bypassCircuitBreaker: bypass_circuit_breaker,
      toolContext: ctx,
    });

    return {
      success: resumed.success,
      sub_agent_id,
      resumed: true,
      result: resumed.result,
      steps: resumed.steps,
      tokens_used: resumed.tokens_used,
      error: resumed.error,
      execution_time_ms: resumed.execution_time_ms,
    };
  },
});
