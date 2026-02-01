"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentSession } from "@/database/models/agent-sessions";

interface SessionsListProps {
  sessions: AgentSession[];
}

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  idle: "bg-blue-500",
  busy: "bg-yellow-500",
  error: "bg-red-500",
  ended: "bg-zinc-500",
};

const statusBadgeColors: Record<string, string> = {
  active: "bg-green-500/10 text-green-400",
  idle: "bg-blue-500/10 text-blue-400",
  busy: "bg-yellow-500/10 text-yellow-400",
  error: "bg-red-500/10 text-red-400",
  ended: "bg-zinc-500/10 text-zinc-400",
};

export function SessionsList({ sessions }: SessionsListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [killingId, setKillingId] = useState<string | null>(null);

  const filteredSessions = filter === "all" 
    ? sessions 
    : sessions.filter(s => s.status === filter);

  const handleKillSession = async (sessionId: string) => {
    if (!confirm("Are you sure you want to kill this session?")) return;

    setKillingId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/kill`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setKillingId(null);
    }
  };

  const formatDuration = (startedAt: string) => {
    const started = new Date(startedAt);
    const now = new Date();
    const diff = Math.floor((now.getTime() - started.getTime()) / 1000);
    
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  };

  return (
    <div>
      {/* Filter Tabs */}
      <div className="flex gap-2 p-4 border-b border-zinc-800">
        {["all", "active", "busy", "idle", "error"].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === status
                ? "bg-indigo-500/10 text-indigo-400"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Sessions Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-zinc-400 border-b border-zinc-800">
              <th className="px-6 py-4 font-medium">Session</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Interface</th>
              <th className="px-6 py-4 font-medium">User</th>
              <th className="px-6 py-4 font-medium">Duration</th>
              <th className="px-6 py-4 font-medium">Steps</th>
              <th className="px-6 py-4 font-medium">Tokens</th>
              <th className="px-6 py-4 font-medium">Current Task</th>
              <th className="px-6 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredSessions.map((session) => (
              <tr key={session.id} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${statusColors[session.status]}`} />
                    <code className="text-xs text-zinc-300 font-mono">
                      {session.session_id.slice(0, 8)}...
                    </code>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2 py-1 rounded ${statusBadgeColors[session.status]}`}>
                    {session.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-300">
                  {session.interface_type}
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-zinc-300">
                    {session.username || session.user_id || "-"}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {formatDuration(session.started_at)}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {session.step_count}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {session.total_tokens.toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-zinc-400 truncate max-w-[200px] block">
                    {session.current_task || "-"}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleKillSession(session.session_id)}
                      disabled={killingId === session.session_id || session.status === "ended"}
                      className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {killingId === session.session_id ? "..." : "Kill"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredSessions.length === 0 && (
        <div className="p-8 text-center text-zinc-500">
          No sessions match the current filter
        </div>
      )}
    </div>
  );
}
