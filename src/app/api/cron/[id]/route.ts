import { NextRequest, NextResponse } from "next/server";
import { cronJobsModel, cronExecutionsModel } from "@/database";
import { isValidCronExpression, describeCronExpression } from "@/database/models/cron";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

/**
 * GET /api/cron/[id] — Get a single cron job with execution history
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = cronJobsModel.findById(parseInt(id));

  if (!job) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && (job as any).owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const executions = canViewAll
    ? cronExecutionsModel.findByJobId(job.id, 20)
    : cronExecutionsModel.findByJobIdForOwner(user.id, job.id, 20);

  return NextResponse.json({
    job: {
      ...job,
      schedule_description: describeCronExpression(job.cron_expression),
    },
    executions,
  });
}

/**
 * PATCH /api/cron/[id] — Update a cron job
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = cronJobsModel.findById(parseInt(id));
  if (!existing) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }
  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && (existing as any).owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Validate cron expression if being updated
  if (body.cron_expression && !isValidCronExpression(body.cron_expression)) {
    return NextResponse.json(
      { error: `Invalid cron expression: "${body.cron_expression}"` },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.cron_expression !== undefined) updates.cron_expression = body.cron_expression;
  if (body.prompt !== undefined) updates.prompt = body.prompt;
  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
  if (body.timezone !== undefined) updates.timezone = body.timezone;
  if (body.max_retries !== undefined) updates.max_retries = body.max_retries;
  if (body.timeout_ms !== undefined) updates.timeout_ms = body.timeout_ms;

  const job = cronJobsModel.update(parseInt(id), updates);

  if (!job) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job: {
      ...job,
      schedule_description: describeCronExpression(job.cron_expression),
    },
  });
}

/**
 * DELETE /api/cron/[id] — Delete a cron job
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = cronJobsModel.findById(parseInt(id));
  if (!existing) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }
  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  if (!canViewAll && (existing as any).owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deleted = cronJobsModel.delete(parseInt(id));

  if (!deleted) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
