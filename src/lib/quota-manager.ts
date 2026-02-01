/**
 * User Quota Management System
 * Manages daily/monthly usage tracking with automatic reset
 */

import { db } from "../database/db";

export type UserTier = "free" | "pro" | "enterprise";

export interface QuotaLimits {
  // Requests per minute
  rpm: number;
  // Tokens per minute
  tpm: number;
  // Daily request limit
  dailyRequests: number;
  // Monthly request limit
  monthlyRequests: number;
  // Daily cost limit (USD)
  dailyCost: number;
  // Monthly cost limit (USD)
  monthlyCost: number;
  // Max concurrent requests
  maxConcurrent: number;
  // Priority (higher = more priority)
  priority: number;
}

// Tier configurations
export const TIER_LIMITS: Record<UserTier, QuotaLimits> = {
  free: {
    rpm: 3,
    tpm: 40_000,
    dailyRequests: 50,
    monthlyRequests: 1000,
    dailyCost: 0.25,
    monthlyCost: 5.0,
    maxConcurrent: 1,
    priority: 1,
  },
  pro: {
    rpm: 20,
    tpm: 200_000,
    dailyRequests: 1000,
    monthlyRequests: 20_000,
    dailyCost: 5.0,
    monthlyCost: 100.0,
    maxConcurrent: 3,
    priority: 5,
  },
  enterprise: {
    rpm: 100,
    tpm: 1_000_000,
    dailyRequests: 10_000,
    monthlyRequests: 200_000,
    dailyCost: 50.0,
    monthlyCost: 1000.0,
    maxConcurrent: 10,
    priority: 10,
  },
};

export interface UserQuota {
  user_id: string;
  tier: UserTier;
  daily_requests: number;
  monthly_requests: number;
  daily_reset_at: string;
  monthly_reset_at: string;
  grace_period_until?: string;
  is_suspended: number;
  created_at: string;
  updated_at: string;
}

export interface QuotaUsage {
  dailyRequests: number;
  monthlyRequests: number;
  dailyLimit: number;
  monthlyLimit: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  resetDaily: Date;
  resetMonthly: Date;
}

/**
 * Quota Manager
 */
export class QuotaManager {
  constructor() {
    this.initializeDatabase();
    this.startAutoReset();
  }

  /**
   * Initialize database table
   */
  private initializeDatabase(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_quotas (
        user_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
        daily_requests INTEGER NOT NULL DEFAULT 0,
        monthly_requests INTEGER NOT NULL DEFAULT 0,
        daily_reset_at DATETIME NOT NULL,
        monthly_reset_at DATETIME NOT NULL,
        grace_period_until DATETIME,
        is_suspended INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_user_quotas_tier 
        ON user_quotas(tier);
      CREATE INDEX IF NOT EXISTS idx_user_quotas_suspended 
        ON user_quotas(is_suspended);
    `);
  }

  /**
   * Get next reset times
   */
  private getResetTimes(): { daily: Date; monthly: Date } {
    const now = new Date();
    
    // Next day at midnight UTC
    const daily = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    );
    
    // Next month at midnight UTC
    const monthly = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );

    return { daily, monthly };
  }

  /**
   * Get or create user quota
   */
  getOrCreateQuota(userId: string, tier: UserTier = "free"): UserQuota {
    let quota = db
      .prepare("SELECT * FROM user_quotas WHERE user_id = ?")
      .get(userId) as UserQuota | undefined;

    if (!quota) {
      const resets = this.getResetTimes();
      
      db.prepare(
        `INSERT INTO user_quotas 
          (user_id, tier, daily_reset_at, monthly_reset_at)
        VALUES (?, ?, ?, ?)`
      ).run(userId, tier, resets.daily.toISOString(), resets.monthly.toISOString());

      quota = db
        .prepare("SELECT * FROM user_quotas WHERE user_id = ?")
        .get(userId) as UserQuota;
    }

    return quota;
  }

  /**
   * Get user's tier
   */
  getUserTier(userId: string): UserTier {
    const quota = this.getOrCreateQuota(userId);
    return quota.tier;
  }

  /**
   * Get tier limits for a user
   */
  getTierLimits(userId: string): QuotaLimits {
    const tier = this.getUserTier(userId);
    return TIER_LIMITS[tier];
  }

  /**
   * Check if user has quota available
   */
  hasQuota(userId: string): {
    allowed: boolean;
    reason?: string;
    resetDaily?: Date;
    resetMonthly?: Date;
  } {
    const quota = this.getOrCreateQuota(userId);
    
    // Check if suspended
    if (quota.is_suspended) {
      return {
        allowed: false,
        reason: "Account suspended",
      };
    }

    // Check if in grace period
    if (quota.grace_period_until) {
      const gracePeriod = new Date(quota.grace_period_until);
      if (gracePeriod > new Date()) {
        // Still in grace period, allow
        return { allowed: true };
      }
    }

    const limits = TIER_LIMITS[quota.tier];
    const dailyReset = new Date(quota.daily_reset_at);
    const monthlyReset = new Date(quota.monthly_reset_at);

    // Check daily limit
    if (quota.daily_requests >= limits.dailyRequests) {
      return {
        allowed: false,
        reason: `Daily limit reached (${limits.dailyRequests} requests)`,
        resetDaily: dailyReset,
      };
    }

    // Check monthly limit
    if (quota.monthly_requests >= limits.monthlyRequests) {
      return {
        allowed: false,
        reason: `Monthly limit reached (${limits.monthlyRequests} requests)`,
        resetMonthly: monthlyReset,
      };
    }

    return { allowed: true };
  }

  /**
   * Increment usage counters
   */
  incrementUsage(userId: string): void {
    const quota = this.getOrCreateQuota(userId);
    
    // Check if resets are needed
    const now = new Date();
    const dailyReset = new Date(quota.daily_reset_at);
    const monthlyReset = new Date(quota.monthly_reset_at);
    
    let dailyRequests = quota.daily_requests;
    let monthlyRequests = quota.monthly_requests;
    let newDailyReset = dailyReset;
    let newMonthlyReset = monthlyReset;

    if (now >= dailyReset) {
      dailyRequests = 0;
      newDailyReset = this.getResetTimes().daily;
    }

    if (now >= monthlyReset) {
      monthlyRequests = 0;
      newMonthlyReset = this.getResetTimes().monthly;
    }

    // Increment
    db.prepare(
      `UPDATE user_quotas 
       SET daily_requests = ?,
           monthly_requests = ?,
           daily_reset_at = ?,
           monthly_reset_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).run(
      dailyRequests + 1,
      monthlyRequests + 1,
      newDailyReset.toISOString(),
      newMonthlyReset.toISOString(),
      userId
    );
  }

  /**
   * Get quota usage summary
   */
  getUsage(userId: string): QuotaUsage {
    const quota = this.getOrCreateQuota(userId);
    const limits = TIER_LIMITS[quota.tier];

    return {
      dailyRequests: quota.daily_requests,
      monthlyRequests: quota.monthly_requests,
      dailyLimit: limits.dailyRequests,
      monthlyLimit: limits.monthlyRequests,
      dailyRemaining: Math.max(0, limits.dailyRequests - quota.daily_requests),
      monthlyRemaining: Math.max(0, limits.monthlyRequests - quota.monthly_requests),
      resetDaily: new Date(quota.daily_reset_at),
      resetMonthly: new Date(quota.monthly_reset_at),
    };
  }

  /**
   * Update user tier
   */
  updateTier(userId: string, tier: UserTier): void {
    const quota = this.getOrCreateQuota(userId);
    
    db.prepare(
      `UPDATE user_quotas 
       SET tier = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).run(tier, userId);
  }

  /**
   * Grant grace period (e.g., for premium users)
   */
  grantGracePeriod(userId: string, hours: number): void {
    const gracePeriod = new Date();
    gracePeriod.setHours(gracePeriod.getHours() + hours);

    db.prepare(
      `UPDATE user_quotas 
       SET grace_period_until = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).run(gracePeriod.toISOString(), userId);
  }

  /**
   * Suspend a user
   */
  suspendUser(userId: string): void {
    db.prepare(
      `UPDATE user_quotas 
       SET is_suspended = 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).run(userId);
  }

  /**
   * Unsuspend a user
   */
  unsuspendUser(userId: string): void {
    db.prepare(
      `UPDATE user_quotas 
       SET is_suspended = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).run(userId);
  }

  /**
   * Reset user quotas (admin function)
   */
  resetQuotas(userId: string): void {
    const resets = this.getResetTimes();
    
    db.prepare(
      `UPDATE user_quotas 
       SET daily_requests = 0,
           monthly_requests = 0,
           daily_reset_at = ?,
           monthly_reset_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`
    ).run(resets.daily.toISOString(), resets.monthly.toISOString(), userId);
  }

  /**
   * Auto-reset quotas (run periodically)
   */
  private autoReset(): void {
    const now = new Date().toISOString();

    // Reset daily quotas
    db.prepare(
      `UPDATE user_quotas 
       SET daily_requests = 0,
           daily_reset_at = datetime(daily_reset_at, '+1 day'),
           updated_at = CURRENT_TIMESTAMP
       WHERE daily_reset_at <= ?`
    ).run(now);

    // Reset monthly quotas
    db.prepare(
      `UPDATE user_quotas 
       SET monthly_requests = 0,
           monthly_reset_at = datetime(monthly_reset_at, '+1 month'),
           updated_at = CURRENT_TIMESTAMP
       WHERE monthly_reset_at <= ?`
    ).run(now);
  }

  /**
   * Start auto-reset timer
   */
  private startAutoReset(): void {
    // Check every minute
    setInterval(() => {
      this.autoReset();
    }, 60_000);

    // Also run on startup
    this.autoReset();
  }

  /**
   * Get all users by tier (admin function)
   */
  getUsersByTier(tier: UserTier): UserQuota[] {
    return db
      .prepare("SELECT * FROM user_quotas WHERE tier = ?")
      .all(tier) as UserQuota[];
  }

  /**
   * Get usage stats (admin function)
   */
  getStats(): {
    totalUsers: number;
    byTier: Record<UserTier, number>;
    suspended: number;
  } {
    const totalUsers = (
      db.prepare("SELECT COUNT(*) as count FROM user_quotas").get() as {
        count: number;
      }
    ).count;

    const byTierResults = db
      .prepare(
        `SELECT tier, COUNT(*) as count 
         FROM user_quotas 
         GROUP BY tier`
      )
      .all() as Array<{ tier: UserTier; count: number }>;

    const byTier: Record<UserTier, number> = {
      free: 0,
      pro: 0,
      enterprise: 0,
    };

    for (const row of byTierResults) {
      byTier[row.tier] = row.count;
    }

    const suspended = (
      db
        .prepare("SELECT COUNT(*) as count FROM user_quotas WHERE is_suspended = 1")
        .get() as { count: number }
    ).count;

    return {
      totalUsers,
      byTier,
      suspended,
    };
  }
}

// Global instance
let quotaManager: QuotaManager | null = null;

export function getQuotaManager(): QuotaManager {
  if (!quotaManager) {
    quotaManager = new QuotaManager();
  }
  return quotaManager;
}
