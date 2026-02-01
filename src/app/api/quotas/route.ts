/**
 * Quota Management API
 * Endpoints for viewing and managing user quotas
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRateLimiter } from "@/lib/rate-limiter";
import { getQuotaManager, TIER_LIMITS } from "@/lib/quota-manager";
import { getCostTracker } from "@/lib/cost-tracker";
import { getTokenBucketManager } from "@/lib/token-bucket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/quotas - Get current user's quota and usage
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = user.username; // Use username as user ID
    const rateLimiter = getRateLimiter();
    const status = rateLimiter.getStatus(userId);

    // Format response
    const response = {
      tier: status.tier,
      limits: {
        rpm: status.limits.rpm,
        tpm: status.limits.tpm,
        dailyRequests: status.limits.dailyRequests,
        monthlyRequests: status.limits.monthlyRequests,
        dailyCost: status.limits.dailyCost,
        monthlyCost: status.limits.monthlyCost,
        maxConcurrent: status.limits.maxConcurrent,
        priority: status.limits.priority,
      },
      usage: {
        requests: {
          daily: status.usage.dailyRequests,
          monthly: status.usage.monthlyRequests,
          dailyRemaining: status.usage.dailyRemaining,
          monthlyRemaining: status.usage.monthlyRemaining,
          dailyLimit: status.usage.dailyLimit,
          monthlyLimit: status.usage.monthlyLimit,
        },
        tokens: {
          total: status.cost.totalInputTokens + status.cost.totalOutputTokens,
          input: status.cost.totalInputTokens,
          output: status.cost.totalOutputTokens,
        },
        cost: {
          daily: status.cost.dailyCost,
          monthly: status.cost.monthlyCost,
          total: status.cost.totalCost,
          dailyLimit: status.limits.dailyCost,
          monthlyLimit: status.limits.monthlyCost,
          byModel: status.cost.byModel,
        },
        buckets: {
          rpm: {
            available: status.buckets.rpm,
            capacity: status.limits.rpm,
          },
          tpm: {
            available: status.buckets.tpm,
            capacity: status.limits.tpm,
          },
        },
      },
      resets: {
        daily: status.usage.resetDaily,
        monthly: status.usage.resetMonthly,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching quotas:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/quotas - Update user quota settings (admin only)
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { userId, action, tier } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const quotaManager = getQuotaManager();
    const rateLimiter = getRateLimiter();

    switch (action) {
      case "upgrade": {
        if (!tier || !["free", "pro", "enterprise"].includes(tier)) {
          return NextResponse.json(
            { error: "Invalid tier" },
            { status: 400 }
          );
        }
        quotaManager.updateTier(userId, tier);
        return NextResponse.json({
          success: true,
          message: `User ${userId} upgraded to ${tier}`,
        });
      }

      case "reset": {
        rateLimiter.resetUser(userId);
        return NextResponse.json({
          success: true,
          message: `Quotas reset for user ${userId}`,
        });
      }

      case "suspend": {
        quotaManager.suspendUser(userId);
        return NextResponse.json({
          success: true,
          message: `User ${userId} suspended`,
        });
      }

      case "unsuspend": {
        quotaManager.unsuspendUser(userId);
        return NextResponse.json({
          success: true,
          message: `User ${userId} unsuspended`,
        });
      }

      case "grace": {
        const hours = body.hours || 24;
        quotaManager.grantGracePeriod(userId, hours);
        return NextResponse.json({
          success: true,
          message: `Granted ${hours} hour grace period to user ${userId}`,
        });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error updating quotas:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/quotas/stats - Get system-wide quota statistics (admin only)
 */
export async function GET_STATS(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const quotaManager = getQuotaManager();
    const costTracker = getCostTracker();
    const tokenBucketManager = getTokenBucketManager();

    const stats = quotaManager.getStats();
    const topUsers = costTracker.getTopUsers(10);

    return NextResponse.json({
      users: {
        total: stats.totalUsers,
        byTier: stats.byTier,
        suspended: stats.suspended,
      },
      topUsers: topUsers.map((u) => ({
        userId: u.userId,
        totalCost: u.totalCost.toFixed(4),
        monthlyCost: u.monthlyCost.toFixed(4),
        totalRequests: u.totalRequests,
      })),
      tiers: TIER_LIMITS,
    });
  } catch (error) {
    console.error("Error fetching quota stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
