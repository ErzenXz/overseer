/**
 * Sub-Agent System
 * 
 * Simple but powerful: spawn a generic worker that has access to EVERYTHING
 * (all built-in tools, MCP tools, skill tools)
 */

import { db } from "../../database/db";
import { createLogger } from "../../lib/logger";
import { circuitBreakerManager } from "../../lib/circuit-breaker";
import { poolManager } from "../../lib/resource-pool";
import { agentCache } from "@/lib/agent-cache";
import { v4 as uuidv4 } from "uuid";
import { generateText, stepCountIs, type LanguageModel, type Tool } from "ai";

const logger = createLogger("sub-agents");

export type SubAgentType = "generic";

export interface SubAgent {
  id: number;
  parent_session_id: string;
  sub_agent_id: string;
  agent_type: SubAgentType;
  name: string;
  description: string | null;
  status: "idle" | "working" | "completed" | "error";
  assigned_task: string | null;
  task_result: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  step_count: number;
  tokens_used: number;
  metadata: string | null;
}

export interface CreateSubAgentInput {
  parent_session_id: string;
  agent_type: SubAgentType;
  name?: string;
  description?: string;
  assigned_task?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  success: boolean;
  result: string;
  steps: number;
  tokens_used: number;
  execution_time_ms: number;
  error?: string;
  agent_id?: string;
  resumed?: boolean;
}

const SUB_AGENT_CONFIG = {
  name: "Worker",
  description: "Generic worker with full tool access",
  system_prompt: `You are a capable assistant working under Overseer.

YOUR ROLE:
- You receive a specific task from Overseer (the main agent)
- You have FULL access to all tools: shell, files, MCP tools, skill tools
- Your job is to complete the task thoroughly and return a useful result
- You work autonomously — figure out what needs to be done and do it

TOOLS YOU HAVE:
- Shell: run any command (bash, git, npm, docker, etc.)
- Files: read, write, list files
- Cron: manage scheduled jobs
- MCP: tools from connected MCP servers
- Skills: specialized skill tools

HOW TO WORK:
1. Understand the task fully
2. Plan your approach
3. Execute step by step, verify as you go
4. Return a complete result

STYLE:
- Be practical, not performative
- Solve the problem, don't just give advice
- If something goes wrong, fix it or explain the blocker
- Verify important results

You're a trusted teammate. Overseer is counting on you.`,
  priority: 5,
};

export function selectAgentForTask(taskDescription: string): SubAgentType {
  return "generic";
}

export function createSubAgent(input: CreateSubAgentInput): SubAgent {
  const subAgentId = uuidv4();

  const stmt = db.prepare(`
    INSERT INTO sub_agents (
      parent_session_id, sub_agent_id, agent_type, name, description,
      status, assigned_task, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.parent_session_id,
    subAgentId,
    input.agent_type,
    input.name || SUB_AGENT_CONFIG.name,
    input.description || SUB_AGENT_CONFIG.description,
    "idle",
    input.assigned_task || null,
    input.metadata ? JSON.stringify(input.metadata) : null,
  );

  logger.info("Created sub-agent", {
    subAgentId,
    type: input.agent_type,
    parent: input.parent_session_id,
  });

  return findById(result.lastInsertRowid as number)!;
}

export function findById(id: number): SubAgent | null {
  const stmt = db.prepare("SELECT * FROM sub_agents WHERE id = ?");
  return stmt.get(id) as SubAgent | null;
}

export function findBySubAgentId(subAgentId: string): SubAgent | null {
  const stmt = db.prepare("SELECT * FROM sub_agents WHERE sub_agent_id = ?");
  return stmt.get(subAgentId) as SubAgent | null;
}

export function findByParentSession(parentSessionId: string): SubAgent[] {
  const stmt = db.prepare(`
    SELECT * FROM sub_agents 
    WHERE parent_session_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(parentSessionId) as SubAgent[];
}

export function updateStatus(
  subAgentId: string,
  status: SubAgent["status"],
  updates?: {
    task_result?: string;
    step_count?: number;
    tokens_used?: number;
  },
): void {
  const fields: string[] = ["status = ?"];
  const values: unknown[] = [status];

  if (status === "working") {
    fields.push("started_at = CURRENT_TIMESTAMP");
  } else if (status === "completed" || status === "error") {
    fields.push("completed_at = CURRENT_TIMESTAMP");
  }

  if (updates?.task_result !== undefined) {
    fields.push("task_result = ?");
    values.push(updates.task_result);
  }
  if (updates?.step_count !== undefined) {
    fields.push("step_count = ?");
    values.push(updates.step_count);
  }
  if (updates?.tokens_used !== undefined) {
    fields.push("tokens_used = ?");
    values.push(updates.tokens_used);
  }

  const stmt = db.prepare(`
    UPDATE sub_agents 
    SET ${fields.join(", ")}
    WHERE sub_agent_id = ?
  `);

  stmt.run(...values, subAgentId);
}

export async function executeTask(
  subAgentId: string,
  model: LanguageModel,
  availableTools: Record<string, Tool>,
  options: {
    priority?: number;
    timeout?: number;
    bypassCircuitBreaker?: boolean;
  } = {},
): Promise<TaskResult> {
  const startTime = Date.now();
  const subAgent = findBySubAgentId(subAgentId);

  if (!subAgent) {
    return {
      success: false,
      result: "",
      steps: 0,
      tokens_used: 0,
      execution_time_ms: 0,
      error: "Sub-agent not found",
    };
  }

  if (!subAgent.assigned_task) {
    return {
      success: false,
      result: "",
      steps: 0,
      tokens_used: 0,
      execution_time_ms: 0,
      error: "No task assigned",
    };
  }

  const cacheKey = [
    "subagent:v3",
    (model as { modelId?: string }).modelId ?? "unknown",
    subAgent.assigned_task ?? "",
    Object.keys(availableTools).length,
  ].join("|");

  const cached = agentCache.get<TaskResult>("subagent", cacheKey);
  if (cached) {
    updateStatus(subAgentId, "completed", {
      task_result: cached.result,
      step_count: cached.steps,
      tokens_used: cached.tokens_used,
    });

    return {
      ...cached,
      agent_id: subAgentId,
      resumed: false,
    };
  }

  try {
    const executeWithProtection = async (): Promise<TaskResult> => {
      updateStatus(subAgentId, "working");

      const result = await generateText({
        model,
        system: SUB_AGENT_CONFIG.system_prompt,
        prompt: subAgent.assigned_task || "",
        tools: availableTools,
        stopWhen: stepCountIs(25),
      });

      const executionTime = Date.now() - startTime;

      updateStatus(subAgentId, "completed", {
        task_result: result.text,
        step_count: result.steps?.length || 0,
        tokens_used:
          (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
      });

      logger.info("Sub-agent completed task", {
        subAgentId,
        steps: result.steps?.length || 0,
        executionTime,
      });

      return {
        success: true,
        result: result.text,
        steps: result.steps?.length || 0,
        tokens_used:
          (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0),
        execution_time_ms: executionTime,
        agent_id: subAgentId,
      };
    };

    const poolKey = `subagent-${subAgentId}`;
    const priority = options.priority ?? SUB_AGENT_CONFIG.priority ?? 5;

    let output: TaskResult;
    
    if (options.bypassCircuitBreaker) {
      output = await poolManager.execute(
        poolKey,
        poolKey,
        executeWithProtection,
        { priority, timeout: options.timeout },
      );
    } else {
      output = await poolManager.execute(
        poolKey,
        poolKey,
        () => circuitBreakerManager.execute(poolKey, executeWithProtection),
        { priority, timeout: options.timeout },
      );
    }

    agentCache.set({
      scope: "subagent",
      key: cacheKey,
      value: output,
      ttlSeconds: output.success ? 900 : 60,
      tags: ["subagent"],
    });

    return output;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    updateStatus(subAgentId, "error", {
      task_result: errorMessage,
    });

    logger.error("Sub-agent task failed", {
      subAgentId,
      error: errorMessage,
    });

    return {
      success: false,
      result: "",
      steps: 0,
      tokens_used: 0,
      execution_time_ms: executionTime,
      error: errorMessage,
      agent_id: subAgentId,
    };
  }
}

export async function resumeTask(
  subAgentId: string,
  model: LanguageModel,
  availableTools: Record<string, Tool>,
  options: {
    bypassCircuitBreaker?: boolean;
    timeout?: number;
    reason?: string;
  } = {},
): Promise<TaskResult> {
  const subAgent = findBySubAgentId(subAgentId);
  if (!subAgent) {
    return {
      success: false,
      result: "",
      steps: 0,
      tokens_used: 0,
      execution_time_ms: 0,
      error: "Sub-agent not found",
      agent_id: subAgentId,
      resumed: true,
    };
  }

  const previousResult = subAgent.task_result ?? "";
  const resumeContext = [
    subAgent.assigned_task ?? "",
    previousResult ? `Previous attempt output/error:\n${previousResult}` : "",
    options.reason
      ? `Resume reason: ${options.reason}`
      : "Resume reason: manual resume request",
    "Continue from previous progress and provide a complete final result.",
  ]
    .filter(Boolean)
    .join("\n\n");

  db.prepare(
    "UPDATE sub_agents SET assigned_task = ? WHERE sub_agent_id = ?",
  ).run(resumeContext, subAgentId);

  const result = await executeTask(subAgentId, model, availableTools, {
    bypassCircuitBreaker: options.bypassCircuitBreaker,
    timeout: options.timeout,
  });

  return {
    ...result,
    resumed: true,
  };
}

export function getSubAgentConfig(type: SubAgentType) {
  return SUB_AGENT_CONFIG;
}

export function getAllSubAgentTypes(): SubAgentType[] {
  return ["generic"];
}

export function getStats(): {
  total: number;
  by_type: Record<string, number>;
  completed: number;
  error: number;
  working: number;
} {
  const stats = db
    .prepare(`
    SELECT 
      COUNT(*) as total,
      agent_type,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
      SUM(CASE WHEN status = 'working' THEN 1 ELSE 0 END) as working
    FROM sub_agents
    GROUP BY agent_type
  `)
    .all() as Array<{
    agent_type: string;
    total: number;
    completed: number;
    error: number;
    working: number;
  }>;

  const byType: Record<string, number> = {};
  let total = 0;
  let completed = 0;
  let error = 0;
  let working = 0;

  for (const row of stats) {
    byType[row.agent_type] = row.total;
    total += row.total;
    completed += row.completed;
    error += row.error;
    working += row.working;
  }

  return { total, by_type: byType, completed, error, working };
}
