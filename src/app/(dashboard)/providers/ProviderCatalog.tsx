"use client";

import { useEffect, useState } from "react";
import { ModelCard, formatTokenCount } from "@/components/ModelBadges";
import type { ModelInfo } from "@/agent/provider-info";

interface CatalogProvider {
  id: string;
  displayName: string;
  requiresKey: boolean;
  description: string;
  npm: string;
  supportsThinking: boolean;
  supportsMultimodal: boolean;
  models: ModelInfo[];
}

export function ProviderCatalog() {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "thinking" | "multimodal" | "free">("all");
  const [entries, setEntries] = useState<Array<[string, CatalogProvider]>>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await fetch("/api/providers/catalog", { cache: "no-store" });
      const data = await res.json();
      const providers = (data.providers || []) as CatalogProvider[];

      if (!cancelled) {
        setEntries(providers.map((provider) => [provider.id, provider]));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Compute stats for the header
  const totalModels = entries.reduce((acc, [, info]) => acc + info.models.length, 0);
  const thinkingModels = entries.reduce(
    (acc, [, info]) => acc + info.models.filter((m) => m.supportsThinking).length,
    0
  );
  const multimodalModels = entries.reduce(
    (acc, [, info]) => acc + info.models.filter((m) => m.supportsMultimodal).length,
    0
  );

  // Filter providers based on selected filter
  const filteredEntries = entries.filter(([, info]) => {
    if (filter === "all") return true;
    if (filter === "thinking") return info.models.some((m) => m.supportsThinking);
    if (filter === "multimodal") return info.models.some((m) => m.supportsMultimodal);
    if (filter === "free") return info.models.some((m) => m.costTier === "free");
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-6 text-xs text-[var(--color-text-muted)]">
        <span>
          <span className="text-white font-medium">{entries.length}</span> providers
        </span>
        <span>
          <span className="text-white font-medium">{totalModels}</span> models
        </span>
        <span>
          <span className="text-amber-400 font-medium">{thinkingModels}</span> with thinking
        </span>
        <span>
          <span className="text-blue-400 font-medium">{multimodalModels}</span> multimodal
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {(["all", "thinking", "multimodal", "free"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              filter === f
                ? "bg-[var(--color-accent)] text-black font-medium"
                : "bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] border border-[var(--color-border)]"
            }`}
          >
            {f === "all" ? "All Providers" : f === "thinking" ? "Thinking" : f === "multimodal" ? "Multimodal" : "Free Tier"}
          </button>
        ))}
      </div>

      {/* Provider accordion list */}
      <div className="space-y-2">
        {filteredEntries.map(([key, info]) => {
          const isExpanded = expandedProvider === key;
          const thinkingCount = info.models.filter((m) => m.supportsThinking).length;
          const reasoningCount = info.models.filter((m) => m.reasoning).length;
          const multimodalCount = info.models.filter((m) => m.supportsMultimodal).length;

          // Filter models within provider based on filter
          const visibleModels =
            filter === "all"
              ? info.models
              : filter === "thinking"
                ? info.models.filter((m) => m.supportsThinking)
                : filter === "multimodal"
                  ? info.models.filter((m) => m.supportsMultimodal)
                  : info.models.filter((m) => m.costTier === "free");

          return (
            <div key={key} className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              {/* Provider header - always visible */}
              <button
                onClick={() => setExpandedProvider(isExpanded ? null : key)}
                className="w-full flex items-center justify-between p-4 hover:bg-[var(--color-surface-overlay)] transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Provider icon */}
                  <div className="w-10 h-10 rounded-lg bg-[var(--color-surface-overlay)] border border-[var(--color-border)] flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-[var(--color-accent)]">
                      {info.displayName.charAt(0)}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-white text-sm">{info.displayName}</h3>
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono">{key}</span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{info.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {/* Summary badges */}
                  <div className="hidden sm:flex items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)]">
                      {info.models.length} models
                    </span>
                    {thinkingCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                        {thinkingCount} thinking
                      </span>
                    )}
                    {reasoningCount > 0 && reasoningCount !== thinkingCount && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                        {reasoningCount} reasoning
                      </span>
                    )}
                    {multimodalCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
                        {multimodalCount} vision
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${info.requiresKey ? "bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)]" : "bg-green-500/10 text-green-400"}`}>
                      {info.requiresKey ? "API key" : "Local"}
                    </span>
                  </div>

                  {/* Chevron */}
                  <svg
                    className={`w-5 h-5 text-[var(--color-text-muted)] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Expanded: model cards */}
              {isExpanded && (
                <div className="border-t border-[var(--color-border)] p-4">
                  {/* Provider meta */}
                  <div className="flex items-center gap-4 mb-4 text-xs text-[var(--color-text-muted)]">
                    <span>
                      npm: <code className="text-[var(--color-text-secondary)] font-mono">{info.npm}</code>
                    </span>
                    {info.supportsThinking && (
                      <span className="text-amber-400">Extended Thinking</span>
                    )}
                    {info.supportsMultimodal && (
                      <span className="text-blue-400">Multimodal</span>
                    )}
                  </div>

                  {/* Model grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {visibleModels.map((model) => (
                      <ModelCard key={model.id} model={model} />
                    ))}
                  </div>

                  {filter !== "all" && visibleModels.length < info.models.length && (
                    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                      Showing {visibleModels.length} of {info.models.length} models (filtered by &quot;{filter}&quot;)
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
