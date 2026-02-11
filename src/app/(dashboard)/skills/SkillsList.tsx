"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Skill } from "@/agent/skills/registry";

interface SkillsListProps {
  skills: Skill[];
}

const sourceColors: Record<string, string> = {
  builtin: "bg-blue-500/10 text-blue-400",
  github: "bg-purple-500/10 text-purple-400",
  local: "bg-green-500/10 text-green-400",
  marketplace: "bg-orange-500/10 text-orange-400",
};

export function SkillsList({ skills }: SkillsListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [actioningId, setActioningId] = useState<number | null>(null);

  const filteredSkills = skills.filter(skill => {
    const matchesFilter = filter === "all" || skill.source === filter;
    const matchesSearch = search === "" || 
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description?.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    await fetch(`/api/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    router.refresh();
  };

  const handleDelete = async (id: number, isBuiltin: boolean) => {
    if (isBuiltin) {
      alert("Built-in skills cannot be deleted. You can only disable them.");
      return;
    }
    
    if (!confirm("Are you sure you want to delete this skill?")) return;

    setActioningId(id);
    try {
      const res = await fetch(`/api/skills/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setActioningId(null);
    }
  };

  const parseTriggers = (triggers: string | null): string[] => {
    if (!triggers) return [];
    try {
      return JSON.parse(triggers);
    } catch {
      return [];
    }
  };

  return (
    <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg">
      {/* Search and Filter */}
      <div className="p-4 border-b border-[var(--color-border)] flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div className="flex gap-2">
          {["all", "builtin", "github", "local", "marketplace"].map((source) => (
            <button
              key={source}
              onClick={() => setFilter(source)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === source
                  ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-border)]"
              }`}
            >
              {source.charAt(0).toUpperCase() + source.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        {filteredSkills.map((skill) => {
          const triggers = parseTriggers(skill.triggers);

          return (
            <div
              key={skill.id}
              className={`border rounded-lg p-6 ${
                skill.is_active ? "border-[var(--color-border)] bg-[var(--color-surface-overlay)]" : "border-[var(--color-border)] bg-[var(--color-surface)] opacity-60"
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      skill.is_active
                        ? "bg-[var(--color-accent)]"
                        : "bg-[var(--color-surface-overlay)]"
                    }`}
                  >
                    <svg className={`w-5 h-5 ${skill.is_active ? "text-black" : "text-white"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{skill.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded ${sourceColors[skill.source]}`}>
                        {skill.source}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">v{skill.version}</span>
                      {skill.author && (
                        <span className="text-xs text-[var(--color-text-muted)]">by {skill.author}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleActive(skill.id, !!skill.is_active)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      skill.is_active
                        ? "text-green-400 hover:bg-green-500/10"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
                    }`}
                    title={skill.is_active ? "Active - Click to disable" : "Disabled - Click to enable"}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              </div>

              {skill.description && (
                <p className="text-sm text-[var(--color-text-secondary)] mb-4">{skill.description}</p>
              )}

              {triggers.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">Triggers:</p>
                  <div className="flex flex-wrap gap-1">
                    {triggers.slice(0, 5).map((trigger, i) => (
                      <span key={i} className="text-xs px-2 py-1 bg-[var(--color-surface-overlay)] text-[var(--color-text-primary)] rounded">
                        {trigger}
                      </span>
                    ))}
                    {triggers.length > 5 && (
                      <span className="text-xs text-[var(--color-text-muted)]">+{triggers.length - 5} more</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
                <div className="text-xs text-[var(--color-text-muted)]">
                  {skill.use_count > 0 && (
                    <span>Used {skill.use_count} times</span>
                  )}
                  {skill.last_used_at && (
                    <span className="ml-2">Last: {new Date(skill.last_used_at).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/skills/${skill.id}/edit`}
                    className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
                  >
                    Configure
                  </a>
                  {!skill.is_builtin && (
                    <button
                      onClick={() => handleDelete(skill.id, !!skill.is_builtin)}
                      disabled={actioningId === skill.id}
                      className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {actioningId === skill.id ? "..." : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredSkills.length === 0 && (
        <div className="p-8 text-center text-[var(--color-text-muted)]">
          No skills match the current filter
        </div>
      )}
    </div>
  );
}
