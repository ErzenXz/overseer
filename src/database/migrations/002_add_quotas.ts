/**
 * Migration: Add Rate Limiting and Quota Tables
 * Creates tables for user quotas, token buckets, and cost tracking
 */

import { Database } from "better-sqlite3";

export function up(db: Database): void {
  // User Quotas Table
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

  // Token Buckets Table (for persistent rate limiting)
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_buckets (
      user_id TEXT NOT NULL,
      bucket_type TEXT NOT NULL CHECK (bucket_type IN ('rpm', 'tpm', 'cost')),
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

  // Cost Tracking Table
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

  console.log("✅ Migration 002: Rate limiting and quota tables created");
}

export function down(db: Database): void {
  db.exec(`
    DROP TABLE IF EXISTS cost_tracking;
    DROP TABLE IF EXISTS token_buckets;
    DROP TABLE IF EXISTS user_quotas;
  `);

  console.log("✅ Migration 002: Rate limiting and quota tables dropped");
}
