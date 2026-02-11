/**
 * Evaluator Subagent
 * Reviews outputs from other agents for quality, correctness, and completeness
 */

import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "../../lib/logger";
import type { TaskResult } from "./manager";

const logger = createLogger("evaluator-subagent");

export interface EvaluationCriteria {
  correctness: boolean;
  completeness: boolean;
  quality: boolean;
  bestPractices: boolean;
}

export interface EvaluationResult {
  score: number; // 1-10
  passed: boolean;
  strengths: string[];
  issues: string[];
  recommendations: string[];
  criteria: EvaluationCriteria;
  evaluatedAt: number;
}

/**
 * Evaluate a task result
 */
export function evaluateTaskResult(
  result: TaskResult,
  expectedOutcome?: string
): EvaluationResult {
  logger.info("Evaluating task result", {
    agentId: result.agent_id,
    success: result.success,
  });

  const strengths: string[] = [];
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Base score
  let score = result.success ? 7 : 3;

  // Evaluate execution time
  if (result.execution_time_ms < 10000) {
    strengths.push("Fast execution time");
    score += 1;
  } else if (result.execution_time_ms > 60000) {
    issues.push("Slow execution time (> 1 minute)");
    recommendations.push("Consider optimizing or breaking into smaller tasks");
    score -= 1;
  }

  // Evaluate token efficiency
  if (result.tokens_used < 1000) {
    strengths.push("Efficient token usage");
    score += 0.5;
  } else if (result.tokens_used > 10000) {
    issues.push("High token usage");
    recommendations.push("Consider more concise prompts or breaking into steps");
    score -= 0.5;
  }

  // Evaluate result completeness
  if (result.result && result.result.length > 50) {
    strengths.push("Detailed output provided");
  } else if (result.result && result.result.length < 20) {
    issues.push("Brief output - may lack detail");
    score -= 1;
  }

  // Evaluate error handling
  if (!result.success && result.error) {
    if (result.error.includes("timeout")) {
      issues.push("Task timed out");
      recommendations.push("Increase timeout or optimize task");
    } else if (result.error.includes("Circuit breaker")) {
      issues.push("Circuit breaker prevented execution");
      recommendations.push("Check agent health and recent failures");
    } else {
      issues.push(`Error occurred: ${result.error.substring(0, 100)}`);
    }
  }

  // Evaluate expected outcome (if provided)
  if (expectedOutcome && result.result) {
    const lowerResult = result.result.toLowerCase();
    const lowerExpected = expectedOutcome.toLowerCase();

    // Simple keyword matching
    const keywords = lowerExpected.split(" ").filter((w) => w.length > 3);
    const matchCount = keywords.filter((k) => lowerResult.includes(k)).length;
    const matchRate = matchCount / keywords.length;

    if (matchRate > 0.7) {
      strengths.push("Output matches expected outcome");
      score += 1;
    } else if (matchRate < 0.3) {
      issues.push("Output may not match expected outcome");
      recommendations.push("Review task requirements and output");
      score -= 1;
    }
  }

  // Clamp score between 1-10
  score = Math.max(1, Math.min(10, score));

  const criteria: EvaluationCriteria = {
    correctness: result.success && score >= 7,
    completeness: result.result.length > 50 || score >= 6,
    quality: score >= 7,
    bestPractices: result.execution_time_ms < 60000 && result.tokens_used < 5000,
  };

  const evaluation: EvaluationResult = {
    score: Math.round(score * 10) / 10,
    passed: score >= 7,
    strengths,
    issues,
    recommendations,
    criteria,
    evaluatedAt: Date.now(),
  };

  logger.info("Evaluation completed", {
    score: evaluation.score,
    passed: evaluation.passed,
    issuesCount: issues.length,
  });

  return evaluation;
}

/**
 * Evaluate multiple task results and provide aggregate assessment
 */
export function evaluateMultipleResults(
  results: TaskResult[]
): {
  overallScore: number;
  passRate: number;
  evaluations: EvaluationResult[];
  summary: {
    totalTasks: number;
    passed: number;
    failed: number;
    averageExecutionTime: number;
    totalTokens: number;
  };
  recommendations: string[];
} {
  const evaluations = results.map((result) => evaluateTaskResult(result));

  const overallScore =
    evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length;

  const passed = evaluations.filter((e) => e.passed).length;
  const passRate = passed / evaluations.length;

  const totalExecutionTime = results.reduce(
    (sum, r) => sum + r.execution_time_ms,
    0
  );
  const averageExecutionTime = totalExecutionTime / results.length;

  const totalTokens = results.reduce((sum, r) => sum + r.tokens_used, 0);

  // Aggregate recommendations
  const allRecommendations = new Set<string>();
  evaluations.forEach((e) => {
    e.recommendations.forEach((r) => allRecommendations.add(r));
  });

  // Add aggregate recommendations
  if (passRate < 0.7) {
    allRecommendations.add("Review failed tasks and adjust approach");
  }

  if (averageExecutionTime > 30000) {
    allRecommendations.add("Consider parallelizing or optimizing tasks");
  }

  if (totalTokens > 50000) {
    allRecommendations.add("High total token usage - consider task optimization");
  }

  return {
    overallScore: Math.round(overallScore * 10) / 10,
    passRate: Math.round(passRate * 100) / 100,
    evaluations,
    summary: {
      totalTasks: results.length,
      passed,
      failed: results.length - passed,
      averageExecutionTime: Math.round(averageExecutionTime),
      totalTokens,
    },
    recommendations: Array.from(allRecommendations),
  };
}

/**
 * Compare two task results and identify which performed better
 */
export function compareResults(
  result1: TaskResult,
  result2: TaskResult
): {
  better: "first" | "second" | "equal";
  reason: string;
  eval1: EvaluationResult;
  eval2: EvaluationResult;
} {
  const evaluation1 = evaluateTaskResult(result1);
  const evaluation2 = evaluateTaskResult(result2);

  let better: "first" | "second" | "equal";
  let reason: string;

  if (Math.abs(evaluation1.score - evaluation2.score) < 0.5) {
    better = "equal";
    reason = "Both results have similar quality scores";
  } else if (evaluation1.score > evaluation2.score) {
    better = "first";
    reason = `First result scored higher (${evaluation1.score} vs ${evaluation2.score})`;
  } else {
    better = "second";
    reason = `Second result scored higher (${evaluation2.score} vs ${evaluation1.score})`;
  }

  return { better, reason, eval1: evaluation1, eval2: evaluation2 };
}

/**
 * Check if a result needs improvement
 */
export function needsImprovement(result: TaskResult): {
  needs: boolean;
  reasons: string[];
  suggestions: string[];
} {
  const evaluation = evaluateTaskResult(result);

  return {
    needs: !evaluation.passed,
    reasons: evaluation.issues,
    suggestions: evaluation.recommendations,
  };
}

/**
 * Generate quality report
 */
export function generateQualityReport(results: TaskResult[]): string {
  const multiEval = evaluateMultipleResults(results);

  let report = "# Quality Evaluation Report\n\n";

  report += `## Summary\n`;
  report += `- Overall Score: ${multiEval.overallScore}/10\n`;
  report += `- Pass Rate: ${(multiEval.passRate * 100).toFixed(1)}%\n`;
  report += `- Total Tasks: ${multiEval.summary.totalTasks}\n`;
  report += `- Passed: ${multiEval.summary.passed}\n`;
  report += `- Failed: ${multiEval.summary.failed}\n`;
  report += `- Average Execution Time: ${multiEval.summary.averageExecutionTime}ms\n`;
  report += `- Total Tokens: ${multiEval.summary.totalTokens}\n\n`;

  if (multiEval.recommendations.length > 0) {
    report += `## Recommendations\n`;
    multiEval.recommendations.forEach((rec) => {
      report += `- ${rec}\n`;
    });
    report += `\n`;
  }

  report += `## Individual Evaluations\n\n`;
  results.forEach((result, index) => {
    const evaluation = multiEval.evaluations[index];
    report += `### Task ${index + 1}\n`;
    report += `- Score: ${evaluation.score}/10\n`;
    report += `- Status: ${evaluation.passed ? "✓ Passed" : "✗ Failed"}\n`;

    if (evaluation.strengths.length > 0) {
      report += `- Strengths: ${evaluation.strengths.join(", ")}\n`;
    }

    if (evaluation.issues.length > 0) {
      report += `- Issues: ${evaluation.issues.join(", ")}\n`;
    }

    report += `\n`;
  });

  return report;
}

/**
 * Tool for evaluating task results
 */
export const evaluateTask = tool<any, any>({
  description: `Evaluate the quality of a completed task. Provides a score, identifies strengths and issues, and offers recommendations for improvement.`,
  inputSchema: z.object({
    taskDescription: z.string().describe("Description of the task that was completed"),
    result: z.string().describe("The result/output of the task"),
    executionTime: z.number().describe("Time taken to complete in milliseconds"),
    success: z.boolean().describe("Whether the task completed successfully"),
    expectedOutcome: z
      .string()
      .optional()
      .describe("What was expected from this task"),
  }),
  execute: async ({
    taskDescription,
    result,
    executionTime,
    success,
    expectedOutcome,
  }: {
    taskDescription: string;
    result: string;
    executionTime: number;
    success: boolean;
    expectedOutcome?: string;
  }) => {
    try {
      const taskResult: TaskResult = {
        success,
        result,
        steps: 0,
        tokens_used: 0,
        execution_time_ms: executionTime,
      };

      const evaluation = evaluateTaskResult(taskResult, expectedOutcome);

      return {
        success: true,
        evaluation: {
          score: evaluation.score,
          passed: evaluation.passed,
          strengths: evaluation.strengths,
          issues: evaluation.issues,
          recommendations: evaluation.recommendations,
        },
      };
    } catch (error) {
      logger.error("Failed to evaluate task", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
