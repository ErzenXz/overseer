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
  const defaultPath = join(process.cwd(), "data", "mybot.db");
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

// Initialize schema
function initializeSchema() {
  const schemaPath = join(__dirname, "schema.sql");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    db.exec(schema);
    console.log("Database schema initialized");
    console.log(`Database location: ${DB_PATH}`);
  }
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
