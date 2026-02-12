import Link from "next/link";

import { db } from "@/database";

interface SubAgentRow {
  id: number;
  sub_agent_id: string;
  parent_session_id: string | null;
  name: string;
  agent_type: string;
  status: "idle" | "working" | "completed" | "error";
  assigned_task: string | null;
  created_at: string;
  completed_at: string | null;
  tokens_used: number;
  step_count: number;
}

const statusClasses: Record<SubAgentRow["status"], string> = {
  idle: "bg-surface-overlay text-text-secondary",
  working: "bg-yellow-500/10 text-yellow-300",
  completed: "bg-green-500/10 text-green-300",
  error: "bg-red-500/10 text-red-300",
};

export default function AllSubAgentsPage() {
  const rows = db
    .prepare(
      `SELECT id, sub_agent_id, parent_session_id, name, agent_type, status, assigned_task, created_at, completed_at, tokens_used, step_count
       FROM sub_agents
       ORDER BY created_at DESC
       LIMIT 200`
    )
    .all() as SubAgentRow[];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">All Sub-Agents</h1>
          <p className="text-text-secondary mt-1 text-pretty">
            Inspect every sub-agent job across statuses, including completed and failed runs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/subagents/spawn"
            className="px-3 py-2 text-sm rounded bg-accent hover:bg-accent-light text-black font-medium transition-colors"
          >
            Spawn new
          </Link>
          <Link
            href="/subagents"
            className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
          >
            Back
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-raised p-8 text-center">
          <p className="text-text-secondary text-pretty mb-4">No sub-agent runs found yet.</p>
          <Link
            href="/subagents/spawn"
            className="inline-flex px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium transition-colors"
          >
            Create your first run
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-raised overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-overlay border-b border-border">
                <tr className="text-left text-text-secondary">
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Parent session</th>
                  <th className="px-4 py-3 font-medium">Steps</th>
                  <th className="px-4 py-3 font-medium">Tokens</th>
                  <th className="px-4 py-3 font-medium">Task</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-4 py-3 text-white capitalize">{row.agent_type}</td>
                    <td className="px-4 py-3 text-white">{row.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded text-xs ${statusClasses[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary font-mono tabular-nums">
                      {row.parent_session_id ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{row.step_count}</td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{row.tokens_used}</td>
                    <td className="px-4 py-3 text-text-secondary max-w-xl truncate" title={row.assigned_task ?? ""}>
                      {row.assigned_task ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
