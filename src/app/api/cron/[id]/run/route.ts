import { NextRequest, NextResponse } from "next/server";
import { cronJobsModel } from "@/database";
import { triggerJob } from "@/lib/cron-engine";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/cron/[id]/run — Manually trigger a cron job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const jobId = parseInt(id);
  const job = cronJobsModel.findById(jobId);

  if (!job) {
    return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
  }

  // Trigger execution in background — don't await
  triggerJob(jobId).catch((err) => {
    console.error(`Failed to trigger cron job ${jobId}:`, err);
  });

  return NextResponse.json({
    success: true,
    message: `Cron job "${job.name}" triggered. Execution started in background.`,
  });
}
