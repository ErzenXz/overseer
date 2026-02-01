import { NextResponse } from "next/server";
import os from "os";

/**
 * Health Check Endpoint
 * Used by Docker, load balancers, and monitoring systems
 */
export async function GET() {
  try {
    // Basic system info
    const uptime = Math.floor(os.uptime());
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsedPercent = Math.round(((memTotal - memFree) / memTotal) * 100);
    const loadAvg = os.loadavg();

    // Check if database is accessible
    let dbStatus = "unknown";
    try {
      // Dynamic import to avoid issues during build
      const { db } = await import("@/database/db");
      const result = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
      dbStatus = result?.ok === 1 ? "healthy" : "unhealthy";
    } catch {
      dbStatus = "error";
    }

    const health = {
      status: dbStatus === "healthy" ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      node: process.version,
      uptime: uptime,
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        memory: {
          total: Math.round(memTotal / 1024 / 1024),
          free: Math.round(memFree / 1024 / 1024),
          usedPercent: memUsedPercent,
        },
        load: {
          "1m": loadAvg[0].toFixed(2),
          "5m": loadAvg[1].toFixed(2),
          "15m": loadAvg[2].toFixed(2),
        },
      },
      services: {
        database: dbStatus,
        web: "healthy",
      },
    };

    // Return 503 if not healthy
    const statusCode = health.status === "healthy" ? 200 : 503;

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}

// HEAD request for simple health checks
export async function HEAD() {
  try {
    const { db } = await import("@/database/db");
    const result = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    if (result?.ok === 1) {
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
