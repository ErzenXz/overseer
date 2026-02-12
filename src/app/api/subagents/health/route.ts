/**
 * Subagent Health Monitoring API
 * Provides basic health information for subagents
 */

import { NextResponse } from "next/server";
import { getAllSubAgentTypes, getStats } from "@/agent/subagents/manager";
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

    const circuitBreaker = circuitBreakerManager.getBreaker("subagent-generic");
    const circuitMetrics = circuitBreaker.getMetrics();

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      stats,
      circuitBreaker: {
        state: circuitMetrics.state,
        failures: circuitMetrics.failures,
        successes: circuitMetrics.successes,
        recentFailureRate: circuitMetrics.recentFailureRate,
      },
      resourcePools: {
        summary: poolSummary,
        pools: poolStatuses,
      },
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
      circuitBreakerManager.reset("subagent-generic");
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
