import { StatsCard } from "@/components/StatsCard";
import * as skillsRegistry from "@/agent/skills/registry";
import { SkillsList } from "./SkillsList";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <div className="text-sm text-[var(--color-text-secondary)]">Unauthorized</div>;
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
  const allSkills = canViewAll
    ? skillsRegistry.getAllSkills()
    : skillsRegistry.getAllSkillsForUser(user.id);
  const activeSkills = canViewAll
    ? skillsRegistry.getActiveSkills()
    : skillsRegistry.getActiveSkillsForUser(user.id);
  const builtinCount = allSkills.filter(s => s.is_builtin).length;
  const totalUses = allSkills.reduce((acc, s) => acc + s.use_count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Skills</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Modular capabilities for your AI agent</p>
        </div>
        <div className="flex gap-3">
          <a
            href="/skills/import"
            className="flex items-center gap-2 px-4 py-2 text-[var(--color-text-primary)] bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync / Import
          </a>
          <a
            href="/skills/import"
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Import Skill
          </a>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Skills"
          value={allSkills.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          }
          color="accent"
        />
        <StatsCard
          title="Active Skills"
          value={activeSkills.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="success"
        />
        <StatsCard
          title="Built-in Skills"
          value={builtinCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          }
          color="info"
        />
        <StatsCard
          title="Total Executions"
          value={totalUses}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
          color="accent"
        />
      </div>

      {/* Skills List */}
      {allSkills.length === 0 ? (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface-overlay)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No skills installed</h3>
          <p className="text-[var(--color-text-secondary)] mb-6">Install skills to extend your agent with new capabilities</p>
          <div className="flex justify-center gap-3">
            <a href="/skills/import" className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white text-sm font-medium rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync Built-in Skills
            </a>
            <a
              href="/skills/import"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Import from GitHub
            </a>
          </div>
        </div>
      ) : (
        <SkillsList skills={allSkills} />
      )}

      {/* Skill Sources Info */}
      <div className="mt-8 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Skill Sources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded">builtin</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Pre-installed skills from the skills/ directory
            </p>
          </div>
          <div className="p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded">github</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Skills imported from GitHub repositories
            </p>
          </div>
          <div className="p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded">local</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Custom skills created locally
            </p>
          </div>
          <div className="p-4 bg-[var(--color-surface-overlay)] rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 bg-orange-500/10 text-orange-400 rounded">marketplace</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Skills from the community marketplace
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
