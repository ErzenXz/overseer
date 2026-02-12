import { generateText, type LanguageModel, type Tool } from "ai";

import { createLogger } from "@/lib/logger";
import { agentCache } from "@/lib/agent-cache";
import {
  createExecutionPlan,
  getPlanStats,
  planToGraph,
  validatePlan,
} from "@/agent/subagents/planner";
import { evaluateMultipleResults } from "@/agent/subagents/evaluator";
import { executeGraph } from "@/agent/subagents/manager";

const logger = createLogger("agent-orchestrator");

export interface OrchestrationOptions {
  parentSessionId: string;
  tools: Record<string, Tool>;
  model: LanguageModel;
  context?: string;
  steering?: string;
}

export interface OrchestrationResult {
  success: boolean;
  text: string;
  planSummary: {
    steps: number;
    parallelizable: boolean;
    estimatedDuration: number;
  };
  quality: {
    overallScore: number;
    passRate: number;
    recommendations: string[];
  };
  raw?: {
    results: Array<{
      success: boolean;
      result: string;
      error?: string;
      agent_id?: string;
    }>;
  };
}

function serializeForCache(input: unknown) {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export async function runPlanModeOrchestration(
  prompt: string,
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const cacheKey = [
    "orchestration:v1",
    prompt,
    options.context ?? "",
    options.steering ?? "",
    (options.model as { modelId?: string }).modelId ?? "unknown",
  ].join("|");

  const cached = agentCache.get<OrchestrationResult>("agent", cacheKey);
  if (cached) {
    return cached;
  }

  const plan = createExecutionPlan(prompt, options.context);
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return {
      success: false,
      text: `Plan validation failed: ${validation.errors.join(", ")}`,
      planSummary: {
        steps: 0,
        parallelizable: false,
        estimatedDuration: 0,
      },
      quality: {
        overallScore: 0,
        passRate: 0,
        recommendations: ["Review prompt and retry plan generation."],
      },
    };
  }

  const graph = planToGraph(plan);
  const executedGraph = await executeGraph(
    graph,
    options.parentSessionId,
    options.model,
    options.tools,
  );

  const taskResults = executedGraph.nodes
    .map((n) => n.result)
    .filter(Boolean) as Array<{
    success: boolean;
    result: string;
    steps: number;
    tokens_used: number;
    execution_time_ms: number;
    error?: string;
    agent_id?: string;
  }>;

  const quality = evaluateMultipleResults(taskResults);
  const planStats = getPlanStats(plan);

  const synthesisPrompt = [
    `User goal: ${prompt}`,
    options.context ? `Context: ${options.context}` : "",
    `Plan stats: ${serializeForCache(planStats)}`,
    `Quality summary: ${serializeForCache({
      score: quality.overallScore,
      passRate: quality.passRate,
      recommendations: quality.recommendations,
    })}`,
    "Sub-agent results:",
    ...taskResults.map(
      (result, idx) =>
        `[${idx + 1}] success=${result.success} agent=${result.agent_id ?? "unknown"}\n${
          result.success ? result.result : `ERROR: ${result.error ?? "unknown"}`
        }`,
    ),
    "Produce one final, clear response for the user. If there are failures, mention them briefly and provide next best action.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const synthesis = await generateText({
    model: options.model,
    prompt: synthesisPrompt,
    temperature: 0.4,
  });

  const output: OrchestrationResult = {
    success: executedGraph.status !== "failed",
    text: synthesis.text,
    planSummary: {
      steps: plan.steps.length,
      parallelizable: plan.parallelizable,
      estimatedDuration: plan.estimatedTotalDuration,
    },
    quality: {
      overallScore: quality.overallScore,
      passRate: quality.passRate,
      recommendations: quality.recommendations,
    },
    raw: {
      results: taskResults.map((r) => ({
        success: r.success,
        result: r.result,
        error: r.error,
        agent_id: r.agent_id,
      })),
    },
  };

  agentCache.set({
    scope: "agent",
    key: cacheKey,
    value: output,
    ttlSeconds: 300,
    tags: ["orchestration", "plan-mode"],
  });

  logger.info("Plan mode orchestration completed", {
    success: output.success,
    steps: output.planSummary.steps,
    score: output.quality.overallScore,
  });

  return output;
}
