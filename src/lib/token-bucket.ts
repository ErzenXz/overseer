/**
 * Token Bucket Algorithm Implementation
 * Allows burst traffic within limits with smooth refill rate
 * Supports persistence across restarts
 */

import { db } from "../database/db";

export interface TokenBucketConfig {
  capacity: number; // Maximum tokens in bucket
  refillRate: number; // Tokens added per second
  userId: string;
  bucketType: "rpm" | "tpm" | "cost"; // Request, Token, or Cost bucket
}

export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * Token Bucket for rate limiting with burst support
 */
export class TokenBucket {
  private config: TokenBucketConfig;
  private state: TokenBucketState;

  constructor(config: TokenBucketConfig, initialState?: TokenBucketState) {
    this.config = config;
    this.state = initialState || {
      tokens: config.capacity,
      lastRefill: Date.now(),
    };
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.state.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.config.refillRate;

    this.state.tokens = Math.min(
      this.config.capacity,
      this.state.tokens + tokensToAdd
    );
    this.state.lastRefill = now;
  }

  /**
   * Try to consume tokens
   * @returns true if tokens were consumed, false if insufficient
   */
  tryConsume(tokens: number = 1): boolean {
    this.refill();

    if (this.state.tokens >= tokens) {
      this.state.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.state.tokens;
  }

  /**
   * Get time until bucket refills to specified amount
   */
  getTimeUntilRefill(requiredTokens: number): number {
    this.refill();
    
    if (this.state.tokens >= requiredTokens) {
      return 0;
    }

    const tokensNeeded = requiredTokens - this.state.tokens;
    const secondsNeeded = tokensNeeded / this.config.refillRate;
    
    return Math.ceil(secondsNeeded * 1000); // milliseconds
  }

  /**
   * Get current state for persistence
   */
  getState(): TokenBucketState {
    this.refill();
    return { ...this.state };
  }

  /**
   * Reset bucket to full capacity
   */
  reset(): void {
    this.state.tokens = this.config.capacity;
    this.state.lastRefill = Date.now();
  }
}

/**
 * Token Bucket Manager with database persistence
 */
export class TokenBucketManager {
  private buckets: Map<string, TokenBucket> = new Map();
  private saveInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeDatabase();
    this.loadBuckets();
    this.startAutoSave();
  }

  /**
   * Initialize database table
   */
  private initializeDatabase(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_buckets (
        user_id TEXT NOT NULL,
        bucket_type TEXT NOT NULL,
        tokens REAL NOT NULL,
        last_refill INTEGER NOT NULL,
        capacity REAL NOT NULL,
        refill_rate REAL NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, bucket_type)
      );
      
      CREATE INDEX IF NOT EXISTS idx_token_buckets_user 
        ON token_buckets(user_id);
    `);
  }

  /**
   * Load buckets from database
   */
  private loadBuckets(): void {
    const rows = db
      .prepare(
        `SELECT user_id, bucket_type, tokens, last_refill, capacity, refill_rate 
         FROM token_buckets`
      )
      .all() as Array<{
        user_id: string;
        bucket_type: string;
        tokens: number;
        last_refill: number;
        capacity: number;
        refill_rate: number;
      }>;

    for (const row of rows) {
      const key = `${row.user_id}:${row.bucket_type}`;
      const bucket = new TokenBucket(
        {
          userId: row.user_id,
          bucketType: row.bucket_type as "rpm" | "tpm" | "cost",
          capacity: row.capacity,
          refillRate: row.refill_rate,
        },
        {
          tokens: row.tokens,
          lastRefill: row.last_refill,
        }
      );
      this.buckets.set(key, bucket);
    }
  }

  /**
   * Save buckets to database periodically
   */
  private startAutoSave(): void {
    // Save every 10 seconds
    this.saveInterval = setInterval(() => {
      this.saveAll();
    }, 10000);

    // Also save on process exit
    process.on("beforeExit", () => {
      this.saveAll();
    });
  }

  /**
   * Save all buckets to database
   */
  saveAll(): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO token_buckets 
        (user_id, bucket_type, tokens, last_refill, capacity, refill_rate, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const transaction = db.transaction(() => {
      for (const [key, bucket] of this.buckets.entries()) {
        const [userId, bucketType] = key.split(":");
        const state = bucket.getState();
        const config = (bucket as any).config as TokenBucketConfig;

        stmt.run(
          userId,
          bucketType,
          state.tokens,
          state.lastRefill,
          config.capacity,
          config.refillRate
        );
      }
    });

    transaction();
  }

  /**
   * Get or create a token bucket
   */
  getBucket(config: TokenBucketConfig): TokenBucket {
    const key = `${config.userId}:${config.bucketType}`;
    
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(config);
      this.buckets.set(key, bucket);
    }

    return bucket;
  }

  /**
   * Try to consume tokens from a bucket
   */
  tryConsume(config: TokenBucketConfig, tokens: number = 1): boolean {
    const bucket = this.getBucket(config);
    return bucket.tryConsume(tokens);
  }

  /**
   * Get time until refill for a bucket
   */
  getTimeUntilRefill(config: TokenBucketConfig, requiredTokens: number): number {
    const bucket = this.getBucket(config);
    return bucket.getTimeUntilRefill(requiredTokens);
  }

  /**
   * Reset a bucket
   */
  resetBucket(userId: string, bucketType: "rpm" | "tpm" | "cost"): void {
    const key = `${userId}:${bucketType}`;
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.reset();
    }
  }

  /**
   * Clean up old buckets (users inactive for more than 30 days)
   */
  cleanup(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    
    db.prepare(`
      DELETE FROM token_buckets 
      WHERE updated_at < datetime(?, 'unixepoch', 'localtime')
    `).run(Math.floor(cutoff / 1000));
  }

  /**
   * Stop auto-save interval
   */
  destroy(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.saveAll();
  }
}

// Global instance
let tokenBucketManager: TokenBucketManager | null = null;

export function getTokenBucketManager(): TokenBucketManager {
  if (!tokenBucketManager) {
    tokenBucketManager = new TokenBucketManager();
  }
  return tokenBucketManager;
}
