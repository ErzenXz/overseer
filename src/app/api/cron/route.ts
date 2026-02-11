import { NextRequest, NextResponse } from "next/server";
import { cronJobsModel, cronExecutionsModel } from "@/database";
import { isValidCronExpression, describeCronExpression } from "@/database/models/cron";
import { getCurrentUser } from "@/lib/auth";
import { getCronEngineStatus } from "@/lib/cron-engine";

/**
 * GET /api/cron — List all cron jobs + engine status
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const enabledOnly = url.searchParams.get("enabled") === "true";
  const includeHistory = url.searchParams.get("history") === "true";
  const limit = parseInt(url.searchParams.get("limit") || "100", 10);

  const jobs = enabledOnly
    ? cronJobsModel.findEnabled()
    : cronJobsModel.findAll(limit);

  const jobsWithMeta = jobs.map((job) => {
    const base = {
      ...job,
      schedule_description: describeCronExpression(job.cron_expression),
      recent_executions: undefined as ReturnType<typeof cronExecutionsModel.getRecentByJob> | undefined,
    };

    if (includeHistory) {
      base.recent_executions = cronExecutionsModel.getRecentByJob(job.id, 5);
    }

    return base;
  });

  const engineStatus = getCronEngineStatus();

  return NextResponse.json({
    jobs: jobsWithMeta,
    total: cronJobsModel.count(),
    enabled: cronJobsModel.countEnabled(),
    engine: engineStatus,
  });
}

/**
 * POST /api/cron — Create a new cron job
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.cron_expression || !body.prompt) {
      return NextResponse.json(
        { error: "Missing required fields: name, cron_expression, prompt" },
        { status: 400 }
      );
    }

    // Validate cron expression
    if (!isValidCronExpression(body.cron_expression)) {
      return NextResponse.json(
        { error: `Invalid cron expression: "${body.cron_expression}"` },
        { status: 400 }
      );
    }

    const job = cronJobsModel.create({
      name: body.name,
      description: body.description,
      cron_expression: body.cron_expression,
      prompt: body.prompt,
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1,
      created_by: user.username,
      timezone: body.timezone || "UTC",
      max_retries: body.max_retries,
      timeout_ms: body.timeout_ms,
    });

    return NextResponse.json({
      success: true,
      job: {
        ...job,
        schedule_description: describeCronExpression(job.cron_expression),
      },
    });
  } catch (error) {
    console.error("Error creating cron job:", error);
    return NextResponse.json(
      { error: "Failed to create cron job" },
      { status: 500 }
    );
  }
}
