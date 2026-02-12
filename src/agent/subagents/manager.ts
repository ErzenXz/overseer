/**
 * Enhanced Sub-Agent System
 * Manages specialized sub-agents with circuit breakers, health monitoring, and orchestration
 */

import { db } from "../../database/db";
import { createLogger } from "../../lib/logger";
import { circuitBreakerManager } from "../../lib/circuit-breaker";
import { poolManager } from "../../lib/resource-pool";
import { agentCache } from "@/lib/agent-cache";
import { v4 as uuidv4 } from "uuid";
import { generateText, stepCountIs, type LanguageModel, type Tool } from "ai";

const logger = createLogger("sub-agents");

export type SubAgentType =
  | "code" // Code generation and modification
  | "file" // File operations specialist
  | "git" // Git operations specialist
  | "system" // System administration
  | "web" // Web scraping and API calls
  | "docker" // Container management
  | "db" // Database operations
  | "security" // Security and firewall
  | "network" // Network diagnostics
  | "planner" // Task decomposition and planning
  | "evaluator" // Quality evaluation and review
  | "coordinator"; // Multi-agent coordination

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

export interface ExecutionNode {
  id: string;
  agentType: SubAgentType;
  task: string;
  dependencies: string[];
  status: "pending" | "running" | "completed" | "failed";
  result?: TaskResult;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionGraph {
  id: string;
  nodes: ExecutionNode[];
  createdAt: number;
  completedAt?: number;
  status: "pending" | "running" | "completed" | "failed";
}

// Sub-agent configurations
const SUB_AGENT_CONFIGS: Record<
  SubAgentType,
  {
    name: string;
    description: string;
    system_prompt: string;
    tools?: string[];
    priority?: number;
  }
> = {
  code: {
    name: "Code Agent",
    description: "Specializes in code generation, modification, and review",
    system_prompt: `You are a specialized code agent. Your tasks:
- Write, modify, and review code
- Follow best practices and language conventions
- Explain your changes clearly
- Handle errors gracefully
Always output complete, working code files.`,
    tools: ["readFile", "writeFile", "listDirectory", "executeShellCommand"],
    priority: 7,
  },
  file: {
    name: "File Agent",
    description: "Specializes in file system operations",
    system_prompt: `You are a specialized file operations agent. Your tasks:
- Read, write, copy, move, delete files
- Search for files and content
- Manage directories
- Handle large files efficiently
Always verify operations before destructive actions.`,
    tools: ["readFile", "writeFile", "listDirectory", "executeShellCommand"],
    priority: 5,
  },
  git: {
    name: "Git Agent",
    description: "Specializes in version control operations",
    system_prompt: `You are a specialized Git agent. Your tasks:
- Manage branches, commits, and merges
- Handle pull/push operations
- Resolve conflicts
- Review changes
Always explain the git operations you're performing.`,
    tools: ["executeShellCommand"],
    priority: 6,
  },
  system: {
    name: "System Agent",
    description: "Specializes in system administration",
    system_prompt: `You are a specialized system administration agent. Your tasks:
- Manage processes and services
- Monitor system resources
- Handle package installations
- Configure system settings
Always check system state before making changes.`,
    tools: ["executeShellCommand"],
    priority: 8,
  },
  web: {
    name: "Web Agent",
    description: "Specializes in web operations and API calls",
    system_prompt: `You are a specialized web agent. Your tasks:
- Make HTTP requests
- Scrape web content
- Test APIs
- Handle webhooks
Always respect rate limits and handle errors gracefully.`,
    tools: ["executeShellCommand"],
    priority: 5,
  },
  docker: {
    name: "Docker Agent",
    description: "Specializes in container management",
    system_prompt: `You are a specialized Docker agent. Your tasks:
- Manage containers and images
- Build and deploy containers
- Handle Docker Compose
- Monitor container health
Always check container status before operations.`,
    tools: ["executeShellCommand"],
    priority: 6,
  },
  db: {
    name: "Database Agent",
    description: "Specializes in database operations",
    system_prompt: `You are a specialized database agent. Your tasks:
- Query and modify databases
- Handle migrations
- Backup and restore data
- Optimize queries
Always backup before destructive operations.`,
    tools: ["executeShellCommand", "readFile"],
    priority: 7,
  },
  security: {
    name: "Security Agent",
    description: "Specializes in security operations",
    system_prompt: `You are a specialized security agent. Your tasks:
- Manage firewalls
- Handle SSL certificates
- Check for vulnerabilities
- Review permissions
Always prioritize security best practices.`,
    tools: ["executeShellCommand", "readFile", "listDirectory"],
    priority: 9,
  },
  network: {
    name: "Network Agent",
    description: "Specializes in network diagnostics",
    system_prompt: `You are a specialized network agent. Your tasks:
- Test connectivity
- Diagnose network issues
- Check DNS resolution
- Monitor network interfaces
Always provide clear diagnostic information.`,
    tools: ["executeShellCommand"],
    priority: 5,
  },
  planner: {
    name: "Planner Agent",
    description: "Decomposes complex tasks into actionable steps",
    system_prompt: `You are a specialized planning agent. Your tasks:
- Analyze complex tasks and break them into steps
- Identify dependencies between subtasks
- Suggest the best agent type for each step
- Create execution plans with proper sequencing
- Estimate task complexity and duration

Output your plans in a structured format:
1. Step description
2. Required agent type
3. Dependencies (which steps must complete first)
4. Estimated complexity (low/medium/high)`,
    tools: ["readFile", "listDirectory", "executeShellCommand"],
    priority: 10,
  },
  evaluator: {
    name: "Evaluator Agent",
    description: "Reviews outputs from other agents for quality",
    system_prompt: `You are a specialized evaluation agent. Your tasks:
- Review outputs from other agents
- Check for completeness and correctness
- Identify potential issues or improvements
- Provide constructive feedback
- Assign quality scores

Evaluation criteria:
- Correctness: Does it solve the problem?
- Completeness: Are all requirements met?
- Quality: Is it well-structured and maintainable?
- Best practices: Does it follow conventions?

Output format:
- Score: 1-10
- Strengths: What was done well
- Issues: Problems found
- Recommendations: Suggested improvements`,
    tools: ["readFile", "listDirectory", "executeShellCommand"],
    priority: 6,
  },
  coordinator: {
    name: "Coordinator Agent",
    description: "Orchestrates multiple parallel subagents",
    system_prompt: `You are a specialized coordination agent. Your tasks:
- Manage execution of multiple agents
- Handle parallel and sequential workflows
- Aggregate results from multiple agents
- Handle failures and fallbacks
- Optimize resource allocation

You coordinate but don't execute tasks directly. Delegate to specialized agents.`,
    tools: ["readFile"],
    priority: 8,
  },
};

/**
 * Health metrics for each agent type
 */
interface HealthMetrics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  successRate: number;
  lastExecutionAt?: number;
  recentExecutions: Array<{
    timestamp: number;
    success: boolean;
    executionTime: number;
  }>;
}

// Health metrics storage
const healthMetrics = new Map<SubAgentType, HealthMetrics>();

// Initialize health metrics for all agent types
for (const type of Object.keys(SUB_AGENT_CONFIGS) as SubAgentType[]) {
  healthMetrics.set(type, {
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    totalExecutionTime: 0,
    averageExecutionTime: 0,
    successRate: 1.0,
    recentExecutions: [],
  });
}

/**
 * Update health metrics for an agent type
 */
function updateHealthMetrics(
  type: SubAgentType,
  success: boolean,
  executionTime: number,
): void {
  const metrics = healthMetrics.get(type)!;

  metrics.totalExecutions++;
  metrics.totalExecutionTime += executionTime;
  metrics.lastExecutionAt = Date.now();

  if (success) {
    metrics.successCount++;
  } else {
    metrics.failureCount++;
  }

  metrics.successRate = metrics.successCount / metrics.totalExecutions;
  metrics.averageExecutionTime =
    metrics.totalExecutionTime / metrics.totalExecutions;

  // Keep last 50 executions
  metrics.recentExecutions.push({
    timestamp: Date.now(),
    success,
    executionTime,
  });

  if (metrics.recentExecutions.length > 50) {
    metrics.recentExecutions.shift();
  }

  healthMetrics.set(type, metrics);
}

/**
 * Get health metrics for an agent type
 */
export function getHealthMetrics(type: SubAgentType): HealthMetrics | null {
  return healthMetrics.get(type) || null;
}

/**
 * Get health metrics for all agent types
 */
export function getAllHealthMetrics(): Record<string, HealthMetrics> {
  const metrics: Record<string, HealthMetrics> = {};
  for (const [type, data] of healthMetrics.entries()) {
    metrics[type] = data;
  }
  return metrics;
}

/**
 * Detect performance degradation
 */
export function detectPerformanceDegradation(type: SubAgentType): {
  degraded: boolean;
  reasons: string[];
} {
  const metrics = healthMetrics.get(type);
  if (!metrics || metrics.totalExecutions < 10) {
    return { degraded: false, reasons: [] };
  }

  const reasons: string[] = [];
  let degraded = false;

  // Check success rate
  if (metrics.successRate < 0.7) {
    degraded = true;
    reasons.push(
      `Low success rate: ${(metrics.successRate * 100).toFixed(1)}%`,
    );
  }

  // Check recent failures
  const recentCount = Math.min(10, metrics.recentExecutions.length);
  const recentFailures = metrics.recentExecutions
    .slice(-recentCount)
    .filter((e) => !e.success).length;

  if (recentFailures >= recentCount * 0.5) {
    degraded = true;
    reasons.push(`High recent failure rate: ${recentFailures}/${recentCount}`);
  }

  // Check execution time increase
  const recentAvg =
    metrics.recentExecutions
      .slice(-recentCount)
      .reduce((sum, e) => sum + e.executionTime, 0) / recentCount;

  if (recentAvg > metrics.averageExecutionTime * 1.5) {
    degraded = true;
    reasons.push(
      `Execution time increased: ${Math.round(recentAvg)}ms vs ${Math.round(metrics.averageExecutionTime)}ms avg`,
    );
  }

  return { degraded, reasons };
}

/**
 * Smart routing: Select best agent for a task
 */
export function selectAgentForTask(taskDescription: string): SubAgentType {
  const keywords: Record<SubAgentType, string[]> = {
    code: [
      "code",
      "function",
      "class",
      "implement",
      "refactor",
      "bug",
      "syntax",
    ],
    file: [
      "file",
      "directory",
      "read",
      "write",
      "copy",
      "move",
      "delete",
      "search",
    ],
    git: [
      "git",
      "commit",
      "branch",
      "merge",
      "pull",
      "push",
      "repository",
      "version",
    ],
    system: ["install", "service", "process", "system", "restart", "configure"],
    web: ["http", "api", "request", "fetch", "curl", "scrape", "endpoint"],
    docker: ["docker", "container", "image", "compose", "dockerfile"],
    db: ["database", "query", "sql", "table", "migration", "backup"],
    security: [
      "security",
      "permission",
      "firewall",
      "certificate",
      "ssl",
      "vulnerability",
    ],
    network: ["network", "ping", "connectivity", "dns", "port", "connection"],
    planner: ["plan", "steps", "organize", "decompose", "strategy", "complex"],
    evaluator: ["review", "check", "evaluate", "quality", "validate", "assess"],
    coordinator: [
      "coordinate",
      "multiple",
      "parallel",
      "orchestrate",
      "manage",
    ],
  };

  const lowerTask = taskDescription.toLowerCase();
  const scores = new Map<SubAgentType, number>();

  // Score each agent type based on keyword matches
  for (const [type, words] of Object.entries(keywords)) {
    let score = 0;
    for (const word of words) {
      if (lowerTask.includes(word)) {
        score++;
      }
    }

    // Factor in health metrics
    const health = healthMetrics.get(type as SubAgentType);
    if (health && health.totalExecutions > 0) {
      score *= health.successRate;
    }

    scores.set(type as SubAgentType, score);
  }

  // Find agent with highest score
  let bestAgent: SubAgentType = "code";
  let bestScore = 0;

  for (const [type, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestAgent = type;
    }
  }

  logger.debug("Agent selected for task", {
    task: taskDescription.substring(0, 50),
    selected: bestAgent,
    score: bestScore,
  });

  return bestAgent;
}

/**
 * Create a new sub-agent
 */
export function createSubAgent(input: CreateSubAgentInput): SubAgent {
  const config = SUB_AGENT_CONFIGS[input.agent_type];
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
    input.name || config.name,
    input.description || config.description,
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

/**
 * Find sub-agent by ID
 */
export function findById(id: number): SubAgent | null {
  const stmt = db.prepare("SELECT * FROM sub_agents WHERE id = ?");
  return stmt.get(id) as SubAgent | null;
}

/**
 * Find sub-agent by sub_agent_id
 */
export function findBySubAgentId(subAgentId: string): SubAgent | null {
  const stmt = db.prepare("SELECT * FROM sub_agents WHERE sub_agent_id = ?");
  return stmt.get(subAgentId) as SubAgent | null;
}

/**
 * Get sub-agents for a parent session
 */
export function findByParentSession(parentSessionId: string): SubAgent[] {
  const stmt = db.prepare(`
    SELECT * FROM sub_agents 
    WHERE parent_session_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(parentSessionId) as SubAgent[];
}

/**
 * Update sub-agent status
 */
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
  const values: any[] = [status];

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

/**
 * Execute a task with a sub-agent (with circuit breaker and resource pool)
 */
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

  const agentType = subAgent.agent_type as SubAgentType;
  const config = SUB_AGENT_CONFIGS[agentType];

  const cacheKey = [
    "subagent:v2",
    agentType,
    (model as { modelId?: string }).modelId ?? "unknown",
    subAgent.assigned_task ?? "",
    Object.keys(availableTools).join(","),
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

  // Check for performance degradation
  const degradation = detectPerformanceDegradation(agentType);
  if (degradation.degraded) {
    logger.warn("Performance degradation detected", {
      agentType,
      reasons: degradation.reasons,
    });
  }

  // Execute with circuit breaker and resource pool
  try {
    const executeWithProtection = async (): Promise<TaskResult> => {
      updateStatus(subAgentId, "working");

      // Filter tools for this sub-agent
      const subAgentTools: Record<string, Tool> = {};
      if (config.tools) {
        for (const toolName of config.tools) {
          if (availableTools[toolName]) {
            subAgentTools[toolName] = availableTools[toolName];
          }
        }
      }

      const result = await generateText({
        model,
        system: config.system_prompt,
        prompt: subAgent.assigned_task || "",
        tools: subAgentTools,
        stopWhen: stepCountIs(20),
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
        type: subAgent.agent_type,
        steps: result.steps?.length || 0,
        executionTime,
      });

      // Update health metrics
      updateHealthMetrics(agentType, true, executionTime);

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

    // Use resource pool for concurrent execution limiting
    const poolKey = `subagent-${agentType}`;
    const priority = options.priority ?? config.priority ?? 5;

    // Execute with circuit breaker protection (unless bypassed)
    if (options.bypassCircuitBreaker) {
      const output = await poolManager.execute(
        poolKey,
        `${agentType}-${subAgentId}`,
        executeWithProtection,
        { priority, timeout: options.timeout },
      );

      agentCache.set({
        scope: "subagent",
        key: cacheKey,
        value: output,
        ttlSeconds: output.success ? 900 : 60,
        tags: ["subagent", agentType],
      });

      return output;
    } else {
      const output = await poolManager.execute(
        poolKey,
        `${agentType}-${subAgentId}`,
        () =>
          circuitBreakerManager.execute(
            `subagent-${agentType}`,
            executeWithProtection,
          ),
        { priority, timeout: options.timeout },
      );

      agentCache.set({
        scope: "subagent",
        key: cacheKey,
        value: output,
        ttlSeconds: output.success ? 900 : 60,
        tags: ["subagent", agentType],
      });

      return output;
    }
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    updateStatus(subAgentId, "error", {
      task_result: errorMessage,
    });

    // Update health metrics
    updateHealthMetrics(agentType, false, executionTime);

    logger.error("Sub-agent task failed", {
      subAgentId,
      type: agentType,
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

/**
 * Resume a sub-agent task by re-executing with checkpoint context.
 */
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

/**
 * Execute multiple tasks in parallel
 */
export async function executeParallel(
  tasks: Array<{
    agentType: SubAgentType;
    task: string;
    context?: string;
  }>,
  parentSessionId: string,
  model: LanguageModel,
  availableTools: Record<string, Tool>,
): Promise<TaskResult[]> {
  logger.info("Executing tasks in parallel", {
    count: tasks.length,
    types: tasks.map((t) => t.agentType),
  });

  const promises = tasks.map(async ({ agentType, task, context }) => {
    const fullTask = context ? `${task}\n\nContext: ${context}` : task;
    const subAgent = createSubAgent({
      parent_session_id: parentSessionId,
      agent_type: agentType,
      assigned_task: fullTask,
    });

    return executeTask(subAgent.sub_agent_id, model, availableTools);
  });

  return Promise.all(promises);
}

/**
 * Execute tasks sequentially with dependency management
 */
export async function executeSequential(
  tasks: Array<{
    agentType: SubAgentType;
    task: string;
    context?: string;
  }>,
  parentSessionId: string,
  model: LanguageModel,
  availableTools: Record<string, Tool>,
): Promise<TaskResult[]> {
  logger.info("Executing tasks sequentially", {
    count: tasks.length,
    types: tasks.map((t) => t.agentType),
  });

  const results: TaskResult[] = [];
  let aggregatedContext = "";

  for (const { agentType, task, context } of tasks) {
    const fullContext = [context, aggregatedContext]
      .filter(Boolean)
      .join("\n\n");
    const fullTask = fullContext ? `${task}\n\nContext: ${fullContext}` : task;

    const subAgent = createSubAgent({
      parent_session_id: parentSessionId,
      agent_type: agentType,
      assigned_task: fullTask,
    });

    const result = await executeTask(
      subAgent.sub_agent_id,
      model,
      availableTools,
    );
    results.push(result);

    // Add result to context for next task
    if (result.success) {
      aggregatedContext += `\n\nPrevious step (${agentType}): ${result.result.substring(0, 500)}`;
    }

    // Stop on failure unless explicitly continuing
    if (!result.success) {
      logger.warn("Sequential execution stopped due to failure", {
        failedAgent: agentType,
        completedTasks: results.length,
      });
      break;
    }
  }

  return results;
}

/**
 * Execute an execution graph with dependency management
 */
export async function executeGraph(
  graph: ExecutionGraph,
  parentSessionId: string,
  model: LanguageModel,
  availableTools: Record<string, Tool>,
): Promise<ExecutionGraph> {
  logger.info("Executing execution graph", {
    graphId: graph.id,
    nodeCount: graph.nodes.length,
  });

  graph.status = "running";
  const nodeResults = new Map<string, TaskResult>();

  // Helper to check if all dependencies are completed
  const areDependenciesCompleted = (node: ExecutionNode): boolean => {
    return node.dependencies.every((depId) => {
      const depNode = graph.nodes.find((n) => n.id === depId);
      return depNode?.status === "completed";
    });
  };

  // Execute nodes in order of dependencies
  while (
    graph.nodes.some((n) => n.status === "pending" || n.status === "running")
  ) {
    // Find nodes ready to execute (dependencies met)
    const readyNodes = graph.nodes.filter(
      (node) => node.status === "pending" && areDependenciesCompleted(node),
    );

    if (readyNodes.length === 0) {
      // Check if we're stuck (all pending nodes have unmet dependencies)
      const pendingCount = graph.nodes.filter(
        (n) => n.status === "pending",
      ).length;
      if (pendingCount > 0) {
        logger.error("Execution graph deadlock detected", {
          graphId: graph.id,
          pendingNodes: pendingCount,
        });
        graph.status = "failed";
        break;
      }

      // Wait for running nodes
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    // Execute ready nodes in parallel
    await Promise.all(
      readyNodes.map(async (node) => {
        node.status = "running";
        node.startedAt = Date.now();

        // Gather context from dependencies
        const depContext = node.dependencies
          .map((depId) => {
            const result = nodeResults.get(depId);
            return result?.success
              ? `Dependency ${depId}: ${result.result}`
              : null;
          })
          .filter(Boolean)
          .join("\n\n");

        const fullTask = depContext
          ? `${node.task}\n\nDependency Results:\n${depContext}`
          : node.task;

        const subAgent = createSubAgent({
          parent_session_id: parentSessionId,
          agent_type: node.agentType,
          assigned_task: fullTask,
        });

        try {
          const result = await executeTask(
            subAgent.sub_agent_id,
            model,
            availableTools,
          );
          node.result = result;
          node.status = result.success ? "completed" : "failed";
          node.completedAt = Date.now();
          nodeResults.set(node.id, result);

          if (!result.success) {
            logger.warn("Graph node failed", {
              graphId: graph.id,
              nodeId: node.id,
              agentType: node.agentType,
            });
          }
        } catch (error) {
          node.status = "failed";
          node.completedAt = Date.now();
          logger.error("Graph node error", {
            graphId: graph.id,
            nodeId: node.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }

  // Check final status
  const allCompleted = graph.nodes.every((n) => n.status === "completed");
  const anyFailed = graph.nodes.some((n) => n.status === "failed");

  graph.status = allCompleted
    ? "completed"
    : anyFailed
      ? "failed"
      : "completed";
  graph.completedAt = Date.now();

  logger.info("Execution graph completed", {
    graphId: graph.id,
    status: graph.status,
    duration: graph.completedAt - graph.createdAt,
  });

  return graph;
}

/**
 * Get sub-agent configuration
 */
export function getSubAgentConfig(type: SubAgentType) {
  return SUB_AGENT_CONFIGS[type];
}

/**
 * Get all sub-agent types
 */
export function getAllSubAgentTypes(): SubAgentType[] {
  return Object.keys(SUB_AGENT_CONFIGS) as SubAgentType[];
}

/**
 * Get statistics for sub-agents
 */
export function getStats(): {
  total: number;
  by_type: Record<string, number>;
  completed: number;
  error: number;
  working: number;
} {
  const stats = db
    .prepare(
      `
    SELECT 
      COUNT(*) as total,
      agent_type,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
      SUM(CASE WHEN status = 'working' THEN 1 ELSE 0 END) as working
    FROM sub_agents
    GROUP BY agent_type
  `,
    )
    .all() as any[];

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

/**
 * Get circuit breaker status for all agent types
 */
export function getCircuitBreakerStatus(): Array<{
  agentType: SubAgentType;
  state: string;
  failureRate: number;
}> {
  return getAllSubAgentTypes().map((type) => {
    const breaker = circuitBreakerManager.getBreaker(`subagent-${type}`);
    const metrics = breaker.getMetrics();
    return {
      agentType: type,
      state: metrics.state,
      failureRate: metrics.recentFailureRate,
    };
  });
}
