import { logsModel } from "@/database/models/system";
import AuditLogClient from "./AuditLogClient";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission, requirePermission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const user = await getCurrentUser();
  if (!user) {
    // proxy.ts should already redirect, but keep this server-side guard.
    redirect("/login");
  }
  requirePermission(user, Permission.BOT_VIEW_LOGS, {
    resource: "logs",
    metadata: { action: "view_logs" },
  });

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  const allLogs = canViewAll
    ? logsModel.findRecent(500)
    : logsModel.findRecent(500, undefined, undefined, user.id);
  const logStats = canViewAll ? logsModel.getStats() : logsModel.getStats(user.id);
  return <AuditLogClient logs={allLogs} stats={logStats} />;
}
