/**
 * Permission Middleware Wrapper
 * 
 * Provides easy-to-use middleware wrappers for protecting API routes with permissions.
 * 
 * Usage:
 * ```typescript
 * import { withPermission } from '@/lib/permission-middleware';
 * import { Permission } from '@/lib/permissions';
 * 
 * export const POST = withPermission(Permission.SYSTEM_SHELL, async (request, user) => {
 *   // user is guaranteed to have the permission
 *   // your logic here
 * });
 * ```
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import {
  Permission,
  requirePermission,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  PermissionError,
  logSecurityEvent,
} from "./permissions";
import type { User } from "@/types/database";

/**
 * API route handler type with authenticated user
 */
export type AuthenticatedHandler = (
  request: NextRequest,
  user: Omit<User, "password_hash">
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap an API route handler with permission check
 * 
 * @param permission - The required permission
 * @param handler - The route handler
 * @param options - Additional options
 */
export function withPermission(
  permission: Permission,
  handler: AuthenticatedHandler,
  options?: {
    resource?: string;
    logMetadata?: Record<string, any>;
  }
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      // Get current user
      const user = await getCurrentUser();
      
      if (!user) {
        logSecurityEvent({
          userId: null,
          username: null,
          action: "api_access",
          resource: options?.resource || request.nextUrl.pathname,
          permission,
          result: "denied",
          reason: "Not authenticated",
          ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
          userAgent: request.headers.get("user-agent") || null,
          metadata: options?.logMetadata ? JSON.stringify(options.logMetadata) : null,
        });

        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      // Check permission (this also logs the attempt)
      requirePermission(user, permission, {
        resource: options?.resource || request.nextUrl.pathname,
        metadata: {
          ...options?.logMetadata,
          method: request.method,
          path: request.nextUrl.pathname,
        },
      });

      // Permission granted - call handler
      return await handler(request, user);
      
    } catch (error) {
      if (error instanceof PermissionError) {
        return NextResponse.json(
          { error: "Permission denied", details: error.message },
          { status: 403 }
        );
      }

      console.error("Error in permission middleware:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/**
 * Wrap an API route handler with multiple permission checks (requires ANY)
 */
export function withAnyPermission(
  permissions: Permission[],
  handler: AuthenticatedHandler,
  options?: {
    resource?: string;
    logMetadata?: Record<string, any>;
  }
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await getCurrentUser();
      
      if (!user) {
        logSecurityEvent({
          userId: null,
          username: null,
          action: "api_access",
          resource: options?.resource || request.nextUrl.pathname,
          permission: permissions.join(", "),
          result: "denied",
          reason: "Not authenticated",
          ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
          userAgent: request.headers.get("user-agent") || null,
          metadata: options?.logMetadata ? JSON.stringify(options.logMetadata) : null,
        });

        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      // Check if user has ANY of the permissions
      const hasAccess = hasAnyPermission(user, permissions);

      logSecurityEvent({
        userId: user.id,
        username: user.username,
        action: "api_access",
        resource: options?.resource || request.nextUrl.pathname,
        permission: permissions.join(", "),
        result: hasAccess ? "allowed" : "denied",
        reason: hasAccess ? null : "Missing required permissions",
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
        userAgent: request.headers.get("user-agent") || null,
        metadata: options?.logMetadata ? JSON.stringify(options.logMetadata) : null,
      });

      if (!hasAccess) {
        throw new PermissionError(
          `Requires any of: ${permissions.join(", ")}`,
          permissions.join(", "),
          user.username
        );
      }

      return await handler(request, user);
      
    } catch (error) {
      if (error instanceof PermissionError) {
        return NextResponse.json(
          { error: "Permission denied", details: error.message },
          { status: 403 }
        );
      }

      console.error("Error in permission middleware:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/**
 * Wrap an API route handler with multiple permission checks (requires ALL)
 */
export function withAllPermissions(
  permissions: Permission[],
  handler: AuthenticatedHandler,
  options?: {
    resource?: string;
    logMetadata?: Record<string, any>;
  }
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await getCurrentUser();
      
      if (!user) {
        logSecurityEvent({
          userId: null,
          username: null,
          action: "api_access",
          resource: options?.resource || request.nextUrl.pathname,
          permission: permissions.join(", "),
          result: "denied",
          reason: "Not authenticated",
          ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
          userAgent: request.headers.get("user-agent") || null,
          metadata: options?.logMetadata ? JSON.stringify(options.logMetadata) : null,
        });

        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      // Check if user has ALL of the permissions
      const hasAccess = hasAllPermissions(user, permissions);

      logSecurityEvent({
        userId: user.id,
        username: user.username,
        action: "api_access",
        resource: options?.resource || request.nextUrl.pathname,
        permission: permissions.join(", "),
        result: hasAccess ? "allowed" : "denied",
        reason: hasAccess ? null : "Missing required permissions",
        ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
        userAgent: request.headers.get("user-agent") || null,
        metadata: options?.logMetadata ? JSON.stringify(options.logMetadata) : null,
      });

      if (!hasAccess) {
        throw new PermissionError(
          `Requires all of: ${permissions.join(", ")}`,
          permissions.join(", "),
          user.username
        );
      }

      return await handler(request, user);
      
    } catch (error) {
      if (error instanceof PermissionError) {
        return NextResponse.json(
          { error: "Permission denied", details: error.message },
          { status: 403 }
        );
      }

      console.error("Error in permission middleware:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/**
 * Wrap an API route handler with authentication only (no permission check)
 * Useful for routes that do their own permission checking
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const user = await getCurrentUser();
      
      if (!user) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }

      return await handler(request, user);
      
    } catch (error) {
      console.error("Error in auth middleware:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}

/**
 * Helper to check permission and return boolean instead of throwing
 * Useful for conditional logic within handlers
 */
export async function checkPermission(
  permission: Permission,
  options?: {
    resource?: string;
    logMetadata?: Record<string, any>;
  }
): Promise<{ allowed: boolean; user: Omit<User, "password_hash"> | null }> {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return { allowed: false, user: null };
    }

    const allowed = hasPermission(user, permission);

    // Log the check
    logSecurityEvent({
      userId: user.id,
      username: user.username,
      action: "permission_check",
      resource: options?.resource || null,
      permission,
      result: allowed ? "allowed" : "denied",
      metadata: options?.logMetadata ? JSON.stringify(options.logMetadata) : null,
    });

    return { allowed, user };
  } catch (error) {
    console.error("Error checking permission:", error);
    return { allowed: false, user: null };
  }
}
