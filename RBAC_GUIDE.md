# RBAC Permission System - Implementation Guide

## Overview

Overseer now includes a comprehensive Role-Based Access Control (RBAC) permission system that provides:

- **Granular Permissions**: 70+ specific permissions for all operations
- **Role-Based Access**: 4 predefined roles (admin, developer, operator, viewer)
- **Custom Permissions**: Per-user permission grants and revokes
- **Security Audit Logging**: Complete tracking of all permission checks and changes
- **Production-Ready**: Full TypeScript support with type safety

## Architecture

### Components

1. **`src/lib/permissions.ts`** - Core permission system
   - Permission enum definitions
   - Role-to-permission mappings
   - Permission checking functions
   - Audit logging

2. **`src/database/migrations/001_add_permissions.ts`** - Database migration
   - Creates permission tables
   - Populates default role permissions
   - Updates user roles

3. **`src/app/api/admin/permissions/route.ts`** - Admin API for permission management
   - View all permissions
   - Grant/revoke custom permissions
   - View user permissions

4. **`src/app/api/admin/audit/route.ts`** - Audit log API
   - View audit logs with filtering
   - Export logs as CSV
   - View statistics

## Permission Structure

### Permission Format
Permissions follow the format: `resource:action`

Examples:
- `agent:execute` - Execute agent operations
- `system:shell` - Execute shell commands
- `users:manage` - Manage user accounts

### Permission Categories

1. **Agent** - Agent execution and configuration
2. **Bot** - Bot lifecycle management
3. **Skills** - Skill installation and management
4. **System** - System-level operations
5. **MCP** - Model Context Protocol operations
6. **Sub-agent** - Sub-agent management
7. **Users** - User account management
8. **Providers** - LLM provider configuration
9. **Interfaces** - Chat interface management
10. **Conversations** - Conversation history
11. **Audit** - Security audit logs

### Roles

#### Admin
- Full access to all permissions
- Can manage users and permissions
- Can perform all system operations

#### Developer
- Execute and configure agents
- Manage skills and providers
- File system access
- Shell access
- Cannot manage users or view audit logs

#### Operator
- Start/stop bots
- Execute agents
- View status and logs
- Read-only access to configurations
- Cannot modify system settings

#### Viewer
- Read-only access
- View bot status and logs
- View configurations
- Cannot perform any modifications

## Usage Examples

### Checking Permissions

```typescript
import { hasPermission, Permission } from '@/lib/permissions';
import { getCurrentUser } from '@/lib/auth';

// In an API route or server component
const user = await getCurrentUser();

// Check single permission
if (hasPermission(user, Permission.SYSTEM_SHELL)) {
  // Allow shell access
}

// Check multiple permissions (ANY)
if (hasAnyPermission(user, [
  Permission.BOT_START,
  Permission.BOT_STOP,
  Permission.BOT_RESTART
])) {
  // Allow bot control
}

// Check multiple permissions (ALL)
if (hasAllPermissions(user, [
  Permission.PROVIDERS_VIEW,
  Permission.PROVIDERS_MANAGE_KEYS
])) {
  // Allow provider configuration
}
```

### Requiring Permissions

```typescript
import { requirePermission, Permission } from '@/lib/permissions';

// Throws PermissionError if user doesn't have permission
requirePermission(user, Permission.SKILLS_INSTALL, {
  resource: 'skill:my-skill',
  metadata: { action: 'install_skill' }
});

// If we get here, user has permission
await installSkill('my-skill');
```

### API Route Protection

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { requirePermission, Permission, PermissionError } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission - throws error if denied
    requirePermission(user, Permission.SYSTEM_SHELL, {
      resource: 'shell',
      metadata: { action: 'execute_command' }
    });
    
    // Permission granted - proceed with operation
    const { command } = await request.json();
    const result = await executeShellCommand(command);
    
    return NextResponse.json({ result });
    
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: 'Permission denied', details: error.message },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Managing Custom Permissions

```typescript
import { grantPermission, revokePermission, Permission } from '@/lib/permissions';

// Grant a custom permission to a user
grantPermission(
  userId,
  Permission.SYSTEM_SHELL,
  currentUser.id,
  'Needs shell access for deployment scripts'
);

// Revoke a permission
revokePermission(
  userId,
  Permission.SYSTEM_SHELL,
  currentUser.id,
  'No longer needs shell access'
);

// Remove custom permission (return to role defaults)
removeCustomPermission(
  userId,
  Permission.SYSTEM_SHELL,
  currentUser.id
);
```

### Viewing Audit Logs

```typescript
import { getAuditLogs, getAuditStats } from '@/lib/permissions';

// Get recent audit logs
const logs = getAuditLogs({
  limit: 100,
  result: 'denied', // Only denied attempts
  startDate: '2024-01-01T00:00:00Z'
});

// Get statistics
const stats = getAuditStats('2024-01-01T00:00:00Z');
console.log(`Total events: ${stats.totalEvents}`);
console.log(`Denied: ${stats.deniedEvents}`);
console.log(`Top actions:`, stats.topActions);
```

## API Endpoints

### Permission Management

#### GET `/api/admin/permissions`
Get all permissions and role mappings

Query Parameters:
- `userId` (optional) - Get permissions for specific user

Response:
```json
{
  "allPermissions": ["agent:execute", "..."],
  "permissionsByCategory": {
    "Agent": [...],
    "System": [...]
  },
  "rolePermissions": {
    "admin": [...],
    "developer": [...]
  }
}
```

#### POST `/api/admin/permissions/grant`
Grant custom permission to user

Body:
```json
{
  "userId": 1,
  "permission": "system:shell",
  "reason": "Needs shell access for deployments"
}
```

#### PUT `/api/admin/permissions/revoke`
Revoke custom permission from user

Body:
```json
{
  "userId": 1,
  "permission": "system:shell",
  "reason": "Security policy change"
}
```

#### DELETE `/api/admin/permissions?userId=1&permission=system:shell`
Remove custom permission entry

### Audit Logs

#### GET `/api/admin/audit`
Get audit logs with filtering

Query Parameters:
- `userId` - Filter by user ID
- `action` - Filter by action type
- `permission` - Filter by permission
- `result` - Filter by result (allowed/denied)
- `startDate` - Filter from date
- `endDate` - Filter to date
- `limit` - Max results (default: 100)
- `offset` - Pagination offset

#### GET `/api/admin/audit?stats=true`
Get audit statistics

Query Parameters:
- `startDate` - Stats from date
- `endDate` - Stats to date

#### GET `/api/admin/audit?export=true`
Export audit logs as CSV

#### POST `/api/admin/audit/cleanup`
Clean up old audit logs

Body:
```json
{
  "olderThanDays": 90
}
```

## Database Schema

### `role_permissions`
Maps permissions to roles
- `id` - Primary key
- `role` - Role name
- `permission` - Permission string
- `created_at` - Timestamp

### `user_custom_permissions`
Per-user permission grants/revokes
- `id` - Primary key
- `user_id` - Foreign key to users
- `permission` - Permission string
- `granted` - 1 = granted, 0 = revoked
- `granted_by` - User who granted/revoked
- `reason` - Optional explanation
- `created_at` - Timestamp
- `updated_at` - Timestamp

### `security_audit_log`
Security event logging
- `id` - Primary key
- `user_id` - User who performed action
- `username` - Username snapshot
- `action` - Action type
- `resource` - Resource being accessed
- `permission` - Permission being checked
- `result` - allowed/denied
- `reason` - Optional explanation
- `ip_address` - Client IP
- `user_agent` - Client user agent
- `metadata` - JSON metadata
- `created_at` - Timestamp

## Migration

The permission system is automatically set up during database initialization. To manually run the migration:

```bash
# Run migration
npm run db:migrate

# Check migration status
npm run db:migrate:status

# Rollback migration
npm run db:migrate:down
```

Or using the TypeScript file directly:
```bash
tsx src/database/migrations/001_add_permissions.ts up
tsx src/database/migrations/001_add_permissions.ts status
tsx src/database/migrations/001_add_permissions.ts down
```

## Security Best Practices

1. **Least Privilege**: Assign the minimum role needed for each user
2. **Custom Permissions**: Use sparingly for temporary elevated access
3. **Audit Regularly**: Review audit logs for suspicious activity
4. **Revoke Unused**: Remove custom permissions when no longer needed
5. **Document Changes**: Always provide reasons when granting/revoking permissions

## Permission Risk Levels

Permissions are categorized by risk level:

- **Low**: Read-only operations (viewing status, logs, configurations)
- **Medium**: Operational changes (starting/stopping bots, executing agents)
- **High**: Configuration changes (managing skills, providers, interfaces)
- **Critical**: System-level access (shell, file deletion, user management, API keys)

## Extending the System

### Adding New Permissions

1. Add to `Permission` enum in `src/lib/permissions.ts`:
```typescript
export enum Permission {
  // ... existing permissions
  MY_NEW_PERMISSION = "resource:action",
}
```

2. Add to role mappings:
```typescript
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    // ... existing permissions
    Permission.MY_NEW_PERMISSION,
  ],
  // ... other roles
};
```

3. Add metadata for UI:
```typescript
export function getPermissionMetadata(permission: Permission): PermissionMetadata {
  const metadata: Record<Permission, Omit<PermissionMetadata, "permission">> = {
    // ... existing metadata
    [Permission.MY_NEW_PERMISSION]: {
      category: "MyCategory",
      description: "Description of what this permission allows",
      riskLevel: "medium",
    },
  };
  // ...
}
```

### Adding New Roles

1. Update the `User` interface in `src/types/database.ts`
2. Add role to `ROLE_PERMISSIONS` mapping
3. Update database schema role constraint if needed
4. Run migration to update existing users

## Troubleshooting

### Migration Failed
Check the error message in the migration output. Common issues:
- Database locked (close other connections)
- Missing dependencies (run `npm install`)
- Schema conflicts (check for manual schema changes)

### Permission Denied Unexpectedly
1. Check user's role: `SELECT role FROM users WHERE id = ?`
2. Check custom permissions: `SELECT * FROM user_custom_permissions WHERE user_id = ?`
3. Review audit log: `SELECT * FROM security_audit_log WHERE user_id = ? ORDER BY created_at DESC`

### Audit Logs Growing Too Large
Use the cleanup endpoint to remove old logs:
```bash
curl -X POST http://localhost:3000/api/admin/audit/cleanup \
  -H "Content-Type: application/json" \
  -d '{"olderThanDays": 90}'
```

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { hasPermission, Permission } from '@/lib/permissions';

describe('Permission System', () => {
  it('should grant admin full access', () => {
    const admin = { id: 1, username: 'admin', role: 'admin' };
    expect(hasPermission(admin, Permission.SYSTEM_SHELL)).toBe(true);
  });

  it('should deny viewer shell access', () => {
    const viewer = { id: 2, username: 'viewer', role: 'viewer' };
    expect(hasPermission(viewer, Permission.SYSTEM_SHELL)).toBe(false);
  });
});
```

## Support

For issues or questions about the RBAC system:
1. Check the audit logs for denied permission attempts
2. Review this documentation
3. Check the implementation files for detailed comments
4. Open an issue on the project repository
