import { redirect } from "next/navigation";
import { conversationsModel, messagesModel, providersModel, interfacesModel, toolExecutionsModel } from "@/database";
import { StatsCard } from "@/components/StatsCard";
import { getCurrentUser } from "@/lib/auth";
import { getUserPermissions, hasPermission, Permission } from "@/lib/permissions";
import { getUserSandboxRoot } from "@/lib/userfs";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const hasProviders = providersModel.findAll().length > 0;
  if (!hasProviders) {
    redirect("/onboarding");
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  const ownerId = canViewAll ? undefined : user.id;

  // Get stats
  const conversationCount = conversationsModel.count(ownerId);
  const messageCount = messagesModel.count();
  const totalTokens = messagesModel.getTotalTokens();
  const providerCount = providersModel.findActive().length;
  const interfaceCount = canViewAll
    ? interfacesModel.findActive().length
    : interfacesModel.findActiveByOwner(user.id).length;
  const toolStats = toolExecutionsModel.getStats();
  const totalToolExecutions = toolStats.reduce((acc, s) => acc + s.count, 0);

  // Get recent conversations
  const recentConversations = conversationsModel.findAll(5, 0, ownerId);

  // Get recent tool executions
  const recentToolExecutions = toolExecutionsModel.findRecent(10);

  // Tenant panel data (always scoped to current web user unless tenant:view_all is granted).
  const sandboxRoot = getUserSandboxRoot({ kind: "web", id: String(user.id) });
  const enabledInterfacesForUser = interfacesModel.findActiveByOwner(user.id);
  const effectivePerms = new Set(getUserPermissions(user));
  const systemPerms = [
    { perm: Permission.SYSTEM_SHELL, label: "Shell" },
    { perm: Permission.SYSTEM_FILES_READ, label: "Files: Read" },
    { perm: Permission.SYSTEM_FILES_WRITE, label: "Files: Write" },
    { perm: Permission.SYSTEM_FILES_DELETE, label: "Files: Delete" },
  ] as const;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Dashboard</h1>
        <p className="text-[var(--color-text-secondary)] text-sm mt-1">System overview</p>
      </div>

      {/* Tenant Panel */}
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5 mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-2">Tenant</h2>
            <div className="text-sm text-[var(--color-text-primary)]">
              <span className="font-medium">{user.username}</span>
              <span className="text-[var(--color-text-muted)]"> · </span>
              <span className="text-[var(--color-text-secondary)] font-[var(--font-mono)]">user:{user.id}</span>
            </div>
            <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
              Sandbox root
              <div className="mt-1 font-[var(--font-mono)] text-[11px] text-[var(--color-text-primary)] break-all bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded px-2 py-1">
                {sandboxRoot}
              </div>
              <div className="mt-2 text-[var(--color-text-muted)]">
                All web and connector chats for this user run in the same sandbox by default.
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-2 text-right">
              Host Access
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {systemPerms.map((p) => {
                const ok = effectivePerms.has(p.perm);
                return (
                  <span
                    key={p.perm}
                    className={[
                      "px-2 py-1 rounded border text-[11px] font-[var(--font-mono)]",
                      ok
                        ? "bg-[rgba(0,255,170,0.06)] border-[rgba(0,255,170,0.25)] text-[var(--color-success)]"
                        : "bg-[rgba(255,186,0,0.06)] border-[rgba(255,186,0,0.25)] text-[var(--color-warning)]",
                    ].join(" ")}
                    title={p.perm}
                  >
                    {p.label}: {ok ? "ON" : "OFF"}
                  </span>
                );
              })}
            </div>
            {!effectivePerms.has(Permission.SYSTEM_SHELL) &&
              !effectivePerms.has(Permission.SYSTEM_FILES_READ) &&
              !effectivePerms.has(Permission.SYSTEM_FILES_WRITE) &&
              !effectivePerms.has(Permission.SYSTEM_FILES_DELETE) && (
                <div className="mt-2 text-[11px] text-[var(--color-text-muted)] text-right max-w-[340px]">
                  You are sandboxed. Ask an admin to grant system permissions if you need VPS-level control.
                </div>
              )}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
              Enabled Connectors
            </div>
            <a
              href="/interfaces"
              className="text-[11px] font-[var(--font-mono)] text-[var(--color-text-secondary)] hover:text-white"
            >
              Manage
            </a>
          </div>

          {enabledInterfacesForUser.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {enabledInterfacesForUser.map((i) => (
                <span
                  key={i.id}
                  className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-overlay)] text-[11px] font-[var(--font-mono)] text-[var(--color-text-primary)]"
                  title={`interface:${i.id}`}
                >
                  {i.type}
                  <span className="text-[var(--color-text-muted)]"> · </span>
                  {i.name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--color-text-muted)]">
              No connectors enabled for this user yet.
            </div>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Conversations"
          value={conversationCount}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
          color="accent"
        />
        <StatsCard
          title="Messages"
          value={messageCount}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          }
          color="success"
        />
        <StatsCard
          title="Tokens Used"
          value={totalTokens.toLocaleString()}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          }
          color="warning"
        />
        <StatsCard
          title="Tool Executions"
          value={totalToolExecutions}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            </svg>
          }
          color="info"
        />
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">System Status</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${providerCount > 0 ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`} />
                <span className="text-sm text-[var(--color-text-primary)]">LLM Providers</span>
              </div>
              <span className="text-sm text-[var(--color-text-secondary)] font-[var(--font-mono)]">{providerCount} active</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${interfaceCount > 0 ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}`} />
                <span className="text-sm text-[var(--color-text-primary)]">Chat Interfaces</span>
              </div>
              <span className="text-sm text-[var(--color-text-secondary)] font-[var(--font-mono)]">{interfaceCount} active</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
                <span className="text-sm text-[var(--color-text-primary)]">Agent Status</span>
              </div>
              <span className="text-sm text-[var(--color-success)] font-[var(--font-mono)]">Operational</span>
            </div>
          </div>
        </div>

        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            <a
              href="/providers"
              className="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Provider
            </a>
            <a
              href="/interfaces"
              className="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Interface
            </a>
            <a
              href="/soul"
              className="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Soul
            </a>
            <a
              href="/audit"
              className="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Logs
            </a>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">Recent Conversations</h2>
          {recentConversations.length > 0 ? (
            <div className="space-y-2">
              {recentConversations.map((conv) => (
                <a
                  key={conv.id}
                  href={`/conversations/${conv.id}`}
                  className="block p-3 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {conv.external_username || conv.external_user_id}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">{conv.interface_type}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-secondary)]">{conv.message_count} messages</span>
                    <span className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-[var(--color-text-muted)] text-sm">No conversations yet</p>
          )}
        </div>

        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">Recent Tool Executions</h2>
          {recentToolExecutions.length > 0 ? (
            <div className="space-y-2">
              {recentToolExecutions.slice(0, 5).map((exec) => (
                <div
                  key={exec.id}
                  className="p-3 bg-[var(--color-surface-overlay)] rounded"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] font-[var(--font-mono)]">{exec.tool_name}</span>
                    <span className={`text-xs font-[var(--font-mono)] ${exec.success ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                      {exec.success ? 'OK' : 'FAIL'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-secondary)] font-[var(--font-mono)]">
                      {exec.execution_time_ms ? `${exec.execution_time_ms}ms` : '-'}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
                      {new Date(exec.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--color-text-muted)] text-sm">No tool executions yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
