/**
 * Admin API: User Permission Management
 * 
 * Endpoints:
 * - GET /api/admin/permissions - Get all permissions and role mappings
 * - GET /api/admin/permissions/user/:userId - Get user's effective permissions
 * - POST /api/admin/permissions/grant - Grant custom permission to user
 * - POST /api/admin/permissions/revoke - Revoke custom permission from user
 * - DELETE /api/admin/permissions/user/:userId/:permission - Remove custom permission
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  Permission,
  hasPermission,
  requirePermission,
  getUserPermissions,
  grantPermission,
  revokePermission,
  removeCustomPermission,
  getPermissionsByCategory,
  getPermissionMetadata,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  PermissionError,
} from "@/lib/permissions";
import { usersModel } from "@/database";
import { db } from "@/database/db";
import type { User } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/permissions
 * Get all permissions, role mappings, and permission metadata
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to view users
    requirePermission(user, Permission.USERS_VIEW, {
      resource: "permissions",
      metadata: { action: "list_permissions" },
    });

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");

    // If userId is provided, get that user's permissions
    if (userId) {
      const targetUser = usersModel.findById(parseInt(userId));
      if (!targetUser) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }

      const userPermissions = getUserPermissions(targetUser);
      
      // Get custom permissions
      const customPermissions = db
        .prepare(
          `SELECT permission, granted, granted_by, reason, created_at, updated_at 
           FROM user_custom_permissions 
           WHERE user_id = ? 
           ORDER BY updated_at DESC`
        )
        .all(parseInt(userId)) as Array<{
          permission: string;
          granted: number;
          granted_by: number | null;
          reason: string | null;
          created_at: string;
          updated_at: string;
        }>;

      // Get the users who granted/revoked permissions
      const customPermissionsWithGranter = customPermissions.map((cp) => {
        const granter = cp.granted_by
          ? usersModel.findById(cp.granted_by)
          : null;
        return {
          ...cp,
          granted: cp.granted === 1,
          grantedBy: granter
            ? { id: granter.id, username: granter.username }
            : null,
        };
      });

      return NextResponse.json({
        user: {
          id: targetUser.id,
          username: targetUser.username,
          role: targetUser.role,
        },
        permissions: userPermissions,
        customPermissions: customPermissionsWithGranter,
      });
    }

    // Otherwise, return all permissions metadata
    const permissionsByCategory = getPermissionsByCategory();
    
    return NextResponse.json({
      allPermissions: ALL_PERMISSIONS,
      permissionsByCategory,
      rolePermissions: ROLE_PERMISSIONS,
      roles: Object.keys(ROLE_PERMISSIONS),
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error fetching permissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/permissions/grant
 * Grant a custom permission to a user
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to manage user permissions
    requirePermission(user, Permission.USERS_MANAGE_PERMISSIONS, {
      resource: "permissions",
      metadata: { action: "grant_permission" },
    });

    const body = await request.json();
    const { userId, permission, reason } = body;

    // Validate input
    if (!userId || typeof userId !== "number") {
      return NextResponse.json(
        { error: "Invalid userId" },
        { status: 400 }
      );
    }

    if (!permission || !ALL_PERMISSIONS.includes(permission as Permission)) {
      return NextResponse.json(
        { error: "Invalid permission" },
        { status: 400 }
      );
    }

    // Check if target user exists
    const targetUser = usersModel.findById(userId);
    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Grant the permission
    grantPermission(userId, permission as Permission, user!.id, reason);

    // Get updated permissions
    const updatedPermissions = getUserPermissions(targetUser);

    return NextResponse.json({
      success: true,
      message: `Permission ${permission} granted to ${targetUser.username}`,
      permissions: updatedPermissions,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error granting permission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/permissions/revoke
 * Revoke a custom permission from a user
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to manage user permissions
    requirePermission(user, Permission.USERS_MANAGE_PERMISSIONS, {
      resource: "permissions",
      metadata: { action: "revoke_permission" },
    });

    const body = await request.json();
    const { userId, permission, reason } = body;

    // Validate input
    if (!userId || typeof userId !== "number") {
      return NextResponse.json(
        { error: "Invalid userId" },
        { status: 400 }
      );
    }

    if (!permission || !ALL_PERMISSIONS.includes(permission as Permission)) {
      return NextResponse.json(
        { error: "Invalid permission" },
        { status: 400 }
      );
    }

    // Check if target user exists
    const targetUser = usersModel.findById(userId);
    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Revoke the permission
    revokePermission(userId, permission as Permission, user!.id, reason);

    // Get updated permissions
    const updatedPermissions = getUserPermissions(targetUser);

    return NextResponse.json({
      success: true,
      message: `Permission ${permission} revoked from ${targetUser.username}`,
      permissions: updatedPermissions,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error revoking permission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/permissions
 * Remove a custom permission entry (return to role defaults)
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to manage user permissions
    requirePermission(user, Permission.USERS_MANAGE_PERMISSIONS, {
      resource: "permissions",
      metadata: { action: "remove_custom_permission" },
    });

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const permission = searchParams.get("permission");

    // Validate input
    if (!userId || isNaN(parseInt(userId))) {
      return NextResponse.json(
        { error: "Invalid userId" },
        { status: 400 }
      );
    }

    if (!permission || !ALL_PERMISSIONS.includes(permission as Permission)) {
      return NextResponse.json(
        { error: "Invalid permission" },
        { status: 400 }
      );
    }

    // Check if target user exists
    const targetUser = usersModel.findById(parseInt(userId));
    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Remove the custom permission
    removeCustomPermission(
      parseInt(userId),
      permission as Permission,
      user!.id
    );

    // Get updated permissions
    const updatedPermissions = getUserPermissions(targetUser);

    return NextResponse.json({
      success: true,
      message: `Custom permission ${permission} removed from ${targetUser.username}`,
      permissions: updatedPermissions,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error removing custom permission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
