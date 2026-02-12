/**
 * Sub-Agent Tool
 * Allows the main agent to spawn specialized sub-agents for complex tasks
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
  selectAgentForTask,
  type SubAgentType,
} from "../subagents/manager";
import { allTools } from "./index";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("tools:subagent");

// Valid sub-agent types
const SUB_AGENT_TYPES: SubAgentType[] = [
  "code",
  "file",
  "git",
  "system",
  "web",
  "docker",
  "db",
  "security",
  "network",
  "planner",
  "evaluator",
  "coordinator",
];

type RequestedSubAgentType = SubAgentType | "auto";

export const spawnSubAgent = tool<any, any>({
  description: `Spawn a specialized sub-agent to handle a focused task autonomously. The sub-agent runs with its own LLM context and full tool access.

CRITICAL MODEL NOTE:
- Sub-agents are orchestrated workers under the main agent.
- They use the same tool ecosystem as the orchestrator (built-in tools, MCP tools, and skills-derived tools).
- Treat sub-agent output as high-signal delegated work that is returned to the main agent for final synthesis.

AVAILABLE TYPES:
- code: Code generation, modification, review, refactoring, and debugging.
- file: File system operations — bulk copy, move, rename, search, and organization.
- git: Version control — commits, branches, merges, rebases, conflict resolution.
- system: System administration — processes, services, packages, cron, users.
- web: Web scraping, API calls, curl/wget operations, endpoint testing.
- docker: Container management — build, run, compose, images, volumes, networks.
- db: Database operations — queries, migrations, backups, schema inspection.
- security: Security auditing, firewall rules, SSL certs, user permissions.
- network: Network diagnostics — ping, traceroute, DNS, port scanning, connectivity.
- planner: Complex plan decomposition and dependency graph design.
- evaluator: Quality scoring and validation of intermediate outputs.
- coordinator: Multi-worker orchestration and result merging.

WHEN TO USE:
- Use for tasks that require focused domain expertise or multi-step operations.
- Use when you want to delegate work so the main conversation stays responsive.
- Good for: "set up a Docker compose stack", "review and refactor this module", "check all open ports".

TASK FORMULATION TIPS:
- Be specific and self-contained: include all relevant file paths, branch names, or service names in the task description.
- Add context for ambiguous tasks: use the "context" parameter to pass relevant background info.
- BAD: "fix the bug" — too vague, the sub-agent has no conversation history.
- GOOD: "In /app/src/auth/login.ts, the validateToken function on line 45 returns undefined when the token is expired instead of throwing an AuthError. Fix it to throw AuthError('TOKEN_EXPIRED')."

EXECUTION MODES:
- wait_for_result: false (default) — returns immediately with a sub_agent_id and starts execution in background. Use this to keep the main conversation responsive.
- wait_for_result: true — blocks until the sub-agent finishes and returns the result. Use only when you immediately need the output to continue.`,
  inputSchema: z.object({
    type: z
      .enum([
        "auto",
        "code",
        "file",
        "git",
        "system",
        "web",
        "docker",
        "db",
        "security",
        "network",
        "planner",
        "evaluator",
        "coordinator",
      ])
      .describe(
        "The type of specialized sub-agent to spawn. Use 'auto' for generic task routing.",
      ),
    task: z.string().describe("The specific task to assign to the sub-agent"),
    wait_for_result: z
      .boolean()
      .default(false)
      .describe(
        "Whether to wait for the sub-agent to complete (default: false, background mode)",
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Additional context or information to provide to the sub-agent",
      ),
  }),
  execute: async ({
    type,
    task,
    wait_for_result,
    context,
  }: {
    type: RequestedSubAgentType;
    task: string;
    wait_for_result: boolean;
    context?: string;
  }) => {
    const startTime = Date.now();
    const sessionId = uuidv4();

    logger.info("Spawning sub-agent", {
      type,
      task: task.substring(0, 100),
      wait_for_result,
    });

    try {
      // Build the full task with context if provided
      const fullTask = context ? `${task}\n\nContext: ${context}` : task;

      // Auto-route generic tasks to the best agent type
      const resolvedType: SubAgentType =
        type === "auto" ? selectAgentForTask(fullTask) : type;

      // Create the sub-agent
      const subAgent = createSubAgent({
        parent_session_id: sessionId,
        agent_type: resolvedType,
        assigned_task: fullTask,
        metadata: {
          spawned_at: new Date().toISOString(),
          wait_for_result,
          requested_type: type,
          resolved_type: resolvedType,
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

        // Fire-and-forget autonomous execution so the main agent can continue immediately
        void executeTask(subAgent.sub_agent_id, model, allTools).catch(
          (error) => {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            logger.error("Background sub-agent execution failed", {
              sub_agent_id: subAgent.sub_agent_id,
              resolvedType,
              error: errorMessage,
            });
          },
        );

        // Return immediately with the sub-agent ID for later reference
        return {
          success: true,
          sub_agent_id: subAgent.sub_agent_id,
          requested_type: type,
          type: subAgent.agent_type,
          status: "working",
          mode: "background",
          message: `Sub-agent spawned in background and started autonomously. ID: ${subAgent.sub_agent_id}`,
          next_steps:
            "Continue helping the user immediately. Check progress with checkSubAgentStatus using this sub_agent_id.",
          execution_time_ms: Date.now() - startTime,
        };
      }

      // Get the model for the sub-agent
      const model = getDefaultModel();
      if (!model) {
        return {
          success: false,
          error: "No LLM provider configured for sub-agent",
          execution_time_ms: Date.now() - startTime,
        };
      }

      // Execute the task and wait for result
      const result = await executeTask(subAgent.sub_agent_id, model, allTools);

      logger.info("Sub-agent completed", {
        type,
        success: result.success,
        steps: result.steps,
        execution_time_ms: result.execution_time_ms,
      });

      return {
        success: result.success,
        sub_agent_id: subAgent.sub_agent_id,
        requested_type: type,
        type: subAgent.agent_type,
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

      logger.error("Failed to spawn sub-agent", { type, error: errorMessage });

      return {
        success: false,
        error: `Failed to spawn sub-agent: ${errorMessage}`,
        execution_time_ms: Date.now() - startTime,
      };
    }
  },
});

export const resumeSubAgent = tool<any, any>({
  description: `Resume a previously failed or interrupted sub-agent run. This tool appends checkpoint context and retries execution.

Use when:
- checkSubAgentStatus reports status=error
- a long-running task appears interrupted
- circuit breaker or timeout errors need a controlled retry`,
  inputSchema: z.object({
    sub_agent_id: z.string().describe("Sub-agent ID to resume"),
    reason: z
      .string()
      .optional()
      .describe("Why this resume is being requested"),
    bypass_circuit_breaker: z
      .boolean()
      .default(false)
      .describe("Use true only for manual recovery attempts"),
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
      return {
        success: false,
        error: "No LLM provider configured for sub-agent resume",
      };
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

export const checkSubAgentStatus = tool<any, any>({
  description: `Check the status of a previously spawned sub-agent by its ID.

WHEN TO USE:
- After spawning a sub-agent with wait_for_result: false, use this to poll for completion.
- Returns the sub-agent's current status (working/completed/error), result, step count, and token usage.

POLLING PATTERN:
- Call this periodically (e.g., every 5-10 seconds) while the sub-agent status is "working".
- Once status is "completed" or "error", the sub-agent is done — read the result or error field.
- Do NOT poll more than 30 times — if the sub-agent hasn't finished, it may be stuck.`,
  inputSchema: z.object({
    sub_agent_id: z.string().describe("The ID of the sub-agent to check"),
  }),
  execute: async ({ sub_agent_id }: { sub_agent_id: string }) => {
    const subAgent = findBySubAgentId(sub_agent_id);

    if (!subAgent) {
      return {
        success: false,
        error: `Sub-agent with ID ${sub_agent_id} not found`,
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
