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
import {
  createSubAgent,
  executeTask,
  findBySubAgentId,
  resumeTask,
  type SubAgentType,
} from "../subagents/manager";
import { allTools } from "./index";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("tools:subagent");

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
 *   wait_for_result: false
 * })
 * // Continue conversation, check status later
 * 
 * // Need result immediately - wait
 * const result = spawnSubAgent({
 *   task: "Write a unit test for the auth function",
 *   context: "File: src/auth.ts, function: validateToken",
 *   wait_for_result: true
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
- wait_for_result: false (default) → Fire and forget, continue immediately
- wait_for_result: true → Block until complete (only when you need the result now)

EXAMPLES:
spawnSubAgent({ task: "Check if nginx is running on prod-server" })
spawnSubAgent({ task: "Find all users who haven't logged in 90 days", context: "Database at /data/app.db" })
spawnSubAgent({ task: "Write tests for auth.ts validateToken function", wait_for_result: true })`,
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
    wait_for_result: z
      .boolean()
      .default(false)
      .describe(
        `Execution mode:
         
         - false (default): Fire and forget. Sub-agent runs in background.
           Use for parallel work or long tasks. You continue immediately.
         
         - true: Block and wait. Use ONLY when you literally cannot continue
           until you have this result.`,
      ),
  }),
  execute: async ({
    task,
    context,
    wait_for_result,
  }: {
    task: string;
    context?: string;
    wait_for_result: boolean;
  }) => {
    const startTime = Date.now();
    const sessionId = uuidv4();

    logger.info("Spawning sub-agent", {
      task: task.substring(0, 100),
      wait_for_result,
    });

    try {
      const fullTask = context ? `${task}\n\nContext: ${context}` : task;

      const subAgent = createSubAgent({
        parent_session_id: sessionId,
        agent_type: "generic" as SubAgentType,
        assigned_task: fullTask,
        metadata: {
          spawned_at: new Date().toISOString(),
          wait_for_result,
        },
      });

      if (!wait_for_result) {
        const model = getDefaultModel();
        if (!model) {
          return {
            success: false,
            error: "No LLM provider configured for sub-agent",
            sub_agent_id: subAgent.sub_agent_id,
            execution_time_ms: Date.now() - startTime,
          };
        }

        void executeTask(subAgent.sub_agent_id, model, allTools).catch(
          (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            logger.error("Background sub-agent execution failed", {
              sub_agent_id: subAgent.sub_agent_id,
              error: errorMessage,
            });
          },
        );

        return {
          success: true,
          sub_agent_id: subAgent.sub_agent_id,
          status: "working",
          mode: "background",
          message: `Sub-agent spawned and running in background. ID: ${subAgent.sub_agent_id}`,
          next_steps:
            "Continue helping the user. Use checkSubAgentStatus to get the result later.",
          execution_time_ms: Date.now() - startTime,
        };
      }

      const model = getDefaultModel();
      if (!model) {
        return {
          success: false,
          error: "No LLM provider configured for sub-agent",
          execution_time_ms: Date.now() - startTime,
        };
      }

      const result = await executeTask(subAgent.sub_agent_id, model, allTools);

      logger.info("Sub-agent completed", {
        success: result.success,
        steps: result.steps,
        execution_time_ms: result.execution_time_ms,
      });

      return {
        success: result.success,
        sub_agent_id: subAgent.sub_agent_id,
        status: result.success ? "completed" : "error",
        mode: "foreground",
        result: result.result,
        steps: result.steps,
        tokens_used: result.tokens_used,
        error: result.error,
        execution_time_ms: result.execution_time_ms,
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

    const resumed = await resumeTask(sub_agent_id, model, allTools, {
      reason,
      bypassCircuitBreaker: bypass_circuit_breaker,
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
