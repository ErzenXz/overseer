import Link from "next/link";

import { db } from "@/database";

interface SessionHistoryRow {
  id: number;
  interface_type: string;
  external_user_id: string;
  external_chat_id: string;
  message_count: number;
  total_tokens: number;
  error_count: number;
  is_active: number;
  created_at: number;
  last_active_at: number;
}

function formatUnixMillis(value: number) {
  if (!value || Number.isNaN(value)) return "—";
  return new Date(value).toLocaleString();
}

export default function SessionHistoryPage() {
  const sessions = db
    .prepare(
      `SELECT id, interface_type, external_user_id, external_chat_id, message_count, total_tokens, error_count, is_active, created_at, last_active_at
       FROM agent_sessions
       ORDER BY last_active_at DESC
       LIMIT 200`
    )
    .all() as SessionHistoryRow[];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Session History</h1>
          <p className="text-text-secondary mt-1 text-pretty">
            Historical session timeline with interface source, token usage, and activity metrics.
          </p>
        </div>
        <Link
          href="/sessions"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back to sessions
        </Link>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-raised p-8 text-center text-text-secondary text-pretty">
          No sessions yet. Activity will appear here once the agent starts handling requests.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-raised overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-overlay border-b border-border">
                <tr className="text-left text-text-secondary">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Interface</th>
                  <th className="px-4 py-3 font-medium">User/chat</th>
                  <th className="px-4 py-3 font-medium">Messages</th>
                  <th className="px-4 py-3 font-medium">Tokens</th>
                  <th className="px-4 py-3 font-medium">Errors</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-4 py-3 text-white font-mono tabular-nums">{session.id}</td>
                    <td className="px-4 py-3 text-white capitalize">{session.interface_type}</td>
                    <td className="px-4 py-3 text-text-secondary max-w-xs truncate" title={`${session.external_user_id}/${session.external_chat_id}`}>
                      {session.external_user_id || "unknown"} / {session.external_chat_id || "unknown"}
                    </td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{session.message_count}</td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{session.total_tokens}</td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{session.error_count}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-1 rounded text-xs ${
                          session.is_active
                            ? "bg-green-500/10 text-green-300"
                            : "bg-surface-overlay text-text-secondary"
                        }`}
                      >
                        {session.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary tabular-nums">{formatUnixMillis(session.last_active_at)}</td>
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
