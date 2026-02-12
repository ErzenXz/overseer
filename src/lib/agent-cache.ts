import crypto from "crypto";
import { db } from "@/database";
import { createLogger } from "@/lib/logger";

const logger = createLogger("agent-cache");

type CacheScope = "agent" | "subagent" | "tool";

export interface CacheRecord<T = unknown> {
  key: string;
  scope: CacheScope;
  value: T;
  ttlSeconds: number;
  tags?: string[];
}

interface CacheRow {
  cache_key: string;
  scope: CacheScope;
  payload: string;
  tags: string | null;
  expires_at: number;
  updated_at: number;
}

const MEMORY_MAX_ITEMS = 2000;
const inMemory = new Map<string, CacheRow>();

function nowMs() {
  return Date.now();
}

function makeStorageKey(scope: CacheScope, key: string) {
  return `${scope}:${key}`;
}

function hashKey(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function ensureCacheSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_cache (
      cache_key TEXT NOT NULL,
      scope TEXT NOT NULL,
      payload TEXT NOT NULL,
      tags TEXT,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (cache_key, scope)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_cache_expires
      ON agent_cache(expires_at);
  `);
}

function trimInMemory() {
  if (inMemory.size <= MEMORY_MAX_ITEMS) return;
  const items = [...inMemory.entries()].sort(
    (a, b) => a[1].updated_at - b[1].updated_at,
  );
  const toDelete = Math.max(0, inMemory.size - MEMORY_MAX_ITEMS);
  for (let i = 0; i < toDelete; i++) {
    inMemory.delete(items[i][0]);
  }
}

function parseRow<T>(row: CacheRow | undefined | null): T | null {
  if (!row) return null;
  if (row.expires_at <= nowMs()) return null;

  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

ensureCacheSchema();

export const agentCache = {
  hashKey,

  get<T = unknown>(scope: CacheScope, rawKey: string): T | null {
    const key = hashKey(rawKey);
    const storageKey = makeStorageKey(scope, key);

    const memRow = inMemory.get(storageKey);
    if (memRow && memRow.expires_at > nowMs()) {
      memRow.updated_at = nowMs();
      return parseRow<T>(memRow);
    }

    const row = db
      .prepare(
        `SELECT cache_key, scope, payload, tags, expires_at, updated_at
         FROM agent_cache
         WHERE cache_key = ? AND scope = ?`,
      )
      .get(key, scope) as CacheRow | undefined;

    if (!row || row.expires_at <= nowMs()) {
      if (row) {
        db.prepare(
          "DELETE FROM agent_cache WHERE cache_key = ? AND scope = ?",
        ).run(key, scope);
      }
      return null;
    }

    inMemory.set(storageKey, row);
    trimInMemory();
    return parseRow<T>(row);
  },

  set<T = unknown>({ key, scope, value, ttlSeconds, tags }: CacheRecord<T>) {
    const hashed = hashKey(key);
    const expiresAt = nowMs() + ttlSeconds * 1000;
    const updatedAt = nowMs();
    const payload = JSON.stringify(value);
    const tagsJson = tags && tags.length > 0 ? JSON.stringify(tags) : null;

    db.prepare(
      `INSERT INTO agent_cache (cache_key, scope, payload, tags, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key, scope)
       DO UPDATE SET payload = excluded.payload,
                     tags = excluded.tags,
                     expires_at = excluded.expires_at,
                     updated_at = excluded.updated_at`,
    ).run(hashed, scope, payload, tagsJson, expiresAt, updatedAt);

    inMemory.set(makeStorageKey(scope, hashed), {
      cache_key: hashed,
      scope,
      payload,
      tags: tagsJson,
      expires_at: expiresAt,
      updated_at: updatedAt,
    });

    trimInMemory();
  },

  invalidateByTag(tag: string) {
    const rows = db
      .prepare(
        "SELECT cache_key, scope, tags FROM agent_cache WHERE tags IS NOT NULL",
      )
      .all() as Array<{ cache_key: string; scope: CacheScope; tags: string }>;

    let deleted = 0;
    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags) as string[];
        if (tags.includes(tag)) {
          db.prepare(
            "DELETE FROM agent_cache WHERE cache_key = ? AND scope = ?",
          ).run(row.cache_key, row.scope);
          inMemory.delete(makeStorageKey(row.scope, row.cache_key));
          deleted++;
        }
      } catch {
        continue;
      }
    }

    logger.info("Cache tag invalidation complete", { tag, deleted });
    return deleted;
  },

  cleanupExpired() {
    const deleted = db
      .prepare("DELETE FROM agent_cache WHERE expires_at <= ?")
      .run(nowMs()).changes;

    for (const [k, row] of inMemory.entries()) {
      if (row.expires_at <= nowMs()) {
        inMemory.delete(k);
      }
    }

    return deleted;
  },
};
