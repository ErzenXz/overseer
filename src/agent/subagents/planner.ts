/**
 * Planner Subagent
 * Decomposes complex tasks into actionable steps with dependencies
 */

import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "../../lib/logger";
import type { SubAgentType, ExecutionGraph, ExecutionNode } from "./manager";
import { v4 as uuidv4 } from "uuid";

const logger = createLogger("planner-subagent");

export interface PlanStep {
  id: string;
  description: string;
  agentType: SubAgentType;
  dependencies: string[];
  complexity: "low" | "medium" | "high";
  estimatedDuration?: number;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  estimatedTotalDuration: number;
  parallelizable: boolean;
  createdAt: number;
}

/**
 * Create an execution plan from a complex task description
 */
export function createExecutionPlan(
  goal: string,
  context?: string
): ExecutionPlan {
  logger.info("Creating execution plan", { goal });

  // This is a simplified planner - in production, this would use LLM
  // to intelligently decompose tasks
  const steps: PlanStep[] = [];
  const planId = uuidv4();

  // Parse task and identify required steps
  const lowerGoal = goal.toLowerCase();
  const lowerContext = context?.toLowerCase() || "";

  // Check for file operations
  if (lowerGoal.includes("create") || lowerGoal.includes("write")) {
    steps.push({
      id: `step-${steps.length + 1}`,
      description: "Prepare directory structure",
      agentType: "file",
      dependencies: [],
      complexity: "low",
      estimatedDuration: 5000,
    });
  }

  // Check for code-related tasks
  if (
    lowerGoal.includes("code") ||
    lowerGoal.includes("implement") ||
    lowerGoal.includes("function")
  ) {
    steps.push({
      id: `step-${steps.length + 1}`,
      description: "Implement code solution",
      agentType: "code",
      dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
      complexity: "high",
      estimatedDuration: 30000,
    });
  }

  // Check for git operations
  if (
    lowerGoal.includes("commit") ||
    lowerGoal.includes("push") ||
    lowerGoal.includes("git")
  ) {
    steps.push({
      id: `step-${steps.length + 1}`,
      description: "Version control operations",
      agentType: "git",
      dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
      complexity: "low",
      estimatedDuration: 10000,
    });
  }

  // Check for testing/validation
  if (
    lowerGoal.includes("test") ||
    lowerGoal.includes("validate") ||
    lowerGoal.includes("verify")
  ) {
    steps.push({
      id: `step-${steps.length + 1}`,
      description: "Test and validate implementation",
      agentType: "system",
      dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
      complexity: "medium",
      estimatedDuration: 15000,
    });
  }

  // Check for database operations
  if (
    lowerGoal.includes("database") ||
    lowerGoal.includes("migration") ||
    lowerGoal.includes("sql")
  ) {
    steps.push({
      id: `step-${steps.length + 1}`,
      description: "Database operations",
      agentType: "db",
      dependencies: [],
      complexity: "medium",
      estimatedDuration: 20000,
    });
  }

  // If no specific steps identified, create a general plan
  if (steps.length === 0) {
    steps.push({
      id: "step-1",
      description: "Analyze requirements",
      agentType: "file",
      dependencies: [],
      complexity: "low",
      estimatedDuration: 5000,
    });

    steps.push({
      id: "step-2",
      description: "Execute main task",
      agentType: "code",
      dependencies: ["step-1"],
      complexity: "medium",
      estimatedDuration: 15000,
    });

    steps.push({
      id: "step-3",
      description: "Verify results",
      agentType: "evaluator",
      dependencies: ["step-2"],
      complexity: "low",
      estimatedDuration: 5000,
    });
  }

  const totalDuration = steps.reduce(
    (sum, step) => sum + (step.estimatedDuration || 0),
    0
  );

  // Check if any steps can run in parallel
  const parallelizable = steps.some(
    (step) => step.dependencies.length === 0 && steps.length > 1
  );

  const plan: ExecutionPlan = {
    id: planId,
    goal,
    steps,
    estimatedTotalDuration: totalDuration,
    parallelizable,
    createdAt: Date.now(),
  };

  logger.info("Execution plan created", {
    planId,
    stepCount: steps.length,
    estimatedDuration: totalDuration,
    parallelizable,
  });

  return plan;
}

/**
 * Convert an execution plan to an execution graph
 */
export function planToGraph(plan: ExecutionPlan): ExecutionGraph {
  const nodes: ExecutionNode[] = plan.steps.map((step) => ({
    id: step.id,
    agentType: step.agentType,
    task: step.description,
    dependencies: step.dependencies,
    status: "pending",
  }));

  return {
    id: plan.id,
    nodes,
    createdAt: plan.createdAt,
    status: "pending",
  };
}

/**
 * Optimize an execution plan by identifying parallel execution opportunities
 */
export function optimizePlan(plan: ExecutionPlan): ExecutionPlan {
  // Find steps that can be parallelized
  const independentSteps: string[] = [];

  for (const step of plan.steps) {
    if (step.dependencies.length === 0) {
      independentSteps.push(step.id);
    }
  }

  logger.debug("Plan optimization complete", {
    planId: plan.id,
    parallelSteps: independentSteps.length,
  });

  return {
    ...plan,
    parallelizable: independentSteps.length > 1,
  };
}

/**
 * Validate an execution plan
 */
export function validatePlan(plan: ExecutionPlan): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for circular dependencies
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(stepId: string): boolean {
    visited.add(stepId);
    recursionStack.add(stepId);

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return false;

    for (const depId of step.dependencies) {
      if (!visited.has(depId)) {
        if (hasCycle(depId)) return true;
      } else if (recursionStack.has(depId)) {
        return true;
      }
    }

    recursionStack.delete(stepId);
    return false;
  }

  for (const step of plan.steps) {
    if (!visited.has(step.id) && hasCycle(step.id)) {
      errors.push(`Circular dependency detected involving step: ${step.id}`);
    }
  }

  // Check for invalid dependencies
  const stepIds = new Set(plan.steps.map((s) => s.id));
  for (const step of plan.steps) {
    for (const depId of step.dependencies) {
      if (!stepIds.has(depId)) {
        errors.push(`Step ${step.id} has invalid dependency: ${depId}`);
      }
    }
  }

  // Check for orphaned steps
  const referencedSteps = new Set<string>();
  for (const step of plan.steps) {
    step.dependencies.forEach((dep) => referencedSteps.add(dep));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Tool for creating execution plans
 */
export const createPlan = tool({
  description: `Create an execution plan for a complex task. This breaks down the task into sequential and parallel steps with proper dependencies.`,
  parameters: z.object({
    goal: z.string().describe("The main goal or task to accomplish"),
    context: z
      .string()
      .optional()
      .describe("Additional context about the task"),
  }),
  execute: async ({ goal, context }) => {
    try {
      const plan = createExecutionPlan(goal, context);
      const validation = validatePlan(plan);

      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid plan: ${validation.errors.join(", ")}`,
        };
      }

      const optimized = optimizePlan(plan);

      return {
        success: true,
        plan: optimized,
        stepCount: optimized.steps.length,
        estimatedDuration: optimized.estimatedTotalDuration,
        parallelizable: optimized.parallelizable,
      };
    } catch (error) {
      logger.error("Failed to create plan", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Get plan statistics
 */
export function getPlanStats(plan: ExecutionPlan): {
  totalSteps: number;
  parallelSteps: number;
  sequentialSteps: number;
  estimatedDuration: number;
  complexity: Record<string, number>;
  agentTypes: Record<string, number>;
} {
  const complexity: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };

  const agentTypes: Record<string, number> = {};

  for (const step of plan.steps) {
    complexity[step.complexity]++;

    if (!agentTypes[step.agentType]) {
      agentTypes[step.agentType] = 0;
    }
    agentTypes[step.agentType]++;
  }

  const parallelSteps = plan.steps.filter(
    (s) => s.dependencies.length === 0
  ).length;

  return {
    totalSteps: plan.steps.length,
    parallelSteps,
    sequentialSteps: plan.steps.length - parallelSteps,
    estimatedDuration: plan.estimatedTotalDuration,
    complexity,
    agentTypes,
  };
}
