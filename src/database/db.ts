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
  InterfaceType,
  Interface,
  Conversation,
  Message,
  ToolExecution,
  Setting,
  Log,
  CronJob,
  CronExecution,
  AgentTask,
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
let schemaInitialized = false;

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

/**
 * SQLite can't ALTER an existing CHECK constraint, so when we need to expand
 * supported interface types we rebuild the table once and drop the CHECK.
 *
 * This keeps the DB future-proof for new interface integrations.
 */
function migrateInterfacesTableToDropTypeCheckConstraint() {
  try {
    const row = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'interfaces'",
      )
      .get() as { sql?: string } | undefined;

    const sql = row?.sql || "";
    const hasTypeCheck =
      /\btype\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(/i.test(sql) ||
      /\bCHECK\s*\(\s*type\s+IN\s*\(/i.test(sql);

    if (!hasTypeCheck) return;

    console.log(
      "  Migrating: rebuilding 'interfaces' table to remove type CHECK constraint",
    );

    // Foreign keys need to be off for table rebuild operations.
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");

    db.exec("ALTER TABLE interfaces RENAME TO interfaces_old");

    db.exec(`
      CREATE TABLE interfaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        allowed_users TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.exec(`
      INSERT INTO interfaces (id, type, name, config, is_active, allowed_users, created_at, updated_at)
      SELECT id, type, name, config, is_active, allowed_users, created_at, updated_at
      FROM interfaces_old;
    `);

    // Keep AUTOINCREMENT sequence in sync to avoid id reuse.
    try {
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'interfaces';");
      db.exec(
        "INSERT INTO sqlite_sequence(name, seq) SELECT 'interfaces', COALESCE(MAX(id), 0) FROM interfaces;",
      );
    } catch {
      // sqlite_sequence may not exist (older sqlite / no autoincrement usage yet)
    }

    db.exec("DROP TABLE interfaces_old");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");
  } catch (err) {
    console.warn(
      "  Warning: failed to migrate interfaces table type constraint:",
      err,
    );
    try {
      db.exec("ROLLBACK");
    } catch {}
    try {
      db.exec("PRAGMA foreign_keys = ON");
    } catch {}
  }
}

/**
 * Roles used by the app (admin/developer/operator/viewer, etc.) should not be
 * constrained with a hard-coded CHECK in SQLite. If an older DB has the CHECK,
 * rebuild the table once to remove it.
 */
function migrateUsersTableToDropRoleCheckConstraint() {
  try {
    const row = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'",
      )
      .get() as { sql?: string } | undefined;

    const sql = row?.sql || "";
    const hasRoleCheck =
      /\brole\s+TEXT\s+DEFAULT\s+'admin'\s+CHECK\s*\(/i.test(sql) ||
      /\bCHECK\s*\(\s*role\s+IN\s*\(/i.test(sql);

    if (!hasRoleCheck) return;

    console.log(
      "  Migrating: rebuilding 'users' table to remove role CHECK constraint",
    );

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");

    db.exec("ALTER TABLE users RENAME TO users_old");

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      );
    `);

    db.exec(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at, last_login_at)
      SELECT id, username, password_hash, role, created_at, updated_at, last_login_at
      FROM users_old;
    `);

    try {
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'users';");
      db.exec(
        "INSERT INTO sqlite_sequence(name, seq) SELECT 'users', COALESCE(MAX(id), 0) FROM users;",
      );
    } catch {
      // ignore
    }

    db.exec("DROP TABLE users_old");
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys = ON");
  } catch (err) {
    console.warn("  Warning: failed to migrate users role constraint:", err);
    try {
      db.exec("ROLLBACK");
    } catch {}
    try {
      db.exec("PRAGMA foreign_keys = ON");
    } catch {}
  }
}

function getFirstAdminUserId(): number {
  try {
    const row = db
      .prepare(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
      )
      .get() as { id?: number } | undefined;
    if (row?.id) return row.id;
  } catch {
    // ignore
  }
  try {
    const row = db
      .prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1")
      .get() as { id?: number } | undefined;
    if (row?.id) return row.id;
  } catch {
    // ignore
  }
  return 1;
}

function backfillOwnerUserId(tableName: string) {
  const ownerId = getFirstAdminUserId();
  try {
    const cols = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    const hasOwner = cols.some((c) => c.name === "owner_user_id");
    if (!hasOwner) return;
    db.prepare(
      `UPDATE ${tableName} SET owner_user_id = ? WHERE owner_user_id IS NULL OR owner_user_id = 0`,
    ).run(ownerId);
  } catch {
    // ignore
  }
}

function columnExists(tableName: string, columnName: string): boolean {
  try {
    const cols = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    return cols.some((c) => c.name === columnName);
  } catch {
    return false;
  }
}

function createIndexIfPossible(sql: string) {
  try {
    db.exec(sql);
  } catch {
    // ignore index creation errors for backward compatibility
  }
}

// Initialize schema
function initializeSchema() {
  if (schemaInitialized) {
    return;
  }

  const schemaPath = join(__dirname, "schema.sql");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
    console.log("Database schema initialized");
    console.log(`Database location: ${DB_PATH}`);
  }

  // Keep roles flexible over time.
  migrateUsersTableToDropRoleCheckConstraint();

  // Keep interface types extensible as the product adds more channels.
  migrateInterfacesTableToDropTypeCheckConstraint();

  // Migrate existing tables to add any new columns before running the agent schema.
  // This prevents "no such column" errors when CREATE TABLE IF NOT EXISTS skips
  // creation of tables that already exist from an older schema version.
  migrateTableColumns("agent_sessions", [
    { name: "session_id", definition: "TEXT" },
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
    { name: "conversation_id", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "interface_type", definition: "TEXT NOT NULL DEFAULT 'web'" },
    { name: "interface_id", definition: "INTEGER" },
    { name: "external_user_id", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "external_chat_id", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "messages", definition: "TEXT NOT NULL DEFAULT '[]'" },
    { name: "summaries", definition: "TEXT NOT NULL DEFAULT '[]'" },
    { name: "state", definition: "TEXT NOT NULL DEFAULT '{}'" },
    { name: "total_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "input_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "output_tokens", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "token_limit", definition: "INTEGER NOT NULL DEFAULT 4000" },
    { name: "last_active_at", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "created_at", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "expires_at", definition: "INTEGER" },
    { name: "is_active", definition: "INTEGER NOT NULL DEFAULT 1" },
    { name: "message_count", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "tool_calls_count", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "error_count", definition: "INTEGER NOT NULL DEFAULT 0" },
    { name: "metadata", definition: "TEXT NOT NULL DEFAULT '{}'" },
  ]);

  migrateTableColumns("sub_agents", [
    { name: "parent_session_id", definition: "TEXT" },
    { name: "sub_agent_id", definition: "TEXT" },
    { name: "agent_type", definition: "TEXT" },
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
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

  // Load tasks schema
  const tasksSchemaPath = join(__dirname, "schema-tasks.sql");
  if (existsSync(tasksSchemaPath)) {
    const tasksSchema = readFileSync(tasksSchemaPath, "utf-8");
    db.exec(tasksSchema);
    console.log("Tasks schema initialized");
  }

  migrateTableColumns("agent_tasks", [
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
    { name: "conversation_id", definition: "INTEGER" },
    { name: "parent_task_id", definition: "INTEGER" },
    { name: "title", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "input", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "status", definition: "TEXT NOT NULL DEFAULT 'queued'" },
    { name: "priority", definition: "INTEGER NOT NULL DEFAULT 5" },
    { name: "assigned_sub_agent_id", definition: "TEXT" },
    { name: "created_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "started_at", definition: "TEXT" },
    { name: "finished_at", definition: "TEXT" },
    { name: "result_summary", definition: "TEXT" },
    { name: "result_full", definition: "TEXT" },
    { name: "error", definition: "TEXT" },
    { name: "artifacts", definition: "TEXT" },
  ]);

  backfillOwnerUserId("agent_tasks");

  // Migrate cron tables for future column additions
  migrateTableColumns("cron_jobs", [
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
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
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
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
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
    { name: "scope", definition: "TEXT NOT NULL DEFAULT 'private'" },
    { name: "key", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "value", definition: "TEXT NOT NULL DEFAULT ''" },
    { name: "category", definition: "TEXT NOT NULL DEFAULT 'custom'" },
    { name: "importance", definition: "INTEGER NOT NULL DEFAULT 5" },
    { name: "source", definition: "TEXT" },
    { name: "created_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "updated_at", definition: "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" },
  ]);

  migrateTableColumns("interfaces", [
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
  ]);

  migrateTableColumns("conversations", [
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
  ]);

  migrateTableColumns("skills", [
    { name: "owner_user_id", definition: "INTEGER NOT NULL DEFAULT 1" },
  ]);

  migrateTableColumns("logs", [{ name: "owner_user_id", definition: "INTEGER" }]);

  // Backfill tenant ownership where needed (first admin user).
  backfillOwnerUserId("interfaces");
  backfillOwnerUserId("conversations");
  backfillOwnerUserId("skills");
  backfillOwnerUserId("memory");
  backfillOwnerUserId("cron_jobs");
  backfillOwnerUserId("cron_executions");
  backfillOwnerUserId("agent_sessions");
  backfillOwnerUserId("sub_agents");

  // Create tenant-owner indexes after column migrations (avoid schema.sql failures on old DBs).
  if (columnExists("conversations", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner_user_id, updated_at);",
    );
  }
  if (columnExists("logs", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_logs_owner ON logs(owner_user_id, created_at);",
    );
  }
  if (columnExists("memory", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory(owner_user_id, updated_at);",
    );
  }
  if (columnExists("skills", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_skills_owner ON skills(owner_user_id, updated_at);",
    );
  }
  if (columnExists("sub_agents", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_sub_agents_owner ON sub_agents(owner_user_id, created_at);",
    );
  }
  if (columnExists("agent_sessions", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner ON agent_sessions(owner_user_id, last_active_at);",
    );
  }
  if (columnExists("cron_jobs", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_cron_jobs_owner ON cron_jobs(owner_user_id, updated_at);",
    );
  }
  if (columnExists("cron_executions", "owner_user_id")) {
    createIndexIfPossible(
      "CREATE INDEX IF NOT EXISTS idx_cron_executions_owner ON cron_executions(owner_user_id, started_at);",
    );
  }

  schemaInitialized = true;
}

// Ensure the web app always has schema available, including during build workers.
initializeSchema();

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
