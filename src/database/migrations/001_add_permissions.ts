/**
 * Database Migration: Add RBAC Permission System
 * 
 * This migration adds three new tables:
 * 1. role_permissions - Maps permissions to roles
 * 2. user_custom_permissions - Per-user permission grants/revokes
 * 3. security_audit_log - Security event and permission check logging
 */

import { db } from "../db";
import { Permission, ROLE_PERMISSIONS } from "../../lib/permissions";

export interface MigrationResult {
  success: boolean;
  error?: string;
  changes: string[];
}

/**
 * Run the migration (upgrade)
 */
export function up(): MigrationResult {
  const changes: string[] = [];

  try {
    // Start transaction
    db.exec("BEGIN TRANSACTION");

    // 1. Create role_permissions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        permission TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(role, permission)
      )
    `);
    changes.push("Created role_permissions table");

    // Create index for faster role lookups
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_role_permissions_role 
      ON role_permissions(role)
    `);
    changes.push("Created index on role_permissions(role)");

    // 2. Create user_custom_permissions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_custom_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        permission TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 1,  -- 1 = granted, 0 = revoked
        granted_by INTEGER,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(user_id, permission)
      )
    `);
    changes.push("Created user_custom_permissions table");

    // Create index for faster user lookups
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_custom_permissions_user 
      ON user_custom_permissions(user_id)
    `);
    changes.push("Created index on user_custom_permissions(user_id)");

    // 3. Create security_audit_log table
    db.exec(`
      CREATE TABLE IF NOT EXISTS security_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        permission TEXT,
        result TEXT NOT NULL CHECK (result IN ('allowed', 'denied')),
        reason TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata TEXT,  -- JSON metadata
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    changes.push("Created security_audit_log table");

    // Create indexes for audit log queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_security_audit_log_user 
      ON security_audit_log(user_id, created_at)
    `);
    changes.push("Created index on security_audit_log(user_id, created_at)");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_security_audit_log_action 
      ON security_audit_log(action, created_at)
    `);
    changes.push("Created index on security_audit_log(action, created_at)");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_security_audit_log_result 
      ON security_audit_log(result, created_at)
    `);
    changes.push("Created index on security_audit_log(result, created_at)");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_security_audit_log_created 
      ON security_audit_log(created_at DESC)
    `);
    changes.push("Created index on security_audit_log(created_at)");

    // 4. Update users table to support new roles
    // First, check if we need to update the role constraint
    const tableInfo = db.pragma("table_info(users)") as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: any;
      pk: number;
    }>;
    const roleColumn = tableInfo.find((col) => col.name === "role");
    
    if (roleColumn) {
      // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
      // But first, let's check if the role column already has the right constraint
      const existingRoles = db
        .prepare("SELECT DISTINCT role FROM users")
        .all() as Array<{ role: string }>;
      
      const hasOldRoles = existingRoles.some(
        (r) => !["admin", "developer", "operator", "viewer"].includes(r.role)
      );

      if (hasOldRoles || roleColumn.type.includes("CHECK")) {
        // Need to update the table schema
        db.exec(`
          -- Create temporary table with new schema
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'viewer' CHECK (role IN ('admin', 'developer', 'operator', 'viewer')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login_at DATETIME
          );

          -- Copy data, mapping old roles to new ones
          INSERT INTO users_new (id, username, password_hash, role, created_at, updated_at, last_login_at)
          SELECT 
            id, 
            username, 
            password_hash, 
            CASE 
              WHEN role = 'user' THEN 'operator'
              WHEN role IN ('admin', 'developer', 'operator', 'viewer') THEN role
              ELSE 'viewer'
            END,
            created_at,
            updated_at,
            last_login_at
          FROM users;

          -- Drop old table
          DROP TABLE users;

          -- Rename new table
          ALTER TABLE users_new RENAME TO users;
        `);
        changes.push("Updated users table with new role types (admin, developer, operator, viewer)");
        changes.push("Migrated existing 'user' role to 'operator' role");
      }
    }

    // 5. Populate role_permissions with default permissions
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)"
    );

    let totalPermissions = 0;
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        stmt.run(role, permission);
        totalPermissions++;
      }
    }
    changes.push(`Populated ${totalPermissions} default role permissions`);

    // 6. Add migration tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    changes.push("Created migrations tracking table");

    db.prepare("INSERT OR IGNORE INTO migrations (name) VALUES (?)").run(
      "001_add_permissions"
    );
    changes.push("Recorded migration in tracking table");

    // Commit transaction
    db.exec("COMMIT");

    return {
      success: true,
      changes,
    };
  } catch (error) {
    // Rollback on error
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to rollback migration:", rollbackError);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      changes,
    };
  }
}

/**
 * Rollback the migration (downgrade)
 */
export function down(): MigrationResult {
  const changes: string[] = [];

  try {
    // Start transaction
    db.exec("BEGIN TRANSACTION");

    // Drop tables in reverse order
    db.exec("DROP TABLE IF EXISTS security_audit_log");
    changes.push("Dropped security_audit_log table");

    db.exec("DROP TABLE IF EXISTS user_custom_permissions");
    changes.push("Dropped user_custom_permissions table");

    db.exec("DROP TABLE IF EXISTS role_permissions");
    changes.push("Dropped role_permissions table");

    // Revert users table (optional - depends on if you want to go back to old roles)
    // For now, we'll leave the users table as-is since reverting would be destructive

    // Remove migration record
    db.prepare("DELETE FROM migrations WHERE name = ?").run("001_add_permissions");
    changes.push("Removed migration record");

    // Commit transaction
    db.exec("COMMIT");

    return {
      success: true,
      changes,
    };
  } catch (error) {
    // Rollback on error
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      console.error("Failed to rollback migration:", rollbackError);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      changes,
    };
  }
}

/**
 * Check if migration has been applied
 */
export function isApplied(): boolean {
  try {
    const result = db
      .prepare(
        "SELECT COUNT(*) as count FROM migrations WHERE name = '001_add_permissions'"
      )
      .get() as { count: number } | undefined;

    return (result?.count || 0) > 0;
  } catch (error) {
    // If migrations table doesn't exist, migration hasn't been applied
    return false;
  }
}

/**
 * Run migration if not already applied
 */
export function runIfNeeded(): MigrationResult {
  if (isApplied()) {
    return {
      success: true,
      changes: ["Migration already applied, skipping"],
    };
  }

  console.log("🔄 Running migration: 001_add_permissions");
  const result = up();

  if (result.success) {
    console.log("✅ Migration completed successfully");
    for (const change of result.changes) {
      console.log(`   - ${change}`);
    }
  } else {
    console.error("❌ Migration failed:", result.error);
  }

  return result;
}

/**
 * CLI interface for running migrations
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case "up":
      console.log("Running migration...");
      const upResult = up();
      console.log(upResult);
      process.exit(upResult.success ? 0 : 1);

    case "down":
      console.log("Rolling back migration...");
      const downResult = down();
      console.log(downResult);
      process.exit(downResult.success ? 0 : 1);

    case "status":
      console.log("Migration status:", isApplied() ? "APPLIED" : "NOT APPLIED");
      process.exit(0);

    default:
      console.log("Usage: node 001_add_permissions.js [up|down|status]");
      process.exit(1);
  }
}
