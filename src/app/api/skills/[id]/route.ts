import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteSkill, findById, updateSkill } from "@/agent/skills/registry";
import { hasPermission, Permission, requirePermission } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  requirePermission(user, Permission.SKILLS_CONFIGURE, {
    resource: "skills",
    metadata: { action: "update" },
  });

  const { id } = await params;
  const skillId = Number.parseInt(id, 10);
  if (!Number.isFinite(skillId)) {
    return NextResponse.json({ error: "Invalid skill ID" }, { status: 400 });
  }

  const skill = findById(skillId);
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && skill.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (skill.is_builtin && !canViewAll) {
    return NextResponse.json(
      { error: "Built-in skills are shared and can only be modified by admins." },
      { status: 403 },
    );
  }

  const body = await request.json();
  updateSkill(skillId, {
    is_active: body.is_active ? 1 : 0,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  requirePermission(user, Permission.SKILLS_UNINSTALL, {
    resource: "skills",
    metadata: { action: "delete" },
  });

  const { id } = await params;
  const skillId = Number.parseInt(id, 10);
  if (!Number.isFinite(skillId)) {
    return NextResponse.json({ error: "Invalid skill ID" }, { status: 400 });
  }

  const skill = findById(skillId);
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && skill.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (skill.is_builtin) {
    return NextResponse.json(
      { error: "Built-in skills cannot be deleted" },
      { status: 400 },
    );
  }

  deleteSkill(skillId);
  return NextResponse.json({ success: true });
}
