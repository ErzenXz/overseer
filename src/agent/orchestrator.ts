/**
 * Simple Orchestrator
 * 
 * For now, just runs the prompt directly without complex planning.
 * The main agent handles task decomposition.
 */

import { generateText, type LanguageModel, type Tool } from "ai";
import { createLogger } from "@/lib/logger";
import { agentCache } from "@/lib/agent-cache";

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
  planSummary?: {
    steps: number;
    parallelizable: boolean;
    estimatedDuration: number;
  };
  quality?: {
    overallScore: number;
    passRate: number;
    recommendations: string[];
  };
}

export async function runPlanModeOrchestration(
  prompt: string,
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const cacheKey = [
    "orchestration:v2",
    prompt,
    options.context ?? "",
    options.steering ?? "",
    (options.model as { modelId?: string }).modelId ?? "unknown",
  ].join("|");

  const cached = agentCache.get<OrchestrationResult>("agent", cacheKey);
  if (cached) {
    return cached;
  }

  const systemPrompt = `You are Overseer. Execute this task directly.
  
Context: ${options.context || "None"}
Steering: ${options.steering || "None"}

Just do the task. Return the result.`;

  try {
    const result = await generateText({
      model: options.model,
      system: systemPrompt,
      prompt,
      tools: options.tools,
    });

    const output: OrchestrationResult = {
      success: true,
      text: result.text,
      planSummary: {
        steps: result.steps?.length || 0,
        parallelizable: false,
        estimatedDuration: 0,
      },
      quality: {
        overallScore: 10,
        passRate: 1,
        recommendations: [],
      },
    };

    agentCache.set({
      scope: "agent",
      key: cacheKey,
      value: output,
      ttlSeconds: 300,
      tags: ["orchestration"],
    });

    return output;
  } catch (error) {
    logger.error("Orchestration failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      text: `Orchestration failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
