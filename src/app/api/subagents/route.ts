import { NextRequest, NextResponse } from "next/server";
import { db } from "@/database/db";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 1000);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

  const rows = canViewAll
    ? (db
        .prepare(
          "SELECT * FROM sub_agents ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?",
        )
        .all(limit, offset) as any[])
    : (db
        .prepare(
          "SELECT * FROM sub_agents WHERE owner_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?",
        )
        .all(user.id, limit, offset) as any[]);

  return NextResponse.json({ subAgents: rows });
}

