import { NextRequest, NextResponse } from "next/server";
import { db } from "@/database/db";
import { getCostTracker } from "@/lib/cost-tracker";
import { getMemoryStatsForUser } from "@/agent/super-memory";
import { getStats as getSubAgentStats } from "@/agent/subagents/manager";
import { getContextStats } from "@/agent/infinite-context";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
    const ownerId = canViewAll ? undefined : user.id;

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30", 10);

    // Ensure schema exists (cost_tracking is created by CostTracker initializer).
    // Analytics queries hit cost_tracking directly, so we must initialize first.
    try {
      getCostTracker();
    } catch {
      // If initialization fails, we still want the page to load with partial data.
    }

    // Daily cost/request/token data
    let dailyData: any[] = [];
    try {
      dailyData = (typeof ownerId === "number"
        ? db
            .prepare(
              `SELECT
                DATE(created_at) as day,
                CAST(COALESCE(SUM(cost_usd), 0) AS REAL) as cost,
                CAST(COUNT(*) AS INTEGER) as requests,
                CAST(COALESCE(SUM(input_tokens + output_tokens), 0) AS INTEGER) as tokens
              FROM cost_tracking
              WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' day')
              GROUP BY DATE(created_at)
              ORDER BY day ASC`,
            )
            .all(String(ownerId), days)
        : db
            .prepare(
              `SELECT
                DATE(created_at) as day,
                CAST(COALESCE(SUM(cost_usd), 0) AS REAL) as cost,
                CAST(COUNT(*) AS INTEGER) as requests,
                CAST(COALESCE(SUM(input_tokens + output_tokens), 0) AS INTEGER) as tokens
              FROM cost_tracking
              WHERE created_at >= datetime('now', '-' || ? || ' day')
              GROUP BY DATE(created_at)
              ORDER BY day ASC`,
            )
            .all(days)) as any[];
    } catch {
      dailyData = [];
    }

    // Model breakdown
    let modelData: any[] = [];
    try {
      modelData = (typeof ownerId === "number"
        ? db
            .prepare(
              `SELECT
                model,
                CAST(COALESCE(SUM(cost_usd), 0) AS REAL) as cost,
                CAST(COUNT(*) AS INTEGER) as requests,
                CAST(COALESCE(SUM(input_tokens + output_tokens), 0) AS INTEGER) as tokens
              FROM cost_tracking
              WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' day')
              GROUP BY model
              ORDER BY cost DESC
              LIMIT 15`,
            )
            .all(String(ownerId), days)
        : db
            .prepare(
              `SELECT
                model,
                CAST(COALESCE(SUM(cost_usd), 0) AS REAL) as cost,
                CAST(COUNT(*) AS INTEGER) as requests,
                CAST(COALESCE(SUM(input_tokens + output_tokens), 0) AS INTEGER) as tokens
              FROM cost_tracking
              WHERE created_at >= datetime('now', '-' || ? || ' day')
              GROUP BY model
              ORDER BY cost DESC
              LIMIT 15`,
            )
            .all(days)) as any[];
    } catch {
      modelData = [];
    }

    // Top users (multi-tenant: only available when viewing all)
    const topUsers = canViewAll ? getCostTracker().getTopUsers(20) : [];

    // Conversation stats
    let convStats = { total: 0, tokens: 0, messages: 0 };
    try {
      if (typeof ownerId === "number") {
        convStats = db
          .prepare(
            `SELECT 
              CAST(COUNT(*) AS INTEGER) as total,
              CAST(COALESCE(SUM(total_tokens), 0) AS INTEGER) as tokens,
              CAST(COALESCE(SUM(message_count), 0) AS INTEGER) as messages
            FROM conversations
            WHERE owner_user_id = ?`,
          )
          .get(ownerId) as typeof convStats;
      } else {
        convStats = db
          .prepare(
            `SELECT 
              CAST(COUNT(*) AS INTEGER) as total,
              CAST(COALESCE(SUM(total_tokens), 0) AS INTEGER) as tokens,
              CAST(COALESCE(SUM(message_count), 0) AS INTEGER) as messages
            FROM conversations`,
          )
          .get() as typeof convStats;
      }
    } catch {
      // Table might not have these columns
    }

    // Memory stats (safe to call server-side)
    let memoryStats = { total: 0, byCategory: {}, avgImportance: 0 };
    try {
      memoryStats = getMemoryStatsForUser(user.id);
    } catch {
      // Memory table might not exist yet
    }

    // Sub-agent stats
    let subAgentStatsData = { total: 0, by_type: {}, completed: 0, error: 0, working: 0 };
    try {
      subAgentStatsData = getSubAgentStats();
    } catch {
      // Sub-agents table might not exist yet
    }

    // Context stats
    let contextStats: ReturnType<typeof getContextStats> = { totalSummaries: 0, conversations: [] };
    try {
      contextStats = getContextStats(ownerId);
    } catch {
      // OK
    }

    // System health
    const systemHealth = {
      api: "healthy",
      database: "connected",
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };

    return NextResponse.json({
      dailyData,
      modelData,
      topUsers,
      convStats,
      memoryStats,
      subAgentStats: subAgentStatsData,
      contextStats,
      systemHealth,
    });
  } catch (error) {
    console.error("Analytics API error:", error);
    return NextResponse.json(
      { error: "Failed to load analytics" },
      { status: 500 },
    );
  }
}
