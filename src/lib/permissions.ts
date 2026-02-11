/**
 * Role-Based Access Control (RBAC) Permission System
 * 
 * This module provides a comprehensive permission system with:
 * - Granular permissions for all Overseer operations
 * - Role-based permission mapping
 * - Per-user custom permission grants/revokes
 * - Permission checking with audit logging
 */

import { db } from "../database/db";
import type { User } from "../types/database";

/**
 * System-wide permission definitions
 * Format: resource:action
 */
export enum Permission {
  // Agent permissions
  AGENT_EXECUTE = "agent:execute",
  AGENT_VIEW = "agent:view",
  AGENT_CONFIGURE = "agent:configure",
  AGENT_STOP = "agent:stop",

  // Bot management permissions
  BOT_START = "bot:start",
  BOT_STOP = "bot:stop",
  BOT_RESTART = "bot:restart",
  BOT_VIEW_STATUS = "bot:view_status",
  BOT_VIEW_LOGS = "bot:view_logs",

  // Skills permissions
  SKILLS_INSTALL = "skills:install",
  SKILLS_UNINSTALL = "skills:uninstall",
  SKILLS_ACTIVATE = "skills:activate",
  SKILLS_DEACTIVATE = "skills:deactivate",
  SKILLS_CONFIGURE = "skills:configure",
  SKILLS_VIEW = "skills:view",

  // System permissions
  SYSTEM_SHELL = "system:shell",
  SYSTEM_FILES_READ = "system:files:read",
  SYSTEM_FILES_WRITE = "system:files:write",
  SYSTEM_FILES_DELETE = "system:files:delete",
  SYSTEM_SETTINGS_READ = "system:settings:read",
  SYSTEM_SETTINGS_WRITE = "system:settings:write",

  // MCP (Model Context Protocol) permissions
  MCP_CONNECT = "mcp:connect",
  MCP_DISCONNECT = "mcp:disconnect",
  MCP_MANAGE = "mcp:manage",
  MCP_VIEW = "mcp:view",

  // Sub-agent permissions
  SUBAGENT_CREATE = "subagent:create",
  SUBAGENT_DELEGATE = "subagent:delegate",
  SUBAGENT_MANAGE = "subagent:manage",
  SUBAGENT_VIEW = "subagent:view",

  // User management permissions
  USERS_CREATE = "users:create",
  USERS_DELETE = "users:delete",
  USERS_MANAGE = "users:manage",
  USERS_VIEW = "users:view",
  USERS_MANAGE_PERMISSIONS = "users:manage_permissions",

  // Provider permissions
  PROVIDERS_CREATE = "providers:create",
  PROVIDERS_UPDATE = "providers:update",
  PROVIDERS_DELETE = "providers:delete",
  PROVIDERS_VIEW = "providers:view",
  PROVIDERS_MANAGE_KEYS = "providers:manage_keys",

  // Interface permissions
  INTERFACES_CREATE = "interfaces:create",
  INTERFACES_UPDATE = "interfaces:update",
  INTERFACES_DELETE = "interfaces:delete",
  INTERFACES_VIEW = "interfaces:view",

  // Conversation permissions
  CONVERSATIONS_VIEW = "conversations:view",
  CONVERSATIONS_DELETE = "conversations:delete",
  CONVERSATIONS_EXPORT = "conversations:export",

  // Audit log permissions
  AUDIT_VIEW = "audit:view",
  AUDIT_EXPORT = "audit:export",
}

/**
 * Role definitions with their default permissions
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    // Admins have full access to everything
    ...Object.values(Permission),
  ],
  
  developer: [
    // Developers can execute, configure, and manage most things
    Permission.AGENT_EXECUTE,
    Permission.AGENT_VIEW,
    Permission.AGENT_CONFIGURE,
    Permission.AGENT_STOP,
    Permission.BOT_START,
    Permission.BOT_STOP,
    Permission.BOT_RESTART,
    Permission.BOT_VIEW_STATUS,
    Permission.BOT_VIEW_LOGS,
    Permission.SKILLS_INSTALL,
    Permission.SKILLS_UNINSTALL,
    Permission.SKILLS_ACTIVATE,
    Permission.SKILLS_DEACTIVATE,
    Permission.SKILLS_CONFIGURE,
    Permission.SKILLS_VIEW,
    Permission.SYSTEM_SHELL,
    Permission.SYSTEM_FILES_READ,
    Permission.SYSTEM_FILES_WRITE,
    Permission.SYSTEM_FILES_DELETE,
    Permission.SYSTEM_SETTINGS_READ,
    Permission.MCP_CONNECT,
    Permission.MCP_DISCONNECT,
    Permission.MCP_VIEW,
    Permission.SUBAGENT_CREATE,
    Permission.SUBAGENT_DELEGATE,
    Permission.SUBAGENT_MANAGE,
    Permission.SUBAGENT_VIEW,
    Permission.PROVIDERS_VIEW,
    Permission.INTERFACES_VIEW,
    Permission.CONVERSATIONS_VIEW,
    Permission.CONVERSATIONS_EXPORT,
  ],
  
  operator: [
    // Operators can start/stop bots and view status
    Permission.AGENT_EXECUTE,
    Permission.AGENT_VIEW,
    Permission.AGENT_STOP,
    Permission.BOT_START,
    Permission.BOT_STOP,
    Permission.BOT_RESTART,
    Permission.BOT_VIEW_STATUS,
    Permission.BOT_VIEW_LOGS,
    Permission.SKILLS_VIEW,
    Permission.SYSTEM_FILES_READ,
    Permission.SYSTEM_SETTINGS_READ,
    Permission.MCP_VIEW,
    Permission.SUBAGENT_VIEW,
    Permission.PROVIDERS_VIEW,
    Permission.INTERFACES_VIEW,
    Permission.CONVERSATIONS_VIEW,
  ],
  
  viewer: [
    // Viewers can only view, no modifications
    Permission.AGENT_VIEW,
    Permission.BOT_VIEW_STATUS,
    Permission.BOT_VIEW_LOGS,
    Permission.SKILLS_VIEW,
    Permission.SYSTEM_SETTINGS_READ,
    Permission.MCP_VIEW,
    Permission.SUBAGENT_VIEW,
    Permission.PROVIDERS_VIEW,
    Permission.INTERFACES_VIEW,
    Permission.CONVERSATIONS_VIEW,
  ],
};

/**
 * Database interfaces for permission tables
 */
export interface RolePermission {
  id: number;
  role: string;
  permission: string;
  created_at: string;
}

export interface UserCustomPermission {
  id: number;
  user_id: number;
  permission: string;
  granted: number; // 1 = granted, 0 = revoked
  granted_by: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecurityAuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  resource: string | null;
  permission: string | null;
  result: "allowed" | "denied";
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Get all permissions for a role from the database (or defaults)
 */
function getRolePermissions(role: string): Permission[] {
  // First check if we have custom role permissions in the database
  const customPermissions = db
    .prepare("SELECT permission FROM role_permissions WHERE role = ?")
    .all(role) as Pick<RolePermission, "permission">[];

  if (customPermissions.length > 0) {
    return customPermissions.map((p) => p.permission as Permission);
  }

  // Fall back to default role permissions
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Get custom permissions for a user
 */
function getUserCustomPermissions(
  userId: number
): { granted: Permission[]; revoked: Permission[] } {
  const customPermissions = db
    .prepare(
      "SELECT permission, granted FROM user_custom_permissions WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(userId) as Pick<UserCustomPermission, "permission" | "granted">[];

  const granted: Permission[] = [];
  const revoked: Permission[] = [];

  // Group by permission and use the most recent entry
  const permissionMap = new Map<string, number>();
  
  for (const perm of customPermissions) {
    if (!permissionMap.has(perm.permission)) {
      permissionMap.set(perm.permission, perm.granted);
    }
  }

  for (const [permission, isGranted] of permissionMap.entries()) {
    if (isGranted === 1) {
      granted.push(permission as Permission);
    } else {
      revoked.push(permission as Permission);
    }
  }

  return { granted, revoked };
}

/**
 * Get all effective permissions for a user
 */
export function getUserPermissions(user: User | Omit<User, "password_hash">): Permission[] {
  // Get base role permissions
  const rolePermissions = getRolePermissions(user.role);

  // Get custom permissions
  const customPermissions = getUserCustomPermissions(user.id);

  // Combine: start with role permissions, add grants, remove revokes
  const permissionSet = new Set(rolePermissions);

  // Add granted permissions
  for (const perm of customPermissions.granted) {
    permissionSet.add(perm);
  }

  // Remove revoked permissions
  for (const perm of customPermissions.revoked) {
    permissionSet.delete(perm);
  }

  return Array.from(permissionSet);
}

/**
 * Check if a user has a specific permission
 */
export function hasPermission(
  user: User | Omit<User, "password_hash"> | null,
  permission: Permission
): boolean {
  if (!user) {
    return false;
  }

  const userPermissions = getUserPermissions(user);
  return userPermissions.includes(permission);
}

/**
 * Check if a user has ANY of the specified permissions
 */
export function hasAnyPermission(
  user: User | Omit<User, "password_hash"> | null,
  permissions: Permission[]
): boolean {
  if (!user) {
    return false;
  }

  const userPermissions = getUserPermissions(user);
  return permissions.some((perm) => userPermissions.includes(perm));
}

/**
 * Check if a user has ALL of the specified permissions
 */
export function hasAllPermissions(
  user: User | Omit<User, "password_hash"> | null,
  permissions: Permission[]
): boolean {
  if (!user) {
    return false;
  }

  const userPermissions = getUserPermissions(user);
  return permissions.every((perm) => userPermissions.includes(perm));
}

/**
 * Require a specific permission or throw an error
 */
export function requirePermission(
  user: User | Omit<User, "password_hash"> | null,
  permission: Permission,
  context?: { resource?: string; metadata?: Record<string, any> }
): void {
  const hasAccess = hasPermission(user, permission);

  // Log the permission check
  logSecurityEvent({
    userId: user?.id || null,
    username: user?.username || null,
    action: "permission_check",
    resource: context?.resource || null,
    permission,
    result: hasAccess ? "allowed" : "denied",
    reason: hasAccess ? null : "Permission denied",
    metadata: context?.metadata ? JSON.stringify(context.metadata) : null,
  });

  if (!hasAccess) {
    throw new PermissionError(
      `Permission denied: ${permission}`,
      permission,
      user?.username || "anonymous"
    );
  }
}

/**
 * Grant a custom permission to a user
 */
export function grantPermission(
  userId: number,
  permission: Permission,
  grantedBy: number,
  reason?: string
): void {
  // Check if permission already exists
  const existing = db
    .prepare(
      "SELECT id FROM user_custom_permissions WHERE user_id = ? AND permission = ?"
    )
    .get(userId, permission) as { id: number } | undefined;

  if (existing) {
    // Update existing
    db.prepare(
      `UPDATE user_custom_permissions 
       SET granted = 1, granted_by = ?, reason = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`
    ).run(grantedBy, reason || null, existing.id);
  } else {
    // Insert new
    db.prepare(
      `INSERT INTO user_custom_permissions (user_id, permission, granted, granted_by, reason) 
       VALUES (?, ?, 1, ?, ?)`
    ).run(userId, permission, grantedBy, reason || null);
  }

  // Log the grant
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as
    | { username: string }
    | undefined;
  const granter = db.prepare("SELECT username FROM users WHERE id = ?").get(grantedBy) as
    | { username: string }
    | undefined;

  logSecurityEvent({
    userId: grantedBy,
    username: granter?.username || null,
    action: "grant_permission",
    resource: `user:${userId}`,
    permission,
    result: "allowed",
    reason,
    metadata: JSON.stringify({
      targetUser: user?.username,
      targetUserId: userId,
    }),
  });
}

/**
 * Revoke a custom permission from a user
 */
export function revokePermission(
  userId: number,
  permission: Permission,
  revokedBy: number,
  reason?: string
): void {
  // Check if permission already exists
  const existing = db
    .prepare(
      "SELECT id FROM user_custom_permissions WHERE user_id = ? AND permission = ?"
    )
    .get(userId, permission) as { id: number } | undefined;

  if (existing) {
    // Update existing to revoked
    db.prepare(
      `UPDATE user_custom_permissions 
       SET granted = 0, granted_by = ?, reason = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`
    ).run(revokedBy, reason || null, existing.id);
  } else {
    // Insert new revocation
    db.prepare(
      `INSERT INTO user_custom_permissions (user_id, permission, granted, granted_by, reason) 
       VALUES (?, ?, 0, ?, ?)`
    ).run(userId, permission, revokedBy, reason || null);
  }

  // Log the revocation
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as
    | { username: string }
    | undefined;
  const revoker = db.prepare("SELECT username FROM users WHERE id = ?").get(revokedBy) as
    | { username: string }
    | undefined;

  logSecurityEvent({
    userId: revokedBy,
    username: revoker?.username || null,
    action: "revoke_permission",
    resource: `user:${userId}`,
    permission,
    result: "allowed",
    reason,
    metadata: JSON.stringify({
      targetUser: user?.username,
      targetUserId: userId,
    }),
  });
}

/**
 * Remove a custom permission entry (return to role defaults)
 */
export function removeCustomPermission(
  userId: number,
  permission: Permission,
  removedBy: number
): void {
  db.prepare(
    "DELETE FROM user_custom_permissions WHERE user_id = ? AND permission = ?"
  ).run(userId, permission);

  // Log the removal
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as
    | { username: string }
    | undefined;
  const remover = db.prepare("SELECT username FROM users WHERE id = ?").get(removedBy) as
    | { username: string }
    | undefined;

  logSecurityEvent({
    userId: removedBy,
    username: remover?.username || null,
    action: "remove_custom_permission",
    resource: `user:${userId}`,
    permission,
    result: "allowed",
    reason: "Returned to role defaults",
    metadata: JSON.stringify({
      targetUser: user?.username,
      targetUserId: userId,
    }),
  });
}

/**
 * Security audit logging
 */
export interface SecurityEventData {
  userId: number | null;
  username: string | null;
  action: string;
  resource: string | null;
  permission: Permission | string | null;
  result: "allowed" | "denied";
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: string | null;
}

export function logSecurityEvent(event: SecurityEventData): void {
  try {
    db.prepare(
      `INSERT INTO security_audit_log 
       (user_id, username, action, resource, permission, result, reason, ip_address, user_agent, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.userId,
      event.username,
      event.action,
      event.resource,
      event.permission,
      event.result,
      event.reason || null,
      event.ipAddress || null,
      event.userAgent || null,
      event.metadata || null
    );
  } catch (error) {
    // Don't throw errors from audit logging - just log to console
    console.error("Failed to log security event:", error);
  }
}

/**
 * Get security audit logs with filtering
 */
export interface AuditLogFilter {
  userId?: number;
  action?: string;
  permission?: string;
  result?: "allowed" | "denied";
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export function getAuditLogs(filter: AuditLogFilter = {}): SecurityAuditLog[] {
  let query = "SELECT * FROM security_audit_log WHERE 1=1";
  const params: any[] = [];

  if (filter.userId) {
    query += " AND user_id = ?";
    params.push(filter.userId);
  }

  if (filter.action) {
    query += " AND action = ?";
    params.push(filter.action);
  }

  if (filter.permission) {
    query += " AND permission = ?";
    params.push(filter.permission);
  }

  if (filter.result) {
    query += " AND result = ?";
    params.push(filter.result);
  }

  if (filter.startDate) {
    query += " AND created_at >= ?";
    params.push(filter.startDate);
  }

  if (filter.endDate) {
    query += " AND created_at <= ?";
    params.push(filter.endDate);
  }

  query += " ORDER BY created_at DESC";

  if (filter.limit) {
    query += " LIMIT ?";
    params.push(filter.limit);
  }

  if (filter.offset) {
    query += " OFFSET ?";
    params.push(filter.offset);
  }

  return db.prepare(query).all(...params) as SecurityAuditLog[];
}

/**
 * Get audit log statistics
 */
export interface AuditStats {
  totalEvents: number;
  allowedEvents: number;
  deniedEvents: number;
  uniqueUsers: number;
  topActions: Array<{ action: string; count: number }>;
  topDeniedPermissions: Array<{ permission: string; count: number }>;
}

export function getAuditStats(startDate?: string, endDate?: string): AuditStats {
  let dateFilter = "";
  const params: string[] = [];

  if (startDate) {
    dateFilter += " AND created_at >= ?";
    params.push(startDate);
  }

  if (endDate) {
    dateFilter += " AND created_at <= ?";
    params.push(endDate);
  }

  const totalEvents = db
    .prepare(`SELECT COUNT(*) as count FROM security_audit_log WHERE 1=1${dateFilter}`)
    .get(...params) as { count: number };

  const allowedEvents = db
    .prepare(
      `SELECT COUNT(*) as count FROM security_audit_log WHERE result = 'allowed'${dateFilter}`
    )
    .get(...params) as { count: number };

  const deniedEvents = db
    .prepare(
      `SELECT COUNT(*) as count FROM security_audit_log WHERE result = 'denied'${dateFilter}`
    )
    .get(...params) as { count: number };

  const uniqueUsers = db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM security_audit_log WHERE user_id IS NOT NULL${dateFilter}`
    )
    .get(...params) as { count: number };

  const topActions = db
    .prepare(
      `SELECT action, COUNT(*) as count FROM security_audit_log WHERE 1=1${dateFilter} GROUP BY action ORDER BY count DESC LIMIT 10`
    )
    .all(...params) as Array<{ action: string; count: number }>;

  const topDeniedPermissions = db
    .prepare(
      `SELECT permission, COUNT(*) as count FROM security_audit_log WHERE result = 'denied' AND permission IS NOT NULL${dateFilter} GROUP BY permission ORDER BY count DESC LIMIT 10`
    )
    .all(...params) as Array<{ permission: string; count: number }>;

  return {
    totalEvents: totalEvents.count,
    allowedEvents: allowedEvents.count,
    deniedEvents: deniedEvents.count,
    uniqueUsers: uniqueUsers.count,
    topActions,
    topDeniedPermissions,
  };
}

/**
 * Custom error class for permission denials
 */
export class PermissionError extends Error {
  constructor(
    message: string,
    public permission: Permission | string,
    public username: string
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

/**
 * Export all available permissions as an array (for UI/API)
 */
export const ALL_PERMISSIONS = Object.values(Permission);

/**
 * Get permission metadata (for UI display)
 */
export interface PermissionMetadata {
  permission: Permission;
  category: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export function getPermissionMetadata(permission: Permission): PermissionMetadata {
  const metadata: Record<Permission, Omit<PermissionMetadata, "permission">> = {
    [Permission.AGENT_EXECUTE]: {
      category: "Agent",
      description: "Execute agent operations",
      riskLevel: "medium",
    },
    [Permission.AGENT_VIEW]: {
      category: "Agent",
      description: "View agent status and operations",
      riskLevel: "low",
    },
    [Permission.AGENT_CONFIGURE]: {
      category: "Agent",
      description: "Configure agent settings",
      riskLevel: "high",
    },
    [Permission.AGENT_STOP]: {
      category: "Agent",
      description: "Stop running agent operations",
      riskLevel: "medium",
    },
    [Permission.BOT_START]: {
      category: "Bot",
      description: "Start bot instances",
      riskLevel: "medium",
    },
    [Permission.BOT_STOP]: {
      category: "Bot",
      description: "Stop bot instances",
      riskLevel: "medium",
    },
    [Permission.BOT_RESTART]: {
      category: "Bot",
      description: "Restart bot instances",
      riskLevel: "medium",
    },
    [Permission.BOT_VIEW_STATUS]: {
      category: "Bot",
      description: "View bot status",
      riskLevel: "low",
    },
    [Permission.BOT_VIEW_LOGS]: {
      category: "Bot",
      description: "View bot logs",
      riskLevel: "low",
    },
    [Permission.SKILLS_INSTALL]: {
      category: "Skills",
      description: "Install new skills",
      riskLevel: "high",
    },
    [Permission.SKILLS_UNINSTALL]: {
      category: "Skills",
      description: "Uninstall skills",
      riskLevel: "high",
    },
    [Permission.SKILLS_ACTIVATE]: {
      category: "Skills",
      description: "Activate skills",
      riskLevel: "medium",
    },
    [Permission.SKILLS_DEACTIVATE]: {
      category: "Skills",
      description: "Deactivate skills",
      riskLevel: "medium",
    },
    [Permission.SKILLS_CONFIGURE]: {
      category: "Skills",
      description: "Configure skill settings",
      riskLevel: "medium",
    },
    [Permission.SKILLS_VIEW]: {
      category: "Skills",
      description: "View installed skills",
      riskLevel: "low",
    },
    [Permission.SYSTEM_SHELL]: {
      category: "System",
      description: "Execute shell commands",
      riskLevel: "critical",
    },
    [Permission.SYSTEM_FILES_READ]: {
      category: "System",
      description: "Read system files",
      riskLevel: "medium",
    },
    [Permission.SYSTEM_FILES_WRITE]: {
      category: "System",
      description: "Write system files",
      riskLevel: "high",
    },
    [Permission.SYSTEM_FILES_DELETE]: {
      category: "System",
      description: "Delete system files",
      riskLevel: "critical",
    },
    [Permission.SYSTEM_SETTINGS_READ]: {
      category: "System",
      description: "Read system settings",
      riskLevel: "low",
    },
    [Permission.SYSTEM_SETTINGS_WRITE]: {
      category: "System",
      description: "Modify system settings",
      riskLevel: "high",
    },
    [Permission.MCP_CONNECT]: {
      category: "MCP",
      description: "Connect to MCP servers",
      riskLevel: "medium",
    },
    [Permission.MCP_DISCONNECT]: {
      category: "MCP",
      description: "Disconnect from MCP servers",
      riskLevel: "medium",
    },
    [Permission.MCP_MANAGE]: {
      category: "MCP",
      description: "Manage MCP configurations",
      riskLevel: "high",
    },
    [Permission.MCP_VIEW]: {
      category: "MCP",
      description: "View MCP status",
      riskLevel: "low",
    },
    [Permission.SUBAGENT_CREATE]: {
      category: "Sub-agent",
      description: "Create sub-agents",
      riskLevel: "high",
    },
    [Permission.SUBAGENT_DELEGATE]: {
      category: "Sub-agent",
      description: "Delegate tasks to sub-agents",
      riskLevel: "medium",
    },
    [Permission.SUBAGENT_MANAGE]: {
      category: "Sub-agent",
      description: "Manage sub-agents",
      riskLevel: "high",
    },
    [Permission.SUBAGENT_VIEW]: {
      category: "Sub-agent",
      description: "View sub-agent status",
      riskLevel: "low",
    },
    [Permission.USERS_CREATE]: {
      category: "Users",
      description: "Create new users",
      riskLevel: "high",
    },
    [Permission.USERS_DELETE]: {
      category: "Users",
      description: "Delete users",
      riskLevel: "critical",
    },
    [Permission.USERS_MANAGE]: {
      category: "Users",
      description: "Manage user accounts",
      riskLevel: "high",
    },
    [Permission.USERS_VIEW]: {
      category: "Users",
      description: "View user accounts",
      riskLevel: "low",
    },
    [Permission.USERS_MANAGE_PERMISSIONS]: {
      category: "Users",
      description: "Manage user permissions",
      riskLevel: "critical",
    },
    [Permission.PROVIDERS_CREATE]: {
      category: "Providers",
      description: "Create LLM providers",
      riskLevel: "high",
    },
    [Permission.PROVIDERS_UPDATE]: {
      category: "Providers",
      description: "Update provider settings",
      riskLevel: "high",
    },
    [Permission.PROVIDERS_DELETE]: {
      category: "Providers",
      description: "Delete providers",
      riskLevel: "high",
    },
    [Permission.PROVIDERS_VIEW]: {
      category: "Providers",
      description: "View provider configurations",
      riskLevel: "low",
    },
    [Permission.PROVIDERS_MANAGE_KEYS]: {
      category: "Providers",
      description: "Manage provider API keys",
      riskLevel: "critical",
    },
    [Permission.INTERFACES_CREATE]: {
      category: "Interfaces",
      description: "Create chat interfaces",
      riskLevel: "high",
    },
    [Permission.INTERFACES_UPDATE]: {
      category: "Interfaces",
      description: "Update interface settings",
      riskLevel: "high",
    },
    [Permission.INTERFACES_DELETE]: {
      category: "Interfaces",
      description: "Delete interfaces",
      riskLevel: "high",
    },
    [Permission.INTERFACES_VIEW]: {
      category: "Interfaces",
      description: "View interface configurations",
      riskLevel: "low",
    },
    [Permission.CONVERSATIONS_VIEW]: {
      category: "Conversations",
      description: "View conversation history",
      riskLevel: "low",
    },
    [Permission.CONVERSATIONS_DELETE]: {
      category: "Conversations",
      description: "Delete conversations",
      riskLevel: "high",
    },
    [Permission.CONVERSATIONS_EXPORT]: {
      category: "Conversations",
      description: "Export conversation data",
      riskLevel: "medium",
    },
    [Permission.AUDIT_VIEW]: {
      category: "Audit",
      description: "View security audit logs",
      riskLevel: "low",
    },
    [Permission.AUDIT_EXPORT]: {
      category: "Audit",
      description: "Export audit logs",
      riskLevel: "medium",
    },
  };

  return {
    permission,
    ...metadata[permission],
  };
}

/**
 * Get all permissions grouped by category
 */
export function getPermissionsByCategory(): Record<string, PermissionMetadata[]> {
  const categories: Record<string, PermissionMetadata[]> = {};

  for (const permission of ALL_PERMISSIONS) {
    const metadata = getPermissionMetadata(permission);
    if (!categories[metadata.category]) {
      categories[metadata.category] = [];
    }
    categories[metadata.category].push(metadata);
  }

  return categories;
}
