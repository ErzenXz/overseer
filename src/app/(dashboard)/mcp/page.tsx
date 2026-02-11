import { StatsCard } from "@/components/StatsCard";
import * as mcpClient from "@/agent/mcp/client";
import { MCPServersList } from "./MCPServersList";

export default function MCPPage() {
  const allServers = mcpClient.getAllServers();
  const connectionStatus = mcpClient.getConnectionStatus();
  const connectedCount = connectionStatus.length;
  const totalTools = connectionStatus.reduce((acc, s) => acc + s.tools, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">MCP Servers</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Manage Model Context Protocol server connections</p>
        </div>
        <a
          href="/mcp/add"
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black text-sm font-medium rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Add MCP Server
        </a>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Servers"
          value={allServers.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          }
          color="accent"
        />
        <StatsCard
          title="Connected"
          value={connectedCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          color="success"
        />
        <StatsCard
          title="Active Servers"
          value={allServers.filter(s => s.is_active).length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="info"
        />
        <StatsCard
          title="Available Tools"
          value={totalTools}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          color="accent"
        />
      </div>

      {/* Connection Status */}
      {connectionStatus.length > 0 && (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold text-white font-[var(--font-mono)] mb-4">Active Connections</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connectionStatus.map((status) => (
              <div key={status.server} className="flex items-center justify-between p-4 bg-[var(--color-surface-overlay)] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-white font-medium">{status.server}</span>
                </div>
                <span className="text-sm text-[var(--color-text-secondary)]">{status.tools} tools</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Servers List */}
      {allServers.length === 0 ? (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface-overlay)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No MCP servers configured</h3>
          <p className="text-[var(--color-text-secondary)] mb-6">Add MCP servers to extend your agent with additional tools and capabilities</p>
          <a
            href="/mcp/add"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black text-sm font-medium rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Your First Server
          </a>
        </div>
      ) : (
        <MCPServersList servers={allServers} connectionStatus={connectionStatus} />
      )}

      {/* Info Section */}
      <div className="mt-8 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white font-[var(--font-mono)] mb-4">About MCP</h2>
        <p className="text-[var(--color-text-secondary)] text-sm mb-4">
          Model Context Protocol (MCP) allows your agent to connect to external servers that provide additional tools and capabilities.
          MCP servers can be run locally (stdio) or accessed remotely (SSE).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <h3 className="font-medium text-white mb-2">STDIO Servers</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Run local processes that communicate via stdin/stdout. Good for tools that need filesystem access.
            </p>
          </div>
          <div className="p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <h3 className="font-medium text-white mb-2">SSE Servers</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Connect to remote servers via Server-Sent Events. Good for shared services and cloud tools.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
