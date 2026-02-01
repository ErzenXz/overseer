"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface SubAgent {
  id: number;
  sub_agent_id: string;
  parent_session_id: string;
  agent_type: string;
  name: string;
  description: string | null;
  status: "idle" | "working" | "completed" | "error";
  assigned_task: string | null;
  task_result: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  step_count: number;
  tokens_used: number;
}

const statusColors: Record<string, string> = {
  idle: "bg-zinc-500",
  working: "bg-yellow-500",
  completed: "bg-green-500",
  error: "bg-red-500",
};

const statusBadgeColors: Record<string, string> = {
  idle: "bg-zinc-500/10 text-zinc-400",
  working: "bg-yellow-500/10 text-yellow-400",
  completed: "bg-green-500/10 text-green-400",
  error: "bg-red-500/10 text-red-400",
};

const typeColors: Record<string, string> = {
  code: "bg-purple-500/10 text-purple-400",
  file: "bg-blue-500/10 text-blue-400",
  git: "bg-orange-500/10 text-orange-400",
  system: "bg-red-500/10 text-red-400",
  web: "bg-green-500/10 text-green-400",
  docker: "bg-cyan-500/10 text-cyan-400",
  db: "bg-yellow-500/10 text-yellow-400",
  security: "bg-pink-500/10 text-pink-400",
  network: "bg-indigo-500/10 text-indigo-400",
};

export function SubAgentsList() {
  const router = useRouter();
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubAgents();
  }, []);

  const fetchSubAgents = async () => {
    try {
      const res = await fetch("/api/subagents");
      if (res.ok) {
        const data = await res.json();
        setSubAgents(data.subAgents || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredSubAgents = subAgents.filter(agent => {
    if (filter === "all") return true;
    if (filter === "active") return agent.status === "working" || agent.status === "idle";
    return agent.status === filter;
  });

  const formatDuration = (startedAt: string | null, completedAt: string | null) => {
    if (!startedAt) return "-";
    const started = new Date(startedAt);
    const ended = completedAt ? new Date(completedAt) : new Date();
    const diff = Math.floor((ended.getTime() - started.getTime()) / 1000);
    
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
    return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-zinc-500">
        Loading sub-agents...
      </div>
    );
  }

  if (subAgents.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
          <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-white mb-2">No sub-agents yet</h3>
        <p className="text-zinc-400">Sub-agents are spawned automatically during complex tasks</p>
      </div>
    );
  }

  return (
    <div>
      {/* Filter Tabs */}
      <div className="flex gap-2 p-4 border-b border-zinc-800">
        {["all", "active", "working", "completed", "error"].map((status) => (
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

      {/* Sub-Agents Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-zinc-400 border-b border-zinc-800">
              <th className="px-6 py-4 font-medium">Agent</th>
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Task</th>
              <th className="px-6 py-4 font-medium">Duration</th>
              <th className="px-6 py-4 font-medium">Steps</th>
              <th className="px-6 py-4 font-medium">Tokens</th>
              <th className="px-6 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredSubAgents.map((agent) => (
              <tr key={agent.id} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${statusColors[agent.status]} ${agent.status === "working" ? "animate-pulse" : ""}`} />
                    <div>
                      <p className="font-medium text-white">{agent.name}</p>
                      <code className="text-xs text-zinc-500 font-mono">
                        {agent.sub_agent_id.slice(0, 8)}...
                      </code>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2 py-1 rounded ${typeColors[agent.agent_type] || "bg-zinc-500/10 text-zinc-400"}`}>
                    {agent.agent_type}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-xs px-2 py-1 rounded ${statusBadgeColors[agent.status]}`}>
                    {agent.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-zinc-400 truncate max-w-[200px] block" title={agent.assigned_task || ""}>
                    {agent.assigned_task?.slice(0, 50) || "-"}
                    {agent.assigned_task && agent.assigned_task.length > 50 ? "..." : ""}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {formatDuration(agent.started_at, agent.completed_at)}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {agent.step_count}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {agent.tokens_used.toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <a
                      href={`/subagents/${agent.id}`}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                      Details
                    </a>
                    {agent.task_result && (
                      <button
                        onClick={() => alert(agent.task_result)}
                        className="px-3 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-lg transition-colors"
                      >
                        View Result
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredSubAgents.length === 0 && (
        <div className="p-8 text-center text-zinc-500">
          No sub-agents match the current filter
        </div>
      )}
    </div>
  );
}
