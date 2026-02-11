import * as subAgentManager from "@/agent/subagents/manager";
import SubAgentsClient from "./SubAgentsClient";

export default function SubAgentsPage() {
  const stats = subAgentManager.getStats();
  const allTypes = subAgentManager.getAllSubAgentTypes();
  return <SubAgentsClient stats={stats} allTypes={allTypes} />;
}
