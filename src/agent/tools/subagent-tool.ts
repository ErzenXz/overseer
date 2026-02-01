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
];

export const spawnSubAgent = tool({
  description: `Spawn a specialized sub-agent to handle complex tasks. Sub-agents are specialized in specific domains:
- code: Code generation, modification, and review
- file: File system operations (read, write, copy, move, search)
- git: Version control operations (commits, branches, merges)
- system: System administration (processes, services, packages)
- web: Web operations and API calls
- docker: Container management
- db: Database operations
- security: Security and firewall operations
- network: Network diagnostics

Use this when a task requires specialized expertise or when you want to delegate work.`,
  parameters: z.object({
    type: z
      .enum(["code", "file", "git", "system", "web", "docker", "db", "security", "network"])
      .describe("The type of specialized sub-agent to spawn"),
    task: z
      .string()
      .describe("The specific task to assign to the sub-agent"),
    wait_for_result: z
      .boolean()
      .default(true)
      .describe("Whether to wait for the sub-agent to complete (default: true)"),
    context: z
      .string()
      .optional()
      .describe("Additional context or information to provide to the sub-agent"),
  }),
  execute: async ({ type, task, wait_for_result, context }) => {
    const startTime = Date.now();
    const sessionId = uuidv4();

    logger.info("Spawning sub-agent", { type, task: task.substring(0, 100), wait_for_result });

    try {
      // Build the full task with context if provided
      const fullTask = context ? `${task}\n\nContext: ${context}` : task;

      // Create the sub-agent
      const subAgent = createSubAgent({
        parent_session_id: sessionId,
        agent_type: type as SubAgentType,
        assigned_task: fullTask,
        metadata: {
          spawned_at: new Date().toISOString(),
          wait_for_result,
        },
      });

      if (!wait_for_result) {
        // Return immediately with the sub-agent ID for later reference
        return {
          success: true,
          sub_agent_id: subAgent.sub_agent_id,
          type: subAgent.agent_type,
          status: "working",
          message: `Sub-agent spawned and working on task. ID: ${subAgent.sub_agent_id}`,
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
        type: subAgent.agent_type,
        status: result.success ? "completed" : "error",
        result: result.result,
        steps: result.steps,
        tokens_used: result.tokens_used,
        error: result.error,
        execution_time_ms: result.execution_time_ms,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error("Failed to spawn sub-agent", { type, error: errorMessage });

      return {
        success: false,
        error: `Failed to spawn sub-agent: ${errorMessage}`,
        execution_time_ms: Date.now() - startTime,
      };
    }
  },
});

export const checkSubAgentStatus = tool({
  description: "Check the status of a previously spawned sub-agent",
  parameters: z.object({
    sub_agent_id: z.string().describe("The ID of the sub-agent to check"),
  }),
  execute: async ({ sub_agent_id }) => {
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
