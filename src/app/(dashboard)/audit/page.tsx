import { logsModel } from "@/database/models/system";
import AuditLogClient from "./AuditLogClient";

export default function AuditLogPage() {
  const allLogs = logsModel.findRecent(500);
  const logStats = logsModel.getStats();
  return <AuditLogClient logs={allLogs} stats={logStats} />;
}
