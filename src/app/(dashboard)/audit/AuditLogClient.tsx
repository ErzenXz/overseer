"use client";

import { useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { AuditLogEntry } from "@/components/admin/AuditLogEntry";
import type { Log } from "@/types/database";

interface AuditLogClientProps {
  logs: Log[];
  stats: { level: string; count: number }[];
}

export default function AuditLogClient({ logs, stats }: AuditLogClientProps) {
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLogs = logs.filter((log) => {
    const matchesLevel = levelFilter === "all" || log.level === levelFilter;
    const matchesCategory = categoryFilter === "all" || log.category === categoryFilter;
    const matchesSearch = searchQuery === "" ||
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLevel && matchesCategory && matchesSearch;
  });

  const categories = Array.from(new Set(logs.map((log) => log.category)));

  const errorCount = stats.find((entry) => entry.level === "error")?.count || 0;
  const warnCount = stats.find((entry) => entry.level === "warn")?.count || 0;
  const infoCount = stats.find((entry) => entry.level === "info")?.count || 0;
  const debugCount = stats.find((entry) => entry.level === "debug")?.count || 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Audit Log</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Security and system activity audit trail</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] text-sm font-medium rounded border border-[var(--color-border)] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export Logs
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear Old Logs
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Error Logs"
          value={errorCount}
          subtitle="Last 24 hours"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="danger"
        />
        <StatsCard
          title="Warning Logs"
          value={warnCount}
          subtitle="Last 24 hours"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
          color="warning"
        />
        <StatsCard
          title="Info Logs"
          value={infoCount}
          subtitle="Last 24 hours"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="info"
        />
        <StatsCard
          title="Total Entries"
          value={logs.length}
          subtitle="In database"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          color="accent"
        />
      </div>

      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
              Search
            </label>
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full px-4 py-2 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
              Level
            </label>
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
              className="w-full px-4 py-2 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="all">All Levels</option>
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="w-full px-4 py-2 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--color-border)]">
          <span className="text-sm text-[var(--color-text-muted)] mr-2">Quick filter:</span>
          {["all", "error", "warn", "info", "debug"].map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                levelFilter === level
                  ? level === "error" ? "bg-red-500/10 text-red-400 border border-red-500/30"
                  : level === "warn" ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                  : level === "info" ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                  : level === "debug" ? "bg-zinc-500/10 text-[var(--color-text-secondary)] border border-zinc-500/30"
                  : "bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-accent-border)]"
                  : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-surface-overlay)] border border-transparent"
              }`}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg">
        <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white font-[var(--font-mono)]">Log Entries</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Showing {filteredLogs.length} of {logs.length} entries
            </p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-surface-overlay)] rounded-lg transition-colors">
              Auto-refresh
            </button>
          </div>
        </div>

        <div className="divide-y divide-[var(--color-border)]">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <AuditLogEntry key={log.id} log={log} />
            ))
          ) : (
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface-overlay)] flex items-center justify-center">
                <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-white mb-2">No logs found</h3>
              <p className="text-[var(--color-text-secondary)]">Try adjusting your filters or search query</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mt-6">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-blue-400 mb-1">Log Retention Policy</h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Logs are automatically cleaned up after 30 days. Critical security events are retained for 90 days.
              You can export logs at any time for long-term archival.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
