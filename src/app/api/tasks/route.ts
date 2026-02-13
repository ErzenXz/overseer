import { NextRequest, NextResponse } from "next/server";
import { agentTasksModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const limit = parseInt(searchParams.get("limit") || "200", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  if (canViewAll) {
    // No "findAll" yet: keep it simple for now.
    // Admins can fetch their own tasks; tenant-wide views can be added later.
    return NextResponse.json({
      tasks: agentTasksModel.findByOwner(user.id, { status, limit, offset }),
    });
  }

  return NextResponse.json({
    tasks: agentTasksModel.findByOwner(user.id, { status, limit, offset }),
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const title = String(body.title ?? "").trim();
  const input = String(body.input ?? "").trim();
  const priority = typeof body.priority === "number" ? body.priority : 5;

  if (!title || !input) {
    return NextResponse.json(
      { error: "title and input are required" },
      { status: 400 },
    );
  }

  const task = agentTasksModel.create({
    owner_user_id: user.id,
    conversation_id: body.conversation_id ?? null,
    parent_task_id: body.parent_task_id ?? null,
    title,
    input,
    status: "queued",
    priority,
    artifacts: body.artifacts ?? null,
  });

  return NextResponse.json({ success: true, task });
}

