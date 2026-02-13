import { NextRequest, NextResponse } from "next/server";
import { agentTasksModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const task = agentTasksModel.findById(parseInt(id, 10));
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && task.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ task });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const task = agentTasksModel.findById(parseInt(id, 10));
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && task.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const updated = agentTasksModel.update(task.id, {
    status: body.status,
    priority: body.priority,
    assigned_sub_agent_id: body.assigned_sub_agent_id,
    result_summary: body.result_summary,
    result_full: body.result_full,
    error: body.error,
    artifacts: body.artifacts,
    started_at: body.started_at,
    finished_at: body.finished_at,
  });

  return NextResponse.json({ success: true, task: updated });
}

