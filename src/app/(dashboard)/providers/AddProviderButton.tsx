"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_INFO, type ProviderName, type ModelInfo } from "@/agent/provider-info";
import {
  CapabilityBadges,
  CostTierBadge,
  ContextWindowBar,
  PricingDisplay,
  KnowledgeCutoff,
  formatTokenCount,
} from "@/components/ModelBadges";

interface AddProviderButtonProps {
  variant?: "default" | "primary";
}

export function AddProviderButton({ variant = "default" }: AddProviderButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "openai" as ProviderName,
    display_name: "OpenAI",
    api_key: "",
    base_url: "",
    model: "gpt-4o",
    max_tokens: 4096,
    temperature: 0.7,
    is_default: false,
    priority: 0,
  });

  // Look up the selected model's info from the provider registry
  const selectedModelInfo: ModelInfo | undefined = useMemo(() => {
    const provider = PROVIDER_INFO[formData.name];
    if (!provider) return undefined;
    return provider.models.find((m) => m.id === formData.model);
  }, [formData.name, formData.model]);

  const handleProviderChange = (name: ProviderName) => {
    const info = PROVIDER_INFO[name];
    const firstModel = info.models[0];
    setFormData((prev) => ({
      ...prev,
      name,
      display_name: info.displayName,
      model: firstModel.id,
      base_url: name === "ollama" ? "http://localhost:11434/v1" : "",
      // Auto-set sensible defaults based on model capabilities
      max_tokens: firstModel.maxOutput,
      temperature: firstModel.allowsTemperature ? 0.7 : 0,
    }));
  };

  const handleModelChange = (modelId: string) => {
    const provider = PROVIDER_INFO[formData.name];
    const model = provider.models.find((m) => m.id === modelId);
    setFormData((prev) => ({
      ...prev,
      model: modelId,
      // Auto-set max_tokens and temperature from model capabilities
      max_tokens: model?.maxOutput ?? prev.max_tokens,
      temperature: model?.allowsTemperature === false ? 0 : prev.temperature,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to add provider");
        return;
      }

      setIsOpen(false);
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const buttonClass =
    variant === "primary"
      ? "px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded transition-all"
      : "flex items-center gap-2 px-4 py-2 bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] rounded transition-colors";

  return (
    <>
      <button onClick={() => setIsOpen(true)} className={buttonClass}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Provider
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
              <h2 className="text-xl font-semibold text-white font-[var(--font-mono)]">Add Provider</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-[var(--color-text-secondary)] hover:text-white rounded hover:bg-[var(--color-border)] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Provider</label>
                <select
                  value={formData.name}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                    <option key={key} value={key}>
                      {info.displayName}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {PROVIDER_INFO[formData.name].description}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Model</label>
                <select
                  value={formData.model}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  {PROVIDER_INFO[formData.name].models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} {model.reasoning ? "(reasoning)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* --- Model info panel --- */}
              {selectedModelInfo && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-overlay)] p-3.5 space-y-3">
                  {/* Row 1: name + cost tier */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-white">{selectedModelInfo.name}</span>
                      <span className="ml-2 text-[10px] text-[var(--color-text-muted)] font-mono">{selectedModelInfo.id}</span>
                    </div>
                    <CostTierBadge tier={selectedModelInfo.costTier} />
                  </div>

                  {/* Row 2: capability badges */}
                  <CapabilityBadges model={selectedModelInfo} />

                  {/* Row 3: context window bar */}
                  <ContextWindowBar
                    contextWindow={selectedModelInfo.contextWindow}
                    maxOutput={selectedModelInfo.maxOutput}
                  />

                  {/* Row 4: pricing + cutoff */}
                  <div className="flex items-start justify-between gap-4">
                    <PricingDisplay model={selectedModelInfo} compact />
                    <KnowledgeCutoff date={selectedModelInfo.knowledgeCutoff} />
                  </div>

                  {/* Hints for reasoning models */}
                  {!selectedModelInfo.allowsTemperature && (
                    <p className="text-[10px] text-amber-400/80 bg-amber-500/5 px-2 py-1 rounded">
                      Reasoning model — temperature is locked to 0 and max output is set to {formatTokenCount(selectedModelInfo.maxOutput)} tokens.
                    </p>
                  )}
                </div>
              )}

              {PROVIDER_INFO[formData.name].requiresKey && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">API Key</label>
                  <input
                    type="password"
                    value={formData.api_key}
                    onChange={(e) => setFormData((prev) => ({ ...prev, api_key: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    placeholder="sk-..."
                    required
                  />
                </div>
              )}

              {formData.name === "ollama" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Base URL</label>
                  <input
                    type="text"
                    value={formData.base_url}
                    onChange={(e) => setFormData((prev) => ({ ...prev, base_url: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    placeholder="http://localhost:11434/v1"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                    Max Tokens
                    {selectedModelInfo && (
                      <span className="ml-1 text-[10px] text-[var(--color-text-muted)] font-normal">
                        (max {formatTokenCount(selectedModelInfo.maxOutput)})
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={formData.max_tokens}
                    onChange={(e) => setFormData((prev) => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                    Temperature
                    {selectedModelInfo && !selectedModelInfo.allowsTemperature && (
                      <span className="ml-1 text-[10px] text-amber-400 font-normal">(locked)</span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    disabled={selectedModelInfo ? !selectedModelInfo.allowsTemperature : false}
                    onChange={(e) => setFormData((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={formData.is_default}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_default: e.target.checked }))}
                  className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-surface-overlay)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                />
                <label htmlFor="is_default" className="text-sm text-[var(--color-text-primary)]">
                  Set as default provider
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-[var(--color-text-secondary)] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded transition-colors disabled:opacity-50"
                >
                  {loading ? "Adding..." : "Add Provider"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
