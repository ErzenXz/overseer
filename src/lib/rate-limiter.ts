/**
 * Multi-Tier Rate Limiter
 * Integrates token buckets, quotas, cost tracking, and resource pooling
 */

import { getTokenBucketManager, type TokenBucketConfig } from "./token-bucket";
import { getQuotaManager, TIER_LIMITS, type UserTier } from "./quota-manager";
import { getCostTracker } from "./cost-tracker";
import { poolManager } from "./resource-pool";

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfter?: number; // milliseconds
  limits?: {
    rpm: { current: number; limit: number };
    tpm: { current: number; limit: number };
    daily: { current: number; limit: number };
    monthly: { current: number; limit: number };
    cost: { daily: number; monthly: number; dailyLimit: number; monthlyLimit: number };
  };
}

export interface RateLimitCheck {
  userId: string;
  interfaceType: "telegram" | "discord" | "slack" | "web" | "api";
  tokens?: number; // For TPM limiting
  estimatedCost?: number; // For cost limiting
}

/**
 * Multi-Tier Rate Limiter
 * Enforces RPM, TPM, quota, and cost limits across all interfaces
 */
export class RateLimiter {
  private tokenBucketManager = getTokenBucketManager();
  private quotaManager = getQuotaManager();
  private costTracker = getCostTracker();

  /**
   * Check if a request is allowed under all rate limits
   */
  async checkLimit(check: RateLimitCheck): Promise<RateLimitResult> {
    const { userId, interfaceType, tokens = 0, estimatedCost = 0 } = check;

    // Get user tier and limits
    const tier = this.quotaManager.getUserTier(userId);
    const limits = TIER_LIMITS[tier];

    // 1. Check quota (daily/monthly request limits)
    const quotaCheck = this.quotaManager.hasQuota(userId);
    if (!quotaCheck.allowed) {
      const retryAfter = quotaCheck.resetDaily
        ? quotaCheck.resetDaily.getTime() - Date.now()
        : quotaCheck.resetMonthly
        ? quotaCheck.resetMonthly.getTime() - Date.now()
        : undefined;

      return {
        allowed: false,
        reason: quotaCheck.reason,
        retryAfter,
      };
    }

    // 2. Check RPM (Requests Per Minute) using token bucket
    const rpmConfig: TokenBucketConfig = {
      userId,
      bucketType: "rpm",
      capacity: limits.rpm,
      refillRate: limits.rpm / 60, // Refill to capacity over 1 minute
    };

    const rpmAllowed = this.tokenBucketManager.tryConsume(rpmConfig, 1);
    if (!rpmAllowed) {
      const retryAfter = this.tokenBucketManager.getTimeUntilRefill(rpmConfig, 1);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${limits.rpm} requests per minute`,
        retryAfter,
      };
    }

    // 3. Check TPM (Tokens Per Minute) if tokens specified
    if (tokens > 0) {
      const tpmConfig: TokenBucketConfig = {
        userId,
        bucketType: "tpm",
        capacity: limits.tpm,
        refillRate: limits.tpm / 60, // Refill to capacity over 1 minute
      };

      const tpmAllowed = this.tokenBucketManager.tryConsume(tpmConfig, tokens);
      if (!tpmAllowed) {
        const retryAfter = this.tokenBucketManager.getTimeUntilRefill(
          tpmConfig,
          tokens
        );
        return {
          allowed: false,
          reason: `Token rate limit exceeded: ${limits.tpm} tokens per minute`,
          retryAfter,
        };
      }
    }

    // 4. Check cost limits (daily/monthly budget)
    if (estimatedCost > 0) {
      const costStatus = this.costTracker.isOverBudget(
        userId,
        limits.dailyCost,
        limits.monthlyCost
      );

      if (costStatus.overDaily) {
        return {
          allowed: false,
          reason: `Daily cost limit exceeded: $${limits.dailyCost.toFixed(2)}`,
          retryAfter: this.getTimeUntilNextDay(),
        };
      }

      if (costStatus.overMonthly) {
        return {
          allowed: false,
          reason: `Monthly cost limit exceeded: $${limits.monthlyCost.toFixed(2)}`,
          retryAfter: this.getTimeUntilNextMonth(),
        };
      }
    }

    // 5. Check concurrent execution limits
    const pool = poolManager.getPool("agent-execution");
    const poolMetrics = pool.getMetrics();
    
    // Count user's concurrent requests
    const userConcurrent = pool.getActiveTasks().filter((task) => 
      task.id.startsWith(userId)
    ).length;

    if (userConcurrent >= limits.maxConcurrent) {
      return {
        allowed: false,
        reason: `Concurrent request limit exceeded: ${limits.maxConcurrent} requests`,
        retryAfter: 5000, // Retry in 5 seconds
      };
    }

    // All checks passed - get current usage for response
    const usage = this.quotaManager.getUsage(userId);
    const costSummary = this.costTracker.getUserCostSummary(userId);

    return {
      allowed: true,
      limits: {
        rpm: {
          current: limits.rpm - Math.floor(this.tokenBucketManager.getBucket(rpmConfig).getTokens()),
          limit: limits.rpm,
        },
        tpm: {
          current: limits.tpm - Math.floor(this.tokenBucketManager.getBucket({ ...rpmConfig, bucketType: "tpm", capacity: limits.tpm, refillRate: limits.tpm / 60 }).getTokens()),
          limit: limits.tpm,
        },
        daily: {
          current: usage.dailyRequests,
          limit: usage.dailyLimit,
        },
        monthly: {
          current: usage.monthlyRequests,
          limit: usage.monthlyLimit,
        },
        cost: {
          daily: costSummary.dailyCost,
          monthly: costSummary.monthlyCost,
          dailyLimit: limits.dailyCost,
          monthlyLimit: limits.monthlyCost,
        },
      },
    };
  }

  /**
   * Record a successful request (increment usage counters)
   */
  recordRequest(params: {
    userId: string;
    interfaceType: string;
    inputTokens: number;
    outputTokens: number;
    model: string;
    conversationId?: number;
  }): void {
    // Increment quota
    this.quotaManager.incrementUsage(params.userId);

    // Record cost
    this.costTracker.recordCost({
      userId: params.userId,
      conversationId: params.conversationId,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      interfaceType: params.interfaceType,
    });
  }

  /**
   * Get user's current rate limit status
   */
  getStatus(userId: string): {
    tier: UserTier;
    limits: (typeof TIER_LIMITS)[UserTier];
    usage: any;
    cost: any;
    buckets: {
      rpm: number;
      tpm: number;
    };
  } {
    const tier = this.quotaManager.getUserTier(userId);
    const limits = TIER_LIMITS[tier];
    const usage = this.quotaManager.getUsage(userId);
    const cost = this.costTracker.getUserCostSummary(userId);

    const rpmBucket = this.tokenBucketManager.getBucket({
      userId,
      bucketType: "rpm",
      capacity: limits.rpm,
      refillRate: limits.rpm / 60,
    });

    const tpmBucket = this.tokenBucketManager.getBucket({
      userId,
      bucketType: "tpm",
      capacity: limits.tpm,
      refillRate: limits.tpm / 60,
    });

    return {
      tier,
      limits,
      usage,
      cost,
      buckets: {
        rpm: Math.floor(rpmBucket.getTokens()),
        tpm: Math.floor(tpmBucket.getTokens()),
      },
    };
  }

  /**
   * Reset a user's rate limits (admin function)
   */
  resetUser(userId: string): void {
    // Reset quota
    this.quotaManager.resetQuotas(userId);

    // Reset token buckets
    this.tokenBucketManager.resetBucket(userId, "rpm");
    this.tokenBucketManager.resetBucket(userId, "tpm");
  }

  /**
   * Upgrade user tier
   */
  upgradeUser(userId: string, tier: UserTier): void {
    this.quotaManager.updateTier(userId, tier);
  }

  /**
   * Get time until next day (midnight UTC)
   */
  private getTimeUntilNextDay(): number {
    const now = new Date();
    const tomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
    return tomorrow.getTime() - now.getTime();
  }

  /**
   * Get time until next month
   */
  private getTimeUntilNextMonth(): number {
    const now = new Date();
    const nextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    return nextMonth.getTime() - now.getTime();
  }

  /**
   * Get formatted error message for user
   */
  getErrorMessage(result: RateLimitResult): string {
    if (result.allowed) {
      return "";
    }

    let message = `⏳ ${result.reason}`;

    if (result.retryAfter) {
      const seconds = Math.ceil(result.retryAfter / 1000);
      const minutes = Math.ceil(seconds / 60);
      const hours = Math.ceil(minutes / 60);

      if (hours > 1) {
        message += `\n\nTry again in ${hours} hour${hours > 1 ? "s" : ""}.`;
      } else if (minutes > 1) {
        message += `\n\nTry again in ${minutes} minute${minutes > 1 ? "s" : ""}.`;
      } else {
        message += `\n\nTry again in ${seconds} second${seconds > 1 ? "s" : ""}.`;
      }
    }

    message += "\n\nUpgrade to Pro or Enterprise for higher limits!";

    return message;
  }

  /**
   * Check if user should receive a quota warning
   */
  shouldWarnUser(userId: string): {
    warn: boolean;
    message?: string;
  } {
    const usage = this.quotaManager.getUsage(userId);
    const cost = this.costTracker.getUserCostSummary(userId);
    const tier = this.quotaManager.getUserTier(userId);
    const limits = TIER_LIMITS[tier];

    // Warn at 80% usage
    const dailyUsagePercent = (usage.dailyRequests / usage.dailyLimit) * 100;
    const monthlyUsagePercent =
      (usage.monthlyRequests / usage.monthlyLimit) * 100;
    const dailyCostPercent = (cost.dailyCost / limits.dailyCost) * 100;
    const monthlyCostPercent = (cost.monthlyCost / limits.monthlyCost) * 100;

    if (dailyUsagePercent >= 80) {
      return {
        warn: true,
        message: `⚠️ You've used ${usage.dailyRequests}/${usage.dailyLimit} of your daily request limit (${Math.round(dailyUsagePercent)}%).`,
      };
    }

    if (monthlyUsagePercent >= 80) {
      return {
        warn: true,
        message: `⚠️ You've used ${usage.monthlyRequests}/${usage.monthlyLimit} of your monthly request limit (${Math.round(monthlyUsagePercent)}%).`,
      };
    }

    if (dailyCostPercent >= 80) {
      return {
        warn: true,
        message: `⚠️ You've used $${cost.dailyCost.toFixed(2)}/$${limits.dailyCost.toFixed(2)} of your daily cost limit (${Math.round(dailyCostPercent)}%).`,
      };
    }

    if (monthlyCostPercent >= 80) {
      return {
        warn: true,
        message: `⚠️ You've used $${cost.monthlyCost.toFixed(2)}/$${limits.monthlyCost.toFixed(2)} of your monthly cost limit (${Math.round(monthlyCostPercent)}%).`,
      };
    }

    return { warn: false };
  }
}

// Global instance
let rateLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiter) {
    rateLimiter = new RateLimiter();
  }
  return rateLimiter;
}
