import { StatsCard } from "@/components/StatsCard";
import { SessionCard } from "@/components/admin/SessionCard";
import { agentSessionsModel } from "@/database/models/agent-sessions";
import type { AgentSession } from "@/database/models/agent-sessions";

export default function SessionsPage() {
  const activeSessions = agentSessionsModel.findActive();
  const stats = agentSessionsModel.getStats();

  // Group sessions by interface type
  const sessionsByInterface = activeSessions.reduce((acc: Record<string, AgentSession[]>, session: AgentSession) => {
    const type = session.interface_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(session);
    return acc;
  }, {} as Record<string, AgentSession[]>);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Session Management</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Monitor and manage active agent sessions across all interfaces</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Kill Idle Sessions
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Emergency Stop All
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Active Sessions"
          value={stats.active + stats.busy}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          color="success"
        />
        <StatsCard
          title="Idle Sessions"
          value={stats.idle}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="info"
        />
        <StatsCard
          title="Today's Sessions"
          value={stats.total_sessions}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          color="accent"
        />
        <StatsCard
          title="Total Tokens Used"
          value={stats.total_tokens.toLocaleString()}
          subtitle={`Est. Cost: $${stats.total_cost.toFixed(4)}`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          }
          color="warning"
        />
      </div>

      {/* Session Status Overview */}
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold text-white font-[var(--font-mono)] mb-4">Session Status Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="text-3xl font-bold text-green-400">{stats.active}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">Active</div>
          </div>
          <div className="text-center p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="text-3xl font-bold text-yellow-400">{stats.busy}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">Busy</div>
          </div>
          <div className="text-center p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="text-3xl font-bold text-blue-400">{stats.idle}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">Idle</div>
          </div>
          <div className="text-center p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="text-3xl font-bold text-red-400">{stats.error}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">Error</div>
          </div>
          <div className="text-center p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="text-3xl font-bold text-[var(--color-text-secondary)]">{stats.total}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">Total</div>
          </div>
        </div>
      </div>

      {/* Sessions by Interface */}
      {activeSessions.length > 0 ? (
        <div className="space-y-8">
          {Object.entries(sessionsByInterface).map(([interfaceType, sessions]: [string, AgentSession[]]) => (
            <div key={interfaceType}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white font-[var(--font-mono)] capitalize">
                  {interfaceType} Sessions ({sessions.length})
                </h2>
                <button className="px-3 py-1.5 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors">
                  Kill All {interfaceType}
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {sessions.map((session: AgentSession) => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface-overlay)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No active sessions</h3>
          <p className="text-[var(--color-text-secondary)]">Sessions will appear here when agents start processing requests</p>
        </div>
      )}

      {/* Session History */}
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 mt-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white font-[var(--font-mono)]">Recent Session History</h2>
          <a href="/sessions/history" className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-light)]">
            View all history →
          </a>
        </div>
        <div className="text-sm text-[var(--color-text-muted)] text-center py-8">
          Session history feature coming soon
        </div>
      </div>
    </div>
  );
}
