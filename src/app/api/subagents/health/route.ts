/**
 * Subagent Health Monitoring API
 * Provides basic health information for subagents
 */

import { NextResponse } from "next/server";
import { getStats } from "@/agent/subagents/manager";
import { circuitBreakerManager } from "@/lib/circuit-breaker";
import { poolManager } from "@/lib/resource-pool";
import { createLogger } from "@/lib/logger";

const logger = createLogger("api:subagents:health");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getStats();
    const poolStatuses = poolManager.getAllStatuses();
    const poolSummary = poolManager.getSummary();

    const cbSummary = circuitBreakerManager.getSummary();
    const cbStates = circuitBreakerManager.getAllStates();

    const openCircuits = cbSummary.open;
    const degradedAgents = stats.error;

    // Simple health score: start at 100 and apply penalties.
    let health = 100;
    if (openCircuits > 0) health -= Math.min(60, openCircuits * 20);
    if (degradedAgents > 0) health -= Math.min(40, degradedAgents * 10);
    health = Math.max(0, Math.min(100, health));

    const status =
      health >= 90 ? "healthy" : health >= 70 ? "degraded" : "unhealthy";

    const degradedList = [
      ...(degradedAgents > 0
        ? [
            {
              type: "subagents",
              reasons: [`${degradedAgents} sub-agent(s) in error state`],
            },
          ]
        : []),
      ...cbStates
        .filter((s) => s.state === "OPEN")
        .map((s) => ({
          type: s.name,
          reasons: [
            `circuit OPEN (recent failure rate: ${Math.round(
              (s.metrics.recentFailureRate || 0) * 100,
            )}%)`,
          ],
        })),
    ];

    const recommendations: string[] = [];
    if (openCircuits > 0) {
      recommendations.push(
        "One or more circuit breakers are OPEN. Consider resetting circuits after addressing the underlying failures.",
      );
    }
    if (degradedAgents > 0) {
      recommendations.push(
        "Some sub-agents are in error state. Review task results/logs for the failure cause.",
      );
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      overall: {
        health,
        status,
        degradedAgents,
        openCircuits,
      },
      agents: {
        stats,
      },
      circuitBreakers: {
        summary: {
          closed: cbSummary.closed,
          open: cbSummary.open,
          halfOpen: cbSummary.halfOpen,
        },
        states: cbStates.map((s) => ({
          agentType: s.name,
          state: s.state,
          failureRate: Math.round((s.metrics.recentFailureRate || 0) * 100),
        })),
      },
      resourcePools: {
        summary: {
          totalActive: poolSummary.totalActive,
          totalQueued: poolSummary.totalQueued,
          totalCompleted: poolSummary.totalCompleted,
          totalFailed: poolSummary.totalFailed,
        },
        pools: poolStatuses,
      },
      degradedAgents: degradedList,
      recommendations,
    });
  } catch (error) {
    logger.error("Health check failed", { error });
    return NextResponse.json(
      { error: "Failed to retrieve health metrics" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "reset-circuit") {
      // Historically we reset a single breaker; but the current system creates
      // per-task breakers. Reset all to recover quickly.
      circuitBreakerManager.resetAll();
      logger.info("Circuit breaker reset");
      return NextResponse.json({ success: true, message: "Circuit breaker reset" });
    }

    if (action === "reset-pool-metrics") {
      poolManager.resetAllMetrics();
      logger.info("Pool metrics reset");
      return NextResponse.json({ success: true, message: "Pool metrics reset" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    logger.error("Health action failed", { error });
    return NextResponse.json(
      { error: "Failed to perform action" },
      { status: 500 }
    );
  }
}
