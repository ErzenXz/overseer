/**
 * Subagent Health Monitoring API
 * Provides health metrics, circuit breaker status, and resource pool information
 */

import { NextResponse } from "next/server";
import {
  getAllHealthMetrics,
  getHealthMetrics,
  detectPerformanceDegradation,
  getCircuitBreakerStatus,
  getAllSubAgentTypes,
  type SubAgentType,
} from "@/agent/subagents/manager";
import { circuitBreakerManager } from "@/lib/circuit-breaker";
import { poolManager } from "@/lib/resource-pool";
import { createLogger } from "@/lib/logger";

const logger = createLogger("api:subagents:health");

export const dynamic = "force-dynamic";

/**
 * GET /api/subagents/health
 * Get comprehensive health information for all subagents
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const agentType = searchParams.get("type") as SubAgentType | null;

    // If specific agent type requested
    if (agentType) {
      const health = getHealthMetrics(agentType);
      if (!health) {
        return NextResponse.json(
          { error: "Invalid agent type" },
          { status: 400 }
        );
      }

      const degradation = detectPerformanceDegradation(agentType);
      const circuitBreaker = circuitBreakerManager.getBreaker(`subagent-${agentType}`);
      const circuitMetrics = circuitBreaker.getMetrics();

      return NextResponse.json({
        agentType,
        health,
        degradation,
        circuitBreaker: {
          state: circuitMetrics.state,
          failures: circuitMetrics.failures,
          successes: circuitMetrics.successes,
          recentFailureRate: circuitMetrics.recentFailureRate,
          nextAttemptTime: circuitMetrics.nextAttemptTime,
        },
      });
    }

    // Get all agent health metrics
    const allHealth = getAllHealthMetrics();
    const circuitStates = getCircuitBreakerStatus();
    const poolStatuses = poolManager.getAllStatuses();
    const poolSummary = poolManager.getSummary();

    // Detect degraded agents
    const degradedAgents: Array<{
      type: SubAgentType;
      reasons: string[];
    }> = [];

    for (const type of getAllSubAgentTypes()) {
      const degradation = detectPerformanceDegradation(type);
      if (degradation.degraded) {
        degradedAgents.push({
          type,
          reasons: degradation.reasons,
        });
      }
    }

    // Calculate overall system health
    const allTypes = getAllSubAgentTypes();
    const healthScores = allTypes.map((type) => {
      const health = allHealth[type];
      if (!health || health.totalExecutions === 0) return 100;
      return health.successRate * 100;
    });

    const overallHealth =
      healthScores.reduce((sum, score) => sum + score, 0) / healthScores.length;

    // Count circuit breaker states
    const circuitSummary = {
      closed: 0,
      open: 0,
      halfOpen: 0,
    };

    for (const state of circuitStates) {
      if (state.state === "CLOSED") circuitSummary.closed++;
      else if (state.state === "OPEN") circuitSummary.open++;
      else if (state.state === "HALF_OPEN") circuitSummary.halfOpen++;
    }

    const response = {
      timestamp: new Date().toISOString(),
      overall: {
        health: Math.round(overallHealth * 10) / 10,
        status:
          overallHealth > 90
            ? "healthy"
            : overallHealth > 70
            ? "degraded"
            : "unhealthy",
        degradedAgents: degradedAgents.length,
        openCircuits: circuitSummary.open,
      },
      agents: allHealth,
      circuitBreakers: {
        summary: circuitSummary,
        states: circuitStates,
      },
      resourcePools: {
        summary: poolSummary,
        pools: poolStatuses,
      },
      degradedAgents,
      recommendations: generateRecommendations(
        degradedAgents,
        circuitSummary,
        poolSummary
      ),
    };

    logger.info("Health check completed", {
      overallHealth,
      degradedAgents: degradedAgents.length,
      openCircuits: circuitSummary.open,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Health check failed", { error });

    return NextResponse.json(
      {
        error: "Failed to retrieve health metrics",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/subagents/health
 * Reset health metrics or circuit breakers
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, agentType } = body;

    if (action === "reset-circuit") {
      if (agentType) {
        circuitBreakerManager.reset(`subagent-${agentType}`);
        logger.info("Circuit breaker reset", { agentType });
        return NextResponse.json({
          success: true,
          message: `Circuit breaker reset for ${agentType}`,
        });
      } else {
        circuitBreakerManager.resetAll();
        logger.info("All circuit breakers reset");
        return NextResponse.json({
          success: true,
          message: "All circuit breakers reset",
        });
      }
    }

    if (action === "reset-pool-metrics") {
      poolManager.resetAllMetrics();
      logger.info("Pool metrics reset");
      return NextResponse.json({
        success: true,
        message: "Pool metrics reset",
      });
    }

    if (action === "clear-queues") {
      const cleared = poolManager.clearAllQueues();
      logger.info("Queues cleared", { count: cleared });
      return NextResponse.json({
        success: true,
        message: `Cleared ${cleared} queued tasks`,
        count: cleared,
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    logger.error("Health action failed", { error });

    return NextResponse.json(
      {
        error: "Failed to perform action",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Generate recommendations based on health metrics
 */
function generateRecommendations(
  degradedAgents: Array<{ type: SubAgentType; reasons: string[] }>,
  circuitSummary: { closed: number; open: number; halfOpen: number },
  poolSummary: {
    totalActive: number;
    totalQueued: number;
    totalCompleted: number;
    totalFailed: number;
  }
): string[] {
  const recommendations: string[] = [];

  // Circuit breaker recommendations
  if (circuitSummary.open > 0) {
    recommendations.push(
      `${circuitSummary.open} circuit breaker(s) are OPEN. Review and fix failing agents, then reset circuits.`
    );
  }

  // Degraded agent recommendations
  if (degradedAgents.length > 0) {
    recommendations.push(
      `${degradedAgents.length} agent(s) showing performance degradation. Review recent failures and execution times.`
    );

    for (const { type, reasons } of degradedAgents) {
      recommendations.push(`${type}: ${reasons.join(", ")}`);
    }
  }

  // Queue recommendations
  if (poolSummary.totalQueued > 20) {
    recommendations.push(
      `High queue depth (${poolSummary.totalQueued} tasks). Consider increasing pool size or reviewing task priorities.`
    );
  }

  // Failure rate recommendations
  const failureRate =
    poolSummary.totalCompleted + poolSummary.totalFailed > 0
      ? poolSummary.totalFailed /
        (poolSummary.totalCompleted + poolSummary.totalFailed)
      : 0;

  if (failureRate > 0.2) {
    recommendations.push(
      `High failure rate (${(failureRate * 100).toFixed(1)}%). Review task definitions and agent configurations.`
    );
  }

  // Active task recommendations
  if (poolSummary.totalActive === 0 && poolSummary.totalQueued > 0) {
    recommendations.push(
      "Tasks queued but none active. Check if all agents have open circuits or if pools are configured correctly."
    );
  }

  // Default healthy message
  if (recommendations.length === 0) {
    recommendations.push("All systems operating normally.");
  }

  return recommendations;
}
