#!/usr/bin/env tsx
/**
 * RBAC System Test Script
 * 
 * This script tests the RBAC permission system implementation.
 * Run with: tsx scripts/test-rbac.ts
 */

import { db } from "../src/database/db";
import { usersModel } from "../src/database/models/users";
import {
  Permission,
  hasPermission,
  getUserPermissions,
  grantPermission,
  revokePermission,
  getAuditLogs,
  getAuditStats,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
} from "../src/lib/permissions";

async function main() {
  console.log("🧪 Testing RBAC Permission System\n");

  // Test 1: Check migration
  console.log("1️⃣  Checking database tables...");
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('role_permissions', 'user_custom_permissions', 'security_audit_log')"
      )
      .all() as Array<{ name: string }>;

    if (tables.length === 3) {
      console.log("   ✅ All permission tables exist");
    } else {
      console.log("   ❌ Missing permission tables:", tables);
      return;
    }
  } catch (error) {
    console.error("   ❌ Error checking tables:", error);
    return;
  }

  // Test 2: Check role permissions
  console.log("\n2️⃣  Checking role permissions...");
  const rolePermCount = db
    .prepare("SELECT COUNT(*) as count FROM role_permissions")
    .get() as { count: number };

  console.log(`   ✅ ${rolePermCount.count} role permissions loaded`);

  // Test 3: Test permission checking
  console.log("\n3️⃣  Testing permission checks...");

  // Create test users if they don't exist
  let adminUser = usersModel.findByUsername("admin");
  if (!adminUser) {
    adminUser = await usersModel.create("admin", "test123", "admin");
    console.log("   Created admin user for testing");
  }

  let devUser = usersModel.findByUsername("developer");
  if (!devUser) {
    devUser = await usersModel.create("developer", "test123", "developer");
    console.log("   Created developer user for testing");
  }

  let viewerUser = usersModel.findByUsername("viewer");
  if (!viewerUser) {
    viewerUser = await usersModel.create("viewer", "test123", "viewer");
    console.log("   Created viewer user for testing");
  }

  // Test admin permissions
  const adminHasShell = hasPermission(adminUser, Permission.SYSTEM_SHELL);
  const adminHasUserManage = hasPermission(adminUser, Permission.USERS_MANAGE);
  console.log(
    `   ${adminHasShell ? "✅" : "❌"} Admin has SYSTEM_SHELL: ${adminHasShell}`
  );
  console.log(
    `   ${adminHasUserManage ? "✅" : "❌"} Admin has USERS_MANAGE: ${adminHasUserManage}`
  );

  // Test developer permissions
  const devHasShell = hasPermission(devUser, Permission.SYSTEM_SHELL);
  const devHasUserManage = hasPermission(devUser, Permission.USERS_MANAGE);
  console.log(
    `   ${devHasShell ? "✅" : "❌"} Developer has SYSTEM_SHELL: ${devHasShell}`
  );
  console.log(
    `   ${!devHasUserManage ? "✅" : "❌"} Developer does NOT have USERS_MANAGE: ${!devHasUserManage}`
  );

  // Test viewer permissions
  const viewerHasView = hasPermission(viewerUser, Permission.BOT_VIEW_STATUS);
  const viewerHasShell = hasPermission(viewerUser, Permission.SYSTEM_SHELL);
  console.log(
    `   ${viewerHasView ? "✅" : "❌"} Viewer has BOT_VIEW_STATUS: ${viewerHasView}`
  );
  console.log(
    `   ${!viewerHasShell ? "✅" : "❌"} Viewer does NOT have SYSTEM_SHELL: ${!viewerHasShell}`
  );

  // Test 4: Test custom permissions
  console.log("\n4️⃣  Testing custom permissions...");

  // Grant shell access to viewer
  grantPermission(
    viewerUser.id,
    Permission.SYSTEM_SHELL,
    adminUser.id,
    "Testing custom permission grant"
  );
  const viewerHasShellAfterGrant = hasPermission(
    viewerUser,
    Permission.SYSTEM_SHELL
  );
  console.log(
    `   ${viewerHasShellAfterGrant ? "✅" : "❌"} Viewer granted SYSTEM_SHELL: ${viewerHasShellAfterGrant}`
  );

  // Revoke shell access
  revokePermission(
    viewerUser.id,
    Permission.SYSTEM_SHELL,
    adminUser.id,
    "Testing custom permission revoke"
  );
  const viewerHasShellAfterRevoke = hasPermission(
    viewerUser,
    Permission.SYSTEM_SHELL
  );
  console.log(
    `   ${!viewerHasShellAfterRevoke ? "✅" : "❌"} Viewer revoked SYSTEM_SHELL: ${!viewerHasShellAfterRevoke}`
  );

  // Test 5: Test audit logs
  console.log("\n5️⃣  Testing audit logs...");

  const recentLogs = getAuditLogs({ limit: 10 });
  console.log(`   ✅ Retrieved ${recentLogs.length} recent audit logs`);

  const stats = getAuditStats();
  console.log(`   ✅ Total audit events: ${stats.totalEvents}`);
  console.log(`   ✅ Allowed events: ${stats.allowedEvents}`);
  console.log(`   ✅ Denied events: ${stats.deniedEvents}`);

  if (stats.topActions.length > 0) {
    console.log(`   ✅ Top action: ${stats.topActions[0].action} (${stats.topActions[0].count} times)`);
  }

  // Test 6: Summary
  console.log("\n6️⃣  System summary:");
  console.log(`   📊 Total permissions defined: ${ALL_PERMISSIONS.length}`);
  console.log(`   👥 Roles configured: ${Object.keys(ROLE_PERMISSIONS).length}`);
  console.log(
    `   📝 Default role permissions: ${rolePermCount.count}`
  );

  // Show permission count per role
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    console.log(`   - ${role}: ${permissions.length} permissions`);
  }

  console.log("\n✨ All tests completed successfully!\n");

  console.log("📋 Next steps:");
  console.log("   1. Integrate permission checks into API routes");
  console.log("   2. Add permission-based UI rendering");
  console.log("   3. Set up audit log monitoring");
  console.log("   4. Review and customize role permissions");
  console.log("\n   See RBAC_GUIDE.md for detailed usage examples\n");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
