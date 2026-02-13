"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelInfo } from "@/agent/provider-info";
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

interface CatalogProvider {
  id: string;
  displayName: string;
  requiresKey: boolean;
  description: string;
  npm: string;
  apiBaseUrl?: string;
  models: ModelInfo[];
  runtimeAdapter: string;
}

export function AddProviderButton({ variant = "default" }: AddProviderButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoadError, setCatalogLoadError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    display_name: "",
    api_key: "",
    base_url: "",
    model: "",
    max_tokens: null as number | null,
    temperature: 0.7,
    is_default: false,
    priority: 0,
    use_model_default_tokens: true,
    thinking_level: "medium" as "low" | "medium" | "high",
  });

  const selectedProvider = useMemo(
    () => catalog.find((provider) => provider.id === formData.name),
    [catalog, formData.name]
  );

  useEffect(() => {
    if (!isOpen || catalog.length > 0 || catalogLoading) return;

    let cancelled = false;
    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogLoadError("");
      try {
        const res = await fetch("/api/providers/catalog", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Catalog request failed (${res.status})`);
        }
        const data = await res.json();
        const providers = (data.providers || []) as CatalogProvider[];

        if (!cancelled) {
          setCatalog(providers);
          if (providers.length > 0) {
            const first = providers[0];
            const firstModel = first.models[0];
            setFormData((prev) => ({
              ...prev,
              name: first.id,
              display_name: first.displayName,
              model: firstModel?.id || "",
              base_url: first.apiBaseUrl || "",
              max_tokens: prev.use_model_default_tokens
                ? null
                : (firstModel?.maxOutput ?? prev.max_tokens),
              temperature: firstModel?.allowsTemperature === false ? 0 : prev.temperature,
            }));
          }
        }
      } catch {
        if (!cancelled) {
          setCatalogLoadError("Failed to load provider catalog. Please retry.");
          setError("Failed to load provider catalog");
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    };

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [isOpen, catalog.length, catalogLoading]);

  const retryCatalogLoad = async () => {
    setCatalog([]);
    setCatalogLoadError("");
    setCatalogLoading(false);
  };

  // Look up the selected model's info from the provider registry
  const selectedModelInfo: ModelInfo | undefined = useMemo(() => {
    const provider = selectedProvider;
    if (!provider) return undefined;
    return provider.models.find((m) => m.id === formData.model);
  }, [selectedProvider, formData.model]);

  const handleProviderChange = (name: string) => {
    const info = catalog.find((p) => p.id === name);
    if (!info) return;
    const firstModel = info.models[0];

    setFormData((prev) => ({
      ...prev,
      name,
      display_name: info.displayName,
      model: firstModel?.id || "",
      base_url: info.apiBaseUrl || "",
      // Auto-set sensible defaults based on model capabilities
      max_tokens: prev.use_model_default_tokens
        ? null
        : (firstModel?.maxOutput ?? prev.max_tokens),
      temperature: firstModel?.allowsTemperature === false ? 0 : 0.7,
    }));
  };

  const handleModelChange = (modelId: string) => {
    const provider = selectedProvider;
    if (!provider) return;
    const model = provider.models.find((m) => m.id === modelId);
    setFormData((prev) => ({
      ...prev,
      model: modelId,
      // Auto-set max_tokens and temperature from model capabilities
      max_tokens: prev.use_model_default_tokens
        ? null
        : (model?.maxOutput ?? prev.max_tokens),
      temperature: model?.allowsTemperature === false ? 0 : prev.temperature,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const providerConfig = selectedProvider
        ? {
            models_dev_provider_id: selectedProvider.id,
            provider_npm: selectedProvider.npm,
            runtime_adapter: selectedProvider.runtimeAdapter,
            thinking_level:
              selectedModelInfo?.supportsThinking || selectedModelInfo?.reasoning
                ? formData.thinking_level
                : undefined,
          }
        : undefined;

      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          config: providerConfig,
        }),
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
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  disabled={catalogLoading || catalog.length === 0}
                >
                  {catalog.map((info) => (
                    <option key={info.id} value={info.id}>
                      {info.displayName}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {catalogLoading
                    ? "Loading providers from models.dev…"
                    : selectedProvider?.description || catalogLoadError || ""}
                </p>
                {!catalogLoading && catalogLoadError && (
                  <button
                    type="button"
                    onClick={retryCatalogLoad}
                    className="mt-2 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-light)] underline"
                  >
                    Retry loading catalog
                  </button>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Model</label>
                {selectedProvider && selectedProvider.models.length === 0 ? (
                  <>
                    <input
                      type="text"
                      value={formData.model}
                      onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      placeholder="Enter model id (manual)"
                      required
                    />
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      No models were returned for this provider. You can still add it by typing a model id manually.
                    </p>
                  </>
                ) : (
                  <select
                    value={formData.model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    disabled={!selectedProvider || selectedProvider.models.length === 0}
                  >
                    {(selectedProvider?.models || []).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} {model.reasoning ? "(reasoning)" : ""}
                      </option>
                    ))}
                  </select>
                )}
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

                  {(selectedModelInfo.supportsThinking || selectedModelInfo.reasoning) && (
                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5">
                      <label className="block text-xs font-medium text-amber-300 mb-1">
                        Thinking level
                      </label>
                      <select
                        value={formData.thinking_level}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            thinking_level: e.target.value as "low" | "medium" | "high",
                          }))
                        }
                        className="w-full px-3 py-2 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      >
                        <option value="low">Low (faster)</option>
                        <option value="medium">Medium</option>
                        <option value="high">High (deeper reasoning)</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              {selectedProvider?.requiresKey && (
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

              {selectedProvider && (selectedProvider.id === "ollama" || selectedProvider.runtimeAdapter === "openai-compatible") && (
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
                    Max Tokens (optional)
                    {selectedModelInfo && (
                      <span className="ml-1 text-[10px] text-[var(--color-text-muted)] font-normal">
                        (max {formatTokenCount(selectedModelInfo.maxOutput)})
                      </span>
                    )}
                  </label>
                  <label className="inline-flex items-center gap-2 mb-2 text-xs text-[var(--color-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={formData.use_model_default_tokens}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          use_model_default_tokens: e.target.checked,
                          max_tokens: e.target.checked
                            ? null
                            : (selectedModelInfo?.maxOutput ?? prev.max_tokens ?? 4096),
                        }))
                      }
                      className="rounded"
                    />
                    Use model default limit
                  </label>
                  <input
                    type="number"
                    value={formData.max_tokens ?? ""}
                    disabled={formData.use_model_default_tokens}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      setFormData((prev) => ({
                        ...prev,
                        max_tokens: Number.isFinite(parsed) ? parsed : null,
                      }));
                    }}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    placeholder="Leave empty to use model default"
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
                  disabled={loading || catalogLoading || !formData.name || !formData.model}
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
