"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Skill } from "@/agent/skills/registry";
import { SearchIcon, PlayCircleIcon, PauseCircleIcon, Edit2Icon, Trash2Icon, BoxIcon, GithubIcon, FolderIcon, ShoppingBagIcon, ActivityIcon, ClockIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
      const first = JSON.parse(triggers) as unknown;
      const second =
        typeof first === "string"
          ? (JSON.parse(first) as unknown)
          : first;

      if (!Array.isArray(second)) {
        return [];
      }

      return second.filter(
        (item): item is string => typeof item === "string",
      );
    } catch {
      return [];
    }
  };

  return (
    <div className="w-full">
      {/* Search and Filter */}
      <div className="p-4 sm:p-5 border-b border-border/50 bg-muted/10 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="relative w-full md:w-80">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-4 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto custom-scrollbar pb-2 md:pb-0">
          {(["all", "builtin", "github", "local", "marketplace"] as const).map((source) => (
            <button
              key={source}
              onClick={() => setFilter(source)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-full transition-colors whitespace-nowrap",
                filter === source
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-background border border-input text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {source === "all" ? "All Sources" : source.charAt(0).toUpperCase() + source.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4 sm:p-5 bg-muted/5">
        {filteredSkills.map((skill) => {
          const triggers = parseTriggers(skill.triggers);

          return (
            <div
              key={skill.id}
              className={cn(
                "group relative flex flex-col rounded-xl border transition-all duration-200",
                skill.is_active 
                  ? "bg-card border-border hover:border-primary/30 hover:shadow-md" 
                  : "bg-muted/30 border-border/50 opacity-80 hover:opacity-100"
              )}
            >
              <div className="p-5 flex-1">
                <div className="flex items-start justify-between mb-3 gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-sm transition-colors",
                        skill.is_active
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-muted text-muted-foreground border-border/50"
                      )}
                    >
                      {skill.source === "builtin" ? <BoxIcon className="w-6 h-6" /> :
                       skill.source === "github" ? <GithubIcon className="w-6 h-6" /> :
                       skill.source === "local" ? <FolderIcon className="w-6 h-6" /> :
                       skill.source === "marketplace" ? <ShoppingBagIcon className="w-6 h-6" /> :
                       <ActivityIcon className="w-6 h-6" />}
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h3 className={cn(
                        "font-semibold text-base truncate",
                        skill.is_active ? "text-foreground" : "text-muted-foreground"
                      )} title={skill.name}>{skill.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                          skill.source === "builtin" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
                          skill.source === "github" ? "bg-purple-500/10 text-purple-500 border-purple-500/20" :
                          skill.source === "local" ? "bg-green-500/10 text-green-500 border-green-500/20" :
                          "bg-orange-500/10 text-orange-500 border-orange-500/20"
                        )}>
                          {skill.source}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 bg-muted/50 border border-border/50 rounded">
                          v{skill.version}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={() => handleToggleActive(skill.id, !!skill.is_active)}
                      className={cn(
                        "p-1.5 rounded-md transition-colors",
                        skill.is_active
                          ? "text-success hover:bg-success/10 hover:text-success"
                          : "text-muted-foreground hover:bg-warning/10 hover:text-warning"
                      )}
                      title={skill.is_active ? "Disable skill" : "Enable skill"}
                    >
                      {skill.is_active ? <PauseCircleIcon className="w-5 h-5" /> : <PlayCircleIcon className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="mb-4 text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                  {skill.description ? skill.description : <span className="italic opacity-50">No description provided</span>}
                </div>

                {triggers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {triggers.slice(0, 3).map((trigger, i) => (
                      <span key={i} className="text-[10px] font-medium px-2 py-0.5 bg-accent/10 text-accent-foreground border border-accent/20 rounded-full truncate max-w-[120px]" title={trigger}>
                        {trigger}
                      </span>
                    ))}
                    {triggers.length > 3 && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 text-muted-foreground bg-muted/30 border border-border/50 rounded-full">
                        +{triggers.length - 3}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground/50 italic">No triggers defined</div>
                )}
                
                {skill.author && (
                  <div className="mt-3 text-[11px] text-muted-foreground">
                    Author: <span className="font-medium text-foreground">{skill.author}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-t border-border/50 bg-muted/10 rounded-b-xl">
                <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  <span className="flex items-center gap-1" title="Usage count">
                    <ActivityIcon className="w-3.5 h-3.5" />
                    {skill.use_count}
                  </span>
                  {skill.last_used_at && (
                    <span className="flex items-center gap-1" title="Last used">
                      <ClockIcon className="w-3.5 h-3.5" />
                      {new Date(skill.last_used_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                  <a
                    href={`/admin/skills/${skill.id}/edit`}
                    className="p-1.5 text-muted-foreground hover:text-foreground bg-background hover:bg-accent border border-input hover:border-accent rounded-md transition-colors shadow-sm"
                    title="Configure"
                  >
                    <Edit2Icon className="w-3.5 h-3.5" />
                  </a>
                  {!skill.is_builtin && (
                    <button
                      onClick={() => handleDelete(skill.id, !!skill.is_builtin)}
                      disabled={actioningId === skill.id}
                      className="p-1.5 text-muted-foreground hover:text-destructive bg-background hover:bg-destructive/10 border border-input hover:border-destructive/20 rounded-md transition-colors shadow-sm disabled:opacity-50"
                      title="Delete"
                    >
                      {actioningId === skill.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2Icon className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredSkills.length === 0 && (
        <div className="p-12 text-center flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <SearchIcon className="w-6 h-6 text-muted-foreground/50" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">No skills found</h3>
          <p className="text-xs text-muted-foreground">
            No skills match your search or filter criteria.
          </p>
        </div>
      )}
    </div>
  );
}
