import { db, type ToolExecution, type Setting, type Log } from "../db";

export interface ToolExecutionInput {
  message_id?: number;
  conversation_id?: number;
  tool_name: string;
  input: unknown;
  output?: string;
  success?: boolean;
  error?: string;
  execution_time_ms?: number;
}

export const toolExecutionsModel = {
  // Create tool execution log
  create(input: ToolExecutionInput): ToolExecution {
    const result = db
      .prepare(
        `INSERT INTO tool_executions (message_id, conversation_id, tool_name, input, output, success, error, execution_time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.message_id || null,
        input.conversation_id || null,
        input.tool_name,
        JSON.stringify(input.input),
        input.output || null,
        input.success !== undefined ? (input.success ? 1 : 0) : null,
        input.error || null,
        input.execution_time_ms || null
      );

    return db
      .prepare("SELECT * FROM tool_executions WHERE id = ?")
      .get(result.lastInsertRowid) as ToolExecution;
  },

  // Get recent tool executions
  findRecent(limit = 100): ToolExecution[] {
    return db
      .prepare(
        "SELECT * FROM tool_executions ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit) as ToolExecution[];
  },

  // Get tool executions by conversation
  findByConversation(conversationId: number, limit = 50): ToolExecution[] {
    return db
      .prepare(
        `SELECT * FROM tool_executions 
         WHERE conversation_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`
      )
      .all(conversationId, limit) as ToolExecution[];
  },

  // Get tool execution stats
  getStats(): { tool_name: string; count: number; success_rate: number }[] {
    return db
      .prepare(
        `SELECT 
           tool_name,
           COUNT(*) as count,
           ROUND(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate
         FROM tool_executions
         GROUP BY tool_name
         ORDER BY count DESC`
      )
      .all() as { tool_name: string; count: number; success_rate: number }[];
  },
};

export const settingsModel = {
  // Get setting by key
  get(key: string): string | undefined {
    const setting = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return setting?.value;
  },

  // Get setting with default
  getWithDefault(key: string, defaultValue: string): string {
    return this.get(key) ?? defaultValue;
  },

  // Set setting
  set(key: string, value: string, description?: string): void {
    db.prepare(
      `INSERT INTO settings (key, value, description, updated_at) 
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP`
    ).run(key, value, description || null, value);
  },

  // Get all settings
  getAll(): Setting[] {
    return db.prepare("SELECT * FROM settings ORDER BY key").all() as Setting[];
  },

  // Delete setting
  delete(key: string): boolean {
    const result = db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    return result.changes > 0;
  },

  // Get multiple settings as object
  getMany(keys: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  },
};

export const logsModel = {
  // Create log entry
  create(
    level: "debug" | "info" | "warn" | "error",
    category: string,
    message: string,
    metadata?: Record<string, unknown>,
    ownerUserId?: number | null,
  ): void {
    db.prepare(
      "INSERT INTO logs (owner_user_id, level, category, message, metadata) VALUES (?, ?, ?, ?, ?)"
    ).run(
      ownerUserId ?? null,
      level,
      category,
      message,
      metadata ? JSON.stringify(metadata) : null,
    );
  },

  // Convenience methods
  debug(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.create("debug", category, message, metadata);
  },

  info(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.create("info", category, message, metadata);
  },

  warn(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.create("warn", category, message, metadata);
  },

  error(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.create("error", category, message, metadata);
  },

  // Get recent logs
  findRecent(
    limit = 100,
    level?: string,
    category?: string,
    ownerUserId?: number,
  ): Log[] {
    let query = "SELECT * FROM logs";
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (typeof ownerUserId === "number") {
      conditions.push("owner_user_id = ?");
      values.push(ownerUserId);
    }
    if (level) {
      conditions.push("level = ?");
      values.push(level);
    }
    if (category) {
      conditions.push("category = ?");
      values.push(category);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    values.push(limit);

    return db.prepare(query).all(...values) as Log[];
  },

  // Clean old logs (keep last N days)
  cleanOld(daysToKeep = 30): number {
    const result = db
      .prepare(
        `DELETE FROM logs WHERE created_at < datetime('now', '-' || ? || ' days')`
      )
      .run(daysToKeep);
    return result.changes;
  },

  // Get log stats
  getStats(ownerUserId?: number): { level: string; count: number }[] {
    if (typeof ownerUserId === "number") {
      return db
        .prepare(
          `SELECT level, COUNT(*) as count
           FROM logs
           WHERE owner_user_id = ?
             AND created_at > datetime('now', '-1 day')
           GROUP BY level`,
        )
        .all(ownerUserId) as { level: string; count: number }[];
    }

    return db
      .prepare(
        `SELECT level, COUNT(*) as count 
         FROM logs 
         WHERE created_at > datetime('now', '-1 day')
         GROUP BY level`,
      )
      .all() as { level: string; count: number }[];
  },
};
