/**
 * Admin API: Security Audit Log
 * 
 * Endpoints:
 * - GET /api/admin/audit - Get audit logs with filtering
 * - GET /api/admin/audit/stats - Get audit statistics
 * - GET /api/admin/audit/export - Export audit logs as CSV
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  Permission,
  requirePermission,
  getAuditLogs,
  getAuditStats,
  PermissionError,
  type AuditLogFilter,
} from "@/lib/permissions";
import { usersModel } from "@/database";

/**
 * GET /api/admin/audit
 * Get security audit logs with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to view audit logs
    requirePermission(user, Permission.AUDIT_VIEW, {
      resource: "audit_logs",
      metadata: { action: "view_audit_logs" },
    });

    const searchParams = request.nextUrl.searchParams;
    
    // Check if this is a stats request
    if (searchParams.get("stats") === "true") {
      return getStatsHandler(request);
    }

    // Check if this is an export request
    if (searchParams.get("export") === "true") {
      return exportHandler(request);
    }

    // Build filter from query parameters
    const filter: AuditLogFilter = {};

    const userId = searchParams.get("userId");
    if (userId) {
      filter.userId = parseInt(userId);
    }

    const action = searchParams.get("action");
    if (action) {
      filter.action = action;
    }

    const permission = searchParams.get("permission");
    if (permission) {
      filter.permission = permission;
    }

    const result = searchParams.get("result");
    if (result === "allowed" || result === "denied") {
      filter.result = result;
    }

    const startDate = searchParams.get("startDate");
    if (startDate) {
      filter.startDate = startDate;
    }

    const endDate = searchParams.get("endDate");
    if (endDate) {
      filter.endDate = endDate;
    }

    const limit = searchParams.get("limit");
    if (limit) {
      filter.limit = parseInt(limit);
    } else {
      filter.limit = 100; // Default limit
    }

    const offset = searchParams.get("offset");
    if (offset) {
      filter.offset = parseInt(offset);
    }

    // Get audit logs
    const logs = getAuditLogs(filter);

    // Enrich logs with user information
    const enrichedLogs = logs.map((log) => {
      let targetUser = null;
      
      // Try to extract target user from metadata
      if (log.metadata) {
        try {
          const metadata = JSON.parse(log.metadata);
          if (metadata.targetUserId) {
            const user = usersModel.findById(metadata.targetUserId);
            if (user) {
              targetUser = {
                id: user.id,
                username: user.username,
              };
            }
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }

      return {
        ...log,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
        targetUser,
      };
    });

    return NextResponse.json({
      logs: enrichedLogs,
      filter,
      count: logs.length,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error fetching audit logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Get audit statistics
 */
async function getStatsHandler(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to view audit logs
    requirePermission(user, Permission.AUDIT_VIEW, {
      resource: "audit_logs",
      metadata: { action: "view_audit_stats" },
    });

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const stats = getAuditStats(startDate, endDate);

    return NextResponse.json({
      stats,
      period: {
        startDate: startDate || "all time",
        endDate: endDate || "now",
      },
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error fetching audit stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Export audit logs as CSV
 */
async function exportHandler(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require permission to export audit logs
    requirePermission(user, Permission.AUDIT_EXPORT, {
      resource: "audit_logs",
      metadata: { action: "export_audit_logs" },
    });

    const searchParams = request.nextUrl.searchParams;
    
    // Build filter from query parameters
    const filter: AuditLogFilter = {};

    const userId = searchParams.get("userId");
    if (userId) {
      filter.userId = parseInt(userId);
    }

    const action = searchParams.get("action");
    if (action) {
      filter.action = action;
    }

    const permission = searchParams.get("permission");
    if (permission) {
      filter.permission = permission;
    }

    const result = searchParams.get("result");
    if (result === "allowed" || result === "denied") {
      filter.result = result;
    }

    const startDate = searchParams.get("startDate");
    if (startDate) {
      filter.startDate = startDate;
    }

    const endDate = searchParams.get("endDate");
    if (endDate) {
      filter.endDate = endDate;
    }

    // No limit for export - get all matching logs
    const logs = getAuditLogs(filter);

    // Generate CSV
    const csv = generateCSV(logs);

    // Return as downloadable file
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="audit-logs-${new Date().toISOString()}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error exporting audit logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Generate CSV from audit logs
 */
function generateCSV(logs: any[]): string {
  const headers = [
    "ID",
    "Timestamp",
    "User ID",
    "Username",
    "Action",
    "Resource",
    "Permission",
    "Result",
    "Reason",
    "IP Address",
    "User Agent",
  ];

  const rows = logs.map((log) => [
    log.id,
    log.created_at,
    log.user_id || "",
    log.username || "",
    log.action,
    log.resource || "",
    log.permission || "",
    log.result,
    log.reason || "",
    log.ip_address || "",
    log.user_agent || "",
  ]);

  // Escape CSV fields
  const escapeCsvField = (field: any): string => {
    const str = String(field);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ];

  return csvRows.join("\n");
}

/**
 * POST /api/admin/audit/cleanup
 * Clean up old audit logs (optional maintenance endpoint)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    // Require admin permissions for cleanup
    requirePermission(user, Permission.USERS_MANAGE_PERMISSIONS, {
      resource: "audit_logs",
      metadata: { action: "cleanup_audit_logs" },
    });

    const body = await request.json();
    const { olderThanDays } = body;

    if (!olderThanDays || typeof olderThanDays !== "number" || olderThanDays < 1) {
      return NextResponse.json(
        { error: "Invalid olderThanDays parameter (must be >= 1)" },
        { status: 400 }
      );
    }

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffDateStr = cutoffDate.toISOString();

    // Delete old logs
    const { db } = await import("@/database/db");
    const result = db
      .prepare("DELETE FROM security_audit_log WHERE created_at < ?")
      .run(cutoffDateStr);

    return NextResponse.json({
      success: true,
      message: `Deleted ${result.changes} audit logs older than ${olderThanDays} days`,
      deletedCount: result.changes,
      cutoffDate: cutoffDateStr,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json(
        { error: "Permission denied", details: error.message },
        { status: 403 }
      );
    }

    console.error("Error cleaning up audit logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
