/**
 * LLM Cost Tracking System
 * Track costs per user with model-specific pricing
 */

import { db } from "../database/db";

// Model pricing per 1M tokens (input/output)
export const MODEL_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-4": { input: 30.0, output: 60.0 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1-preview": { input: 15.0, output: 60.0 },
  "o1-mini": { input: 3.0, output: 12.0 },

  // Anthropic
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20240620": { input: 3.0, output: 15.0 },
  "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
  "claude-3-sonnet-20240229": { input: 3.0, output: 15.0 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },

  // Google
  "gemini-2.0-flash-exp": { input: 0.0, output: 0.0 }, // Free tier
  "gemini-1.5-pro": { input: 1.25, output: 5.0 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-1.0-pro": { input: 0.5, output: 1.5 },

  // Local models (free)
  ollama: { input: 0.0, output: 0.0 },
};

export interface CostRecord {
  id: number;
  user_id: string;
  conversation_id?: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  interface_type: string;
  created_at: string;
}

export interface UserCostSummary {
  userId: string;
  totalCost: number;
  dailyCost: number;
  monthlyCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: Record<string, { cost: number; requests: number }>;
}

/**
 * Cost Tracker for LLM API usage
 */
export class CostTracker {
  constructor() {
    this.initializeDatabase();
  }

  /**
   * Initialize database table
   */
  private initializeDatabase(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cost_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        conversation_id INTEGER,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        interface_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cost_tracking_user 
        ON cost_tracking(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cost_tracking_conversation 
        ON cost_tracking(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_cost_tracking_model 
        ON cost_tracking(model, created_at);
    `);
  }

  /**
   * Calculate cost for a model and token usage
   */
  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    // Normalize model name (remove version suffixes, etc.)
    const normalizedModel = this.normalizeModelName(model);
    const pricing = MODEL_PRICING[normalizedModel];

    if (!pricing) {
      // Default to GPT-4o pricing for unknown models
      console.warn(`Unknown model pricing for: ${model}, using GPT-4o pricing`);
      return (
        (inputTokens * 2.5 + outputTokens * 10.0) / 1_000_000
      );
    }

    return (
      (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
    );
  }

  /**
   * Normalize model name for pricing lookup
   */
  private normalizeModelName(model: string): string {
    // Remove common suffixes and variations
    const normalized = model.toLowerCase().trim();

    // Direct matches
    if (MODEL_PRICING[normalized]) {
      return normalized;
    }

    // Check for partial matches
    for (const key of Object.keys(MODEL_PRICING)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return key;
      }
    }

    // Check for provider families
    if (normalized.includes("gpt-4o-mini")) return "gpt-4o-mini";
    if (normalized.includes("gpt-4o")) return "gpt-4o";
    if (normalized.includes("gpt-4-turbo")) return "gpt-4-turbo";
    if (normalized.includes("gpt-4")) return "gpt-4";
    if (normalized.includes("gpt-3.5")) return "gpt-3.5-turbo";
    if (normalized.includes("claude-3-5-sonnet")) return "claude-3-5-sonnet-20241022";
    if (normalized.includes("claude-3-opus")) return "claude-3-opus-20240229";
    if (normalized.includes("claude-3-sonnet")) return "claude-3-sonnet-20240229";
    if (normalized.includes("claude-3-haiku")) return "claude-3-haiku-20240307";
    if (normalized.includes("gemini-2.0-flash")) return "gemini-2.0-flash-exp";
    if (normalized.includes("gemini-1.5-pro")) return "gemini-1.5-pro";
    if (normalized.includes("gemini-1.5-flash")) return "gemini-1.5-flash";
    if (normalized.includes("gemini-1.0")) return "gemini-1.0-pro";
    if (normalized.includes("ollama") || normalized.includes("llama")) return "ollama";

    return normalized;
  }

  /**
   * Record a cost entry
   */
  recordCost(params: {
    userId: string;
    conversationId?: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    interfaceType: string;
  }): number {
    const cost = this.calculateCost(
      params.model,
      params.inputTokens,
      params.outputTokens
    );

    const result = db
      .prepare(
        `INSERT INTO cost_tracking 
          (user_id, conversation_id, model, input_tokens, output_tokens, cost_usd, interface_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.userId,
        params.conversationId || null,
        params.model,
        params.inputTokens,
        params.outputTokens,
        cost,
        params.interfaceType
      );

    return cost;
  }

  /**
   * Get user's cost summary
   */
  getUserCostSummary(userId: string): UserCostSummary {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total cost
    const totalResult = db
      .prepare(
        `SELECT 
          COALESCE(SUM(cost_usd), 0) as total_cost,
          COUNT(*) as total_requests,
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output
        FROM cost_tracking 
        WHERE user_id = ?`
      )
      .get(userId) as {
        total_cost: number;
        total_requests: number;
        total_input: number;
        total_output: number;
      };

    // Daily cost
    const dailyResult = db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as daily_cost
        FROM cost_tracking 
        WHERE user_id = ? AND created_at >= ?`
      )
      .get(userId, startOfDay.toISOString()) as { daily_cost: number };

    // Monthly cost
    const monthlyResult = db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as monthly_cost
        FROM cost_tracking 
        WHERE user_id = ? AND created_at >= ?`
      )
      .get(userId, startOfMonth.toISOString()) as { monthly_cost: number };

    // By model
    const byModelResults = db
      .prepare(
        `SELECT 
          model,
          COALESCE(SUM(cost_usd), 0) as cost,
          COUNT(*) as requests
        FROM cost_tracking 
        WHERE user_id = ?
        GROUP BY model`
      )
      .all(userId) as Array<{ model: string; cost: number; requests: number }>;

    const byModel: Record<string, { cost: number; requests: number }> = {};
    for (const row of byModelResults) {
      byModel[row.model] = {
        cost: row.cost,
        requests: row.requests,
      };
    }

    return {
      userId,
      totalCost: totalResult.total_cost,
      dailyCost: dailyResult.daily_cost,
      monthlyCost: monthlyResult.monthly_cost,
      totalRequests: totalResult.total_requests,
      totalInputTokens: totalResult.total_input,
      totalOutputTokens: totalResult.total_output,
      byModel,
    };
  }

  /**
   * Get monthly billing report for a user
   */
  getMonthlyReport(userId: string, year: number, month: number): {
    totalCost: number;
    byDay: Array<{ date: string; cost: number; requests: number }>;
    byModel: Array<{ model: string; cost: number; requests: number }>;
  } {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    // Total cost
    const totalResult = db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) as total_cost
        FROM cost_tracking 
        WHERE user_id = ? AND created_at >= ? AND created_at < ?`
      )
      .get(userId, startDate.toISOString(), endDate.toISOString()) as {
        total_cost: number;
      };

    // By day
    const byDayResults = db
      .prepare(
        `SELECT 
          DATE(created_at) as date,
          COALESCE(SUM(cost_usd), 0) as cost,
          COUNT(*) as requests
        FROM cost_tracking 
        WHERE user_id = ? AND created_at >= ? AND created_at < ?
        GROUP BY DATE(created_at)
        ORDER BY date`
      )
      .all(userId, startDate.toISOString(), endDate.toISOString()) as Array<{
        date: string;
        cost: number;
        requests: number;
      }>;

    // By model
    const byModelResults = db
      .prepare(
        `SELECT 
          model,
          COALESCE(SUM(cost_usd), 0) as cost,
          COUNT(*) as requests
        FROM cost_tracking 
        WHERE user_id = ? AND created_at >= ? AND created_at < ?
        GROUP BY model
        ORDER BY cost DESC`
      )
      .all(userId, startDate.toISOString(), endDate.toISOString()) as Array<{
        model: string;
        cost: number;
        requests: number;
      }>;

    return {
      totalCost: totalResult.total_cost,
      byDay: byDayResults,
      byModel: byModelResults,
    };
  }

  /**
   * Check if user is over budget
   */
  isOverBudget(userId: string, dailyBudget: number, monthlyBudget: number): {
    overDaily: boolean;
    overMonthly: boolean;
    dailyCost: number;
    monthlyCost: number;
  } {
    const summary = this.getUserCostSummary(userId);

    return {
      overDaily: summary.dailyCost >= dailyBudget,
      overMonthly: summary.monthlyCost >= monthlyBudget,
      dailyCost: summary.dailyCost,
      monthlyCost: summary.monthlyCost,
    };
  }

  /**
   * Get all users sorted by cost (for admin)
   */
  getTopUsers(limit: number = 10): Array<{
    userId: string;
    totalCost: number;
    monthlyCost: number;
    totalRequests: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const results = db
      .prepare(
        `SELECT 
          user_id,
          COALESCE(SUM(cost_usd), 0) as total_cost,
          COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_usd ELSE 0 END), 0) as monthly_cost,
          COUNT(*) as total_requests
        FROM cost_tracking 
        GROUP BY user_id
        ORDER BY total_cost DESC
        LIMIT ?`
      )
      .all(startOfMonth.toISOString(), limit) as Array<{
        user_id: string;
        total_cost: number;
        monthly_cost: number;
        total_requests: number;
      }>;

    return results.map((r) => ({
      userId: r.user_id,
      totalCost: r.total_cost,
      monthlyCost: r.monthly_cost,
      totalRequests: r.total_requests,
    }));
  }

  /**
   * Clean up old records (keep last 6 months)
   */
  cleanup(): void {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);

    db.prepare(
      `DELETE FROM cost_tracking WHERE created_at < ?`
    ).run(cutoffDate.toISOString());
  }
}

// Global instance
let costTracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!costTracker) {
    costTracker = new CostTracker();
  }
  return costTracker;
}
