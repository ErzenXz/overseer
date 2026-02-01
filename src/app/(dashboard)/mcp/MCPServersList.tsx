"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MCPServer } from "@/agent/mcp/client";

interface MCPServersListProps {
  servers: MCPServer[];
  connectionStatus: { server: string; connected: boolean; tools: number }[];
}

export function MCPServersList({ servers, connectionStatus }: MCPServersListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "stdio" | "sse">("all");
  const [actioningId, setActioningId] = useState<number | null>(null);

  const connectionMap = new Map(connectionStatus.map(s => [s.server, s]));
  
  const filteredServers = filter === "all" 
    ? servers 
    : servers.filter(s => s.server_type === filter);

  const handleConnect = async (id: number) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/mcp/${id}/connect`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Failed to connect: ${data.error}`);
      }
    } finally {
      setActioningId(null);
    }
  };

  const handleDisconnect = async (id: number) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/mcp/${id}/disconnect`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setActioningId(null);
    }
  };

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    await fetch(`/api/mcp/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    router.refresh();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this MCP server?")) return;

    setActioningId(id);
    try {
      const res = await fetch(`/api/mcp/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl">
      {/* Filter Tabs */}
      <div className="flex gap-2 p-4 border-b border-zinc-800">
        {(["all", "stdio", "sse"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === type
                ? "bg-indigo-500/10 text-indigo-400"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            {type === "all" ? "All" : type.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Servers List */}
      <div className="divide-y divide-zinc-800">
        {filteredServers.map((server) => {
          const isConnected = connectionMap.has(server.name);
          const connInfo = connectionMap.get(server.name);

          return (
            <div key={server.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      isConnected
                        ? "bg-gradient-to-br from-green-500 to-emerald-600"
                        : server.is_active
                        ? "bg-gradient-to-br from-indigo-500 to-purple-600"
                        : "bg-zinc-800"
                    }`}
                  >
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{server.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        server.server_type === "stdio" 
                          ? "bg-blue-500/10 text-blue-400" 
                          : "bg-purple-500/10 text-purple-400"
                      }`}>
                        {server.server_type.toUpperCase()}
                      </span>
                      {isConnected && (
                        <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded">
                          Connected
                        </span>
                      )}
                      {!server.is_active && (
                        <span className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-400 rounded">
                          Disabled
                        </span>
                      )}
                      {server.auto_connect === 1 && (
                        <span className="text-xs px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded">
                          Auto-connect
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-zinc-400">
                      {server.server_type === "stdio" ? (
                        <span>Command: <code className="text-zinc-300">{server.command}</code></span>
                      ) : (
                        <span>URL: <code className="text-zinc-300">{server.url}</code></span>
                      )}
                    </div>
                    {isConnected && connInfo && (
                      <div className="mt-2 text-sm text-green-400">
                        {connInfo.tools} tools available
                      </div>
                    )}
                    {server.last_error && !isConnected && (
                      <div className="mt-2 text-sm text-red-400">
                        Error: {server.last_error}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-zinc-500">
                      {server.last_connected_at && (
                        <span>Last connected: {new Date(server.last_connected_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <button
                      onClick={() => handleDisconnect(server.id)}
                      disabled={actioningId === server.id}
                      className="px-3 py-1.5 text-sm text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {actioningId === server.id ? "..." : "Disconnect"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(server.id)}
                      disabled={actioningId === server.id || !server.is_active}
                      className="px-3 py-1.5 text-sm text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {actioningId === server.id ? "..." : "Connect"}
                    </button>
                  )}
                  <button
                    onClick={() => handleToggleActive(server.id, !!server.is_active)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      server.is_active
                        ? "text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20"
                        : "text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20"
                    }`}
                  >
                    {server.is_active ? "Disable" : "Enable"}
                  </button>
                  <a
                    href={`/mcp/${server.id}/edit`}
                    className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    Edit
                  </a>
                  <button
                    onClick={() => handleDelete(server.id)}
                    disabled={actioningId === server.id}
                    className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {actioningId === server.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredServers.length === 0 && (
        <div className="p-8 text-center text-zinc-500">
          No servers match the current filter
        </div>
      )}
    </div>
  );
}
