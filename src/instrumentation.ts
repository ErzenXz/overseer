/**
 * Next.js Instrumentation
 * Runs once when the Next.js server starts.
 * Used to start the cron engine polling loop.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (typeof window !== "undefined") return;
  if (process.env.NEXT_RUNTIME === "edge") return;

  // Don't start during build
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { startCronEngine } = await import("./lib/cron-engine");
    startCronEngine();
    console.log("[instrumentation] Cron engine started");
  } catch (err) {
    console.error("[instrumentation] Failed to start cron engine:", err);
  }

  try {
    // Keep skills available out-of-the-box (idempotent sync to DB).
    const { syncBuiltinSkills } = await import("./agent/skills/registry");
    syncBuiltinSkills();
    console.log("[instrumentation] Built-in skills synced");
  } catch (err) {
    console.error("[instrumentation] Failed to sync built-in skills:", err);
  }
}
