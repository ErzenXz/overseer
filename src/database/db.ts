import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  isWindows,
  normalizePath,
  getDataDir,
} from "../lib/platform";

// Re-export types from the shared types file
export type {
  User,
  Session,
  Provider,
  Interface,
  Conversation,
  Message,
  ToolExecution,
  Setting,
  Log,
  CronJob,
  CronExecution,
} from "../types/database";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get the database path, handling cross-platform paths
 */
function getDatabasePath(): string {
  // Check for explicit environment variable first
  if (process.env.DATABASE_PATH) {
    return normalizePath(resolve(process.env.DATABASE_PATH));
  }

  // Default: use platform-appropriate data directory or local ./data
  const defaultPath = join(process.cwd(), "data", "overseer.db");
  return normalizePath(defaultPath);
}

const DB_PATH = getDatabasePath();

// Ensure data directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

/**
 * Create database connection with platform-specific options
 */
function createDatabaseConnection(): Database.Database {
  const options: Database.Options = {};

  // On Windows, we might need different locking behavior
  if (isWindows()) {
    // Windows file locking is different - better-sqlite3 handles this,
    // but we can set a longer busy timeout
    options.timeout = 10000; // 10 second busy timeout
  }

  const db = new Database(DB_PATH, options);

  // Enable WAL mode for better concurrency
  // Note: WAL mode works on all platforms but has some considerations on Windows
  // with network drives. For local files, it works well.
  try {
    db.pragma("journal_mode = WAL");
  } catch (error) {
    // If WAL fails (e.g., on some network drives), fall back to DELETE mode
    console.warn("WAL mode not available, using DELETE journal mode");
    db.pragma("journal_mode = DELETE");
  }

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Set busy timeout for concurrent access
  db.pragma(`busy_timeout = ${isWindows() ? 10000 : 5000}`);

  // Optimize for better performance
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000"); // 64MB cache

  return db;
}

// Create database connection
const db = createDatabaseConnection();

/**
 * Ensure a table has all expected columns, adding any that are missing.
 * This handles the case where CREATE TABLE IF NOT EXISTS skips creation
 * but new columns have been added to the schema since the table was created.
 */
function migrateTableColumns(
  tableName: string,
  expectedColumns: { name: string; definition: string }[]
) {
  const existingCols = db.pragma(`table_info(${tableName})`) as Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
  }>;

  if (existingCols.length === 0) return; // Table doesn't exist yet, schema will create it

  const existingColNames = new Set(existingCols.map((c) => c.name));

  for (const col of expectedColumns) {
    if (!existingColNames.has(col.name)) {
      try {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.definition}`);
        console.log(`  Migrated: added column '${col.name}' to '${tableName}'`);
      } catch (err) {
        // Column may already exist due to a race or prior partial migration
        console.warn(`  Warning: could not add column '${col.name}' to '${tableName}':`, err);
      }
    }
  }
}

// Initialize schema
function initializeSchema() {
  const schemaPath = join(__dirname, "schema.sql");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
    console.log("Database schema initialized");
    console.log(`Database location: ${DB_PATH}`);
  }

  // Migrate existing tables to add any new columns before running the agent schema.
  // This prevents "no such column" errors when CREATE TABLE IF NOT EXISTS skips
  // creation of tables that already exist from an older schema version.
  migrateTableColumns("agent_sessions", [
    { name: "session_id", definition: "TEXT" },
    { name: "interface_type", definition: "TEXT NOT NULL DEFAULT 'web'" },
    { name: "interface_id", definition: "INTEGER" },
    { name: "user_id", definition: "TEXT" },
    { name: "username", definition: "TEXT" },
    { name: "status", definition: "TEXT NOT NULL DEFAULT 'active'" },
    { name: "provider_id", definition: "INTEGER" },
    { name: "model_name", definition: "TEXT" },
    { name: "started_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "last_activity_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "ended_at", definition: "TEXT" },
    { name: "context_data", definition: "TEXT" },
    { name: "current_task", definition: "TEXT" },
    { name: "step_count", definition: "INTEGER DEFAULT 0" },
    { name: "total_tokens", definition: "INTEGER DEFAULT 0" },
    { name: "estimated_cost", definition: "REAL DEFAULT 0" },
    { name: "metadata", definition: "TEXT" },
  ]);

  migrateTableColumns("sub_agents", [
    { name: "parent_session_id", definition: "TEXT" },
    { name: "sub_agent_id", definition: "TEXT" },
    { name: "agent_type", definition: "TEXT" },
    { name: "name", definition: "TEXT" },
    { name: "description", definition: "TEXT" },
    { name: "status", definition: "TEXT NOT NULL DEFAULT 'idle'" },
    { name: "assigned_task", definition: "TEXT" },
    { name: "task_result", definition: "TEXT" },
    { name: "created_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "started_at", definition: "TEXT" },
    { name: "completed_at", definition: "TEXT" },
    { name: "step_count", definition: "INTEGER DEFAULT 0" },
    { name: "tokens_used", definition: "INTEGER DEFAULT 0" },
    { name: "metadata", definition: "TEXT" },
  ]);

  // Also load agent-related schema (sub_agents, mcp_servers, skills, etc.)
  const agentSchemaPath = join(__dirname, "schema-agents.sql");
  if (existsSync(agentSchemaPath)) {
    const agentSchema = readFileSync(agentSchemaPath, "utf-8");
    db.exec(agentSchema);
    console.log("Agent schema initialized");
  }

  // Load cron job schema
  const cronSchemaPath = join(__dirname, "schema-cron.sql");
  if (existsSync(cronSchemaPath)) {
    const cronSchema = readFileSync(cronSchemaPath, "utf-8");
    db.exec(cronSchema);
    console.log("Cron schema initialized");
  }

  // Migrate cron tables for future column additions
  migrateTableColumns("cron_jobs", [
    { name: "name", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "description", definition: "TEXT" },
    { name: "cron_expression", definition: "TEXT NOT NULL DEFAULT '* * * * *'" },
    { name: "prompt", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "enabled", definition: "INTEGER NOT NULL DEFAULT 1" },
    { name: "created_by", definition: "TEXT DEFAULT 'system'" },
    { name: "timezone", definition: "TEXT DEFAULT 'UTC'" },
    { name: "max_retries", definition: "INTEGER DEFAULT 3" },
    { name: "timeout_ms", definition: "INTEGER DEFAULT 300000" },
    { name: "last_run_at", definition: "TEXT" },
    { name: "next_run_at", definition: "TEXT" },
    { name: "run_count", definition: "INTEGER DEFAULT 0" },
    { name: "last_status", definition: "TEXT" },
    { name: "metadata", definition: "TEXT" },
  ]);

  migrateTableColumns("cron_executions", [
    { name: "cron_job_id", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "conversation_id", definition: "INTEGER" },
    { name: "status", definition: "TEXT NOT NULL DEFAULT 'running'" },
    { name: "started_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "completed_at", definition: "TEXT" },
    { name: "duration_ms", definition: "INTEGER" },
    { name: "prompt", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "output_summary", definition: "TEXT" },
    { name: "error", definition: "TEXT" },
    { name: "input_tokens", definition: "INTEGER DEFAULT 0" },
    { name: "output_tokens", definition: "INTEGER DEFAULT 0" },
    { name: "tool_calls_count", definition: "INTEGER DEFAULT 0" },
    { name: "metadata", definition: "TEXT" },
  ]);

  // Migrate memory table for future column additions
  migrateTableColumns("memory", [
    { name: "key", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "value", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "category", definition: "TEXT NOT NULL DEFAULT 'custom'" },
    { name: "importance", definition: "INTEGER NOT NULL DEFAULT 5" },
    { name: "source", definition: "TEXT" },
    { name: "created_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "updated_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
  ]);
}

/**
 * Get the current database file path
 */
function getDbPath(): string {
  return DB_PATH;
}

/**
 * Check if the database file exists and is accessible
 */
function isDatabaseAccessible(): boolean {
  try {
    // Try a simple query to verify the database is working
    db.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the database connection gracefully
 * Important for Windows where file handles need to be properly released
 */
function closeDatabase(): void {
  try {
    db.close();
  } catch (error) {
    console.error("Error closing database:", error);
  }
}

// Handle process exit to close database properly
// This is especially important on Windows
process.on("exit", () => {
  closeDatabase();
});

process.on("SIGINT", () => {
  closeDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDatabase();
  process.exit(0);
});

// On Windows, also handle the SIGHUP equivalent
if (isWindows()) {
  process.on("SIGBREAK", () => {
    closeDatabase();
    process.exit(0);
  });
}

// Export the database instance and utilities
export {
  db,
  initializeSchema,
  getDbPath,
  isDatabaseAccessible,
  closeDatabase,
};
