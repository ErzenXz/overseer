"use client";

import type { ModelInfo, Modality } from "@/agent/provider-info";

// ---------------------------------------------------------------------------
// Utility: format numbers for display
// ---------------------------------------------------------------------------

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count % 1_000 === 0 ? 0 : 0)}K`;
  return String(count);
}

export function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return "N/A";
  if (cost === 0) return "Free";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Cost tier config
// ---------------------------------------------------------------------------

const COST_TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  free: { label: "Free", color: "text-green-400", bg: "bg-green-500/10" },
  low: { label: "Low Cost", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  medium: { label: "Medium", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  high: { label: "High", color: "text-orange-400", bg: "bg-orange-500/10" },
  premium: { label: "Premium", color: "text-red-400", bg: "bg-red-500/10" },
};

// ---------------------------------------------------------------------------
// Badge: Cost Tier
// ---------------------------------------------------------------------------

export function CostTierBadge({ tier }: { tier: ModelInfo["costTier"] }) {
  const config = COST_TIER_CONFIG[tier] || COST_TIER_CONFIG.medium;
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${config.color} ${config.bg}`}>
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badge: Capability (thinking, tools, multimodal, streaming, structured output)
// ---------------------------------------------------------------------------

interface CapBadgeProps {
  label: string;
  active: boolean;
  /** Tooltip / title text */
  title?: string;
}

function CapBadge({ label, active, title }: CapBadgeProps) {
  if (!active) return null;
  return (
    <span
      title={title}
      className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
    >
      {label}
    </span>
  );
}

export function ThinkingBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      title="Extended Thinking / Reasoning"
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      Thinking
    </span>
  );
}

export function ReasoningBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      title="Reasoning Model (chain-of-thought)"
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      Reasoning
    </span>
  );
}

// ---------------------------------------------------------------------------
// Capability badges row
// ---------------------------------------------------------------------------

export function CapabilityBadges({ model, compact = false }: { model: ModelInfo; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      <ThinkingBadge active={model.supportsThinking} />
      <ReasoningBadge active={model.reasoning && !model.supportsThinking} />
      <CapBadge label="Tools" active={model.supportsTools} title="Function calling / tool use" />
      {!compact && (
        <>
          <CapBadge label="Vision" active={model.supportsMultimodal} title="Image input support" />
          <CapBadge label="Structured" active={model.supportsStructuredOutput} title="JSON structured output" />
          <CapBadge label="Streaming" active={model.supportsStreaming} title="Streaming responses" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input/Output modality badges
// ---------------------------------------------------------------------------

const MODALITY_ICONS: Record<Modality, string> = {
  text: "Aa",
  image: "IMG",
  audio: "AUD",
  video: "VID",
  pdf: "PDF",
};

export function ModalityBadges({ modalities, direction }: { modalities: Modality[]; direction: "in" | "out" }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] mr-0.5">
        {direction === "in" ? "In" : "Out"}:
      </span>
      {modalities.map((mod) => (
        <span
          key={mod}
          className="text-[10px] px-1 py-0 rounded bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)]"
        >
          {MODALITY_ICONS[mod] || mod}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context window indicator bar
// ---------------------------------------------------------------------------

export function ContextWindowBar({ contextWindow, maxOutput }: { contextWindow: number; maxOutput: number }) {
  // Relative output fraction of context window
  const outputPct = Math.min((maxOutput / contextWindow) * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>Context: {formatTokenCount(contextWindow)} tokens</span>
        <span>Output: {formatTokenCount(maxOutput)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--color-surface-overlay)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: `${outputPct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing display
// ---------------------------------------------------------------------------

export function PricingDisplay({ model, compact = false }: { model: ModelInfo; compact?: boolean }) {
  if (model.costTier === "free") {
    return <span className="text-[10px] text-green-400 font-medium">Free</span>;
  }

  if (compact) {
    return (
      <span className="text-[10px] text-[var(--color-text-muted)]">
        {formatCost(model.costPerMillionInput)} / {formatCost(model.costPerMillionOutput)} per 1M
      </span>
    );
  }

  return (
    <div className="text-[10px] text-[var(--color-text-muted)] space-y-0.5">
      <div className="flex justify-between">
        <span>Input:</span>
        <span className="text-[var(--color-text-secondary)]">{formatCost(model.costPerMillionInput)} / 1M tokens</span>
      </div>
      <div className="flex justify-between">
        <span>Output:</span>
        <span className="text-[var(--color-text-secondary)]">{formatCost(model.costPerMillionOutput)} / 1M tokens</span>
      </div>
      {model.cacheCostRead !== undefined && (
        <div className="flex justify-between">
          <span>Cache read:</span>
          <span className="text-[var(--color-text-secondary)]">{formatCost(model.cacheCostRead)} / 1M</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge cutoff display
// ---------------------------------------------------------------------------

export function KnowledgeCutoff({ date }: { date?: string }) {
  if (!date) return null;
  return (
    <span className="text-[10px] text-[var(--color-text-muted)]" title="Knowledge cutoff date">
      Cutoff: {date}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Full Model Card (for the "Supported Providers" catalog)
// ---------------------------------------------------------------------------

export function ModelCard({ model, showPricing = true }: { model: ModelInfo; showPricing?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--color-surface-overlay)] border border-[var(--color-border)] space-y-2.5">
      {/* Header: name + cost tier */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-white truncate" title={model.id}>{model.name}</h4>
          <p className="text-[10px] text-[var(--color-text-muted)] font-mono truncate">{model.id}</p>
        </div>
        <CostTierBadge tier={model.costTier} />
      </div>

      {/* Capabilities */}
      <CapabilityBadges model={model} />

      {/* Context window */}
      <ContextWindowBar contextWindow={model.contextWindow} maxOutput={model.maxOutput} />

      {/* Modalities */}
      <div className="flex gap-3">
        <ModalityBadges modalities={model.inputModalities} direction="in" />
        <ModalityBadges modalities={model.outputModalities} direction="out" />
      </div>

      {/* Pricing */}
      {showPricing && <PricingDisplay model={model} />}

      {/* Cutoff */}
      {model.knowledgeCutoff && <KnowledgeCutoff date={model.knowledgeCutoff} />}
    </div>
  );
}
