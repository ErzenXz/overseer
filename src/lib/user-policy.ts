import { db } from "@/database";
import { getCostTracker } from "@/lib/cost-tracker";

export interface UserPolicy {
  user_id: string;
  allowed_models: string | null;
  max_input_tokens_per_request: number | null;
  max_output_tokens_per_request: number | null;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  daily_cost_limit: number | null;
  monthly_cost_limit: number | null;
  created_at: string;
  updated_at: string;
}

export interface UserPolicyInput {
  allowedModels?: string[];
  maxInputTokensPerRequest?: number | null;
  maxOutputTokensPerRequest?: number | null;
  dailyTokenLimit?: number | null;
  monthlyTokenLimit?: number | null;
  dailyCostLimit?: number | null;
  monthlyCostLimit?: number | null;
}

export interface UserTokenUsage {
  dailyTokens: number;
  monthlyTokens: number;
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_policies (
      user_id TEXT PRIMARY KEY,
      allowed_models TEXT,
      max_input_tokens_per_request INTEGER,
      max_output_tokens_per_request INTEGER,
      daily_token_limit INTEGER,
      monthly_token_limit INTEGER,
      daily_cost_limit REAL,
      monthly_cost_limit REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_user_policies_updated
      ON user_policies(updated_at);
  `);
}

ensureSchema();

function startOfDayIso() {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();
}

function startOfMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function getUserPolicy(userId: string): UserPolicy | null {
  const row = db
    .prepare("SELECT * FROM user_policies WHERE user_id = ?")
    .get(userId) as UserPolicy | undefined;
  return row ?? null;
}

export function upsertUserPolicy(
  userId: string,
  input: UserPolicyInput,
): UserPolicy {
  const existing = getUserPolicy(userId);

  const resolvedAllowedModels =
    input.allowedModels !== undefined
      ? input.allowedModels.length > 0
        ? JSON.stringify(input.allowedModels)
        : null
      : (existing?.allowed_models ?? null);

  const maxInput =
    input.maxInputTokensPerRequest !== undefined
      ? input.maxInputTokensPerRequest
      : (existing?.max_input_tokens_per_request ?? null);

  const maxOutput =
    input.maxOutputTokensPerRequest !== undefined
      ? input.maxOutputTokensPerRequest
      : (existing?.max_output_tokens_per_request ?? null);

  const dailyTokens =
    input.dailyTokenLimit !== undefined
      ? input.dailyTokenLimit
      : (existing?.daily_token_limit ?? null);

  const monthlyTokens =
    input.monthlyTokenLimit !== undefined
      ? input.monthlyTokenLimit
      : (existing?.monthly_token_limit ?? null);

  const dailyCost =
    input.dailyCostLimit !== undefined
      ? input.dailyCostLimit
      : (existing?.daily_cost_limit ?? null);

  const monthlyCost =
    input.monthlyCostLimit !== undefined
      ? input.monthlyCostLimit
      : (existing?.monthly_cost_limit ?? null);

  db.prepare(
    `INSERT INTO user_policies (
      user_id,
      allowed_models,
      max_input_tokens_per_request,
      max_output_tokens_per_request,
      daily_token_limit,
      monthly_token_limit,
      daily_cost_limit,
      monthly_cost_limit,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      allowed_models = excluded.allowed_models,
      max_input_tokens_per_request = excluded.max_input_tokens_per_request,
      max_output_tokens_per_request = excluded.max_output_tokens_per_request,
      daily_token_limit = excluded.daily_token_limit,
      monthly_token_limit = excluded.monthly_token_limit,
      daily_cost_limit = excluded.daily_cost_limit,
      monthly_cost_limit = excluded.monthly_cost_limit,
      updated_at = CURRENT_TIMESTAMP`,
  ).run(
    userId,
    resolvedAllowedModels,
    maxInput,
    maxOutput,
    dailyTokens,
    monthlyTokens,
    dailyCost,
    monthlyCost,
  );

  return getUserPolicy(userId)!;
}

export function getAllowedModels(userId: string): string[] | null {
  const policy = getUserPolicy(userId);
  if (!policy?.allowed_models) return null;

  try {
    const parsed = JSON.parse(policy.allowed_models) as string[];
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function getUserTokenUsage(userId: string): UserTokenUsage {
  const daily = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total
       FROM cost_tracking
       WHERE user_id = ? AND created_at >= ?`,
    )
    .get(userId, startOfDayIso()) as { total: number };

  const monthly = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total
       FROM cost_tracking
       WHERE user_id = ? AND created_at >= ?`,
    )
    .get(userId, startOfMonthIso()) as { total: number };

  return {
    dailyTokens: daily.total,
    monthlyTokens: monthly.total,
  };
}

export function checkUserPolicyBeforeRequest(input: {
  userId: string;
  modelId?: string;
  estimatedInputTokens?: number;
  requestedMaxOutputTokens?: number;
}): { allowed: boolean; reason?: string } {
  const policy = getUserPolicy(input.userId);
  if (!policy) return { allowed: true };

  const allowedModels = getAllowedModels(input.userId);
  if (
    allowedModels &&
    input.modelId &&
    !allowedModels.includes(input.modelId)
  ) {
    return {
      allowed: false,
      reason: `Model '${input.modelId}' is not allowed for this user.`,
    };
  }

  if (
    policy.max_input_tokens_per_request !== null &&
    (input.estimatedInputTokens ?? 0) > policy.max_input_tokens_per_request
  ) {
    return {
      allowed: false,
      reason: `Input token estimate exceeds per-request limit (${policy.max_input_tokens_per_request}).`,
    };
  }

  if (
    policy.max_output_tokens_per_request !== null &&
    (input.requestedMaxOutputTokens ?? 0) > policy.max_output_tokens_per_request
  ) {
    return {
      allowed: false,
      reason: `Requested output tokens exceed per-request limit (${policy.max_output_tokens_per_request}).`,
    };
  }

  const usage = getUserTokenUsage(input.userId);

  if (
    policy.daily_token_limit !== null &&
    usage.dailyTokens + (input.estimatedInputTokens ?? 0) >
      policy.daily_token_limit
  ) {
    return {
      allowed: false,
      reason: `Daily token limit exceeded (${policy.daily_token_limit}).`,
    };
  }

  if (
    policy.monthly_token_limit !== null &&
    usage.monthlyTokens + (input.estimatedInputTokens ?? 0) >
      policy.monthly_token_limit
  ) {
    return {
      allowed: false,
      reason: `Monthly token limit exceeded (${policy.monthly_token_limit}).`,
    };
  }

  const costSummary = getCostTracker().getUserCostSummary(input.userId);

  if (
    policy.daily_cost_limit !== null &&
    costSummary.dailyCost >= policy.daily_cost_limit
  ) {
    return {
      allowed: false,
      reason: `Daily custom cost limit exceeded ($${policy.daily_cost_limit.toFixed(2)}).`,
    };
  }

  if (
    policy.monthly_cost_limit !== null &&
    costSummary.monthlyCost >= policy.monthly_cost_limit
  ) {
    return {
      allowed: false,
      reason: `Monthly custom cost limit exceeded ($${policy.monthly_cost_limit.toFixed(2)}).`,
    };
  }

  return { allowed: true };
}
