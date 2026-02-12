"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";
import {
  CapabilityBadges,
  CostTierBadge,
  PricingDisplay,
  formatTokenCount,
} from "@/components/ModelBadges";

interface CatalogProvider {
  id: string;
  displayName: string;
  models: ModelInfo[];
}

interface ProviderRuntimeConfig {
  providerId?: string;
  models_dev_provider_id?: string;
}

interface ProvidersListProps {
  providers: Provider[];
}

export function ProvidersList({ providers }: ProvidersListProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string } | null>(null);
  const [catalog, setCatalog] = useState<Record<string, CatalogProvider>>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await fetch("/api/providers/catalog", { cache: "no-store" });
      const data = await res.json();
      const providersList = (data.providers || []) as CatalogProvider[];

      if (cancelled) return;

      const mapped = providersList.reduce<Record<string, CatalogProvider>>((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {});

      setCatalog(mapped);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this provider?")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (id: number) => {
    await fetch(`/api/providers/${id}/default`, { method: "POST" });
    router.refresh();
  };

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    await fetch(`/api/providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !currentActive }),
    });
    router.refresh();
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    setTestResult(null);

    try {
      const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
      const data = await res.json();

      setTestResult({
        id,
        success: data.success,
        message: data.success ? `Connected (${data.latencyMs}ms)` : data.error || "Failed",
      });
    } catch {
      setTestResult({ id, success: false, message: "Test failed" });
    } finally {
      setTestingId(false as unknown as null);
    }
  };

  const parseConfig = (raw: string | null): ProviderRuntimeConfig => {
    if (!raw) return {};

    try {
      return JSON.parse(raw) as ProviderRuntimeConfig;
    } catch {
      return {};
    }
  };

  // Look up model info from dynamic catalog
  function getModelInfo(providerName: string, modelId: string) {
    const providerInfo = catalog[providerName];
    if (!providerInfo) return null;
    return providerInfo.models.find((m) => m.id === modelId) || null;
  }

  return (
    <div className="space-y-4">
      {providers.map((provider) => {
        const runtimeConfig = parseConfig(provider.config);
        const providerLookupId =
          runtimeConfig.models_dev_provider_id || runtimeConfig.providerId || provider.name;
        const modelInfo = getModelInfo(providerLookupId, provider.model);
        const isTestingThis = testingId === provider.id;
        const testResultForThis = testResult?.id === provider.id ? testResult : null;

        return (
          <div
            key={provider.id}
            className={`bg-[var(--color-surface-raised)] border rounded-lg overflow-hidden ${
              provider.is_default ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
            }`}
          >
            {/* Main row */}
            <div className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  {/* Avatar */}
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
                      provider.is_active
                        ? "bg-[var(--color-accent)] text-black"
                        : "bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)]"
                    }`}
                  >
                    <span className="text-lg font-bold">
                      {provider.display_name.charAt(0)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Name + badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{provider.display_name}</h3>
                      {provider.is_default && (
                        <span className="text-[10px] px-2 py-0.5 bg-[var(--color-accent-dim)] text-[var(--color-accent)] rounded font-medium">
                          Default
                        </span>
                      )}
                      {!provider.is_active && (
                        <span className="text-[10px] px-2 py-0.5 bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] rounded">
                          Disabled
                        </span>
                      )}
                      {modelInfo && <CostTierBadge tier={modelInfo.costTier} />}
                    </div>

                    {/* Model ID */}
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      Model: <span className="text-[var(--color-text-primary)] font-mono text-xs">{provider.model}</span>
                      {modelInfo && modelInfo.name !== provider.model && (
                        <span className="text-[var(--color-text-muted)] ml-1">({modelInfo.name})</span>
                      )}
                    </p>

                    {/* Capabilities row */}
                    {modelInfo && (
                      <div className="mt-2">
                        <CapabilityBadges model={modelInfo} />
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)] flex-wrap">
                      {modelInfo ? (
                        <>
                          <span>Context: <span className="text-[var(--color-text-secondary)]">{formatTokenCount(modelInfo.contextWindow)}</span></span>
                          <span>Max Output: <span className="text-[var(--color-text-secondary)]">{formatTokenCount(modelInfo.maxOutput)}</span></span>
                          {modelInfo.knowledgeCutoff && (
                            <span>Cutoff: <span className="text-[var(--color-text-secondary)]">{modelInfo.knowledgeCutoff}</span></span>
                          )}
                        </>
                      ) : (
                        <>
                          <span>Max Tokens: {provider.max_tokens}</span>
                          <span>Temperature: {provider.temperature}</span>
                        </>
                      )}
                      <span>Priority: {provider.priority}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleTest(provider.id)}
                    disabled={isTestingThis}
                    className="px-3 py-1.5 text-xs bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white rounded transition-colors disabled:opacity-50"
                  >
                    {isTestingThis ? "Testing..." : "Test"}
                  </button>
                  {!provider.is_default && (
                    <button
                      onClick={() => handleSetDefault(provider.id)}
                      className="px-3 py-1.5 text-xs bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white rounded transition-colors"
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    onClick={() => handleToggleActive(provider.id, !!provider.is_active)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      provider.is_active
                        ? "text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20"
                        : "text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20"
                    }`}
                  >
                    {provider.is_active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDelete(provider.id)}
                    disabled={deletingId === provider.id}
                    className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
                  >
                    {deletingId === provider.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>

              {/* Test result toast */}
              {testResultForThis && (
                <div
                  className={`mt-3 px-3 py-2 rounded text-xs flex items-center gap-2 ${
                    testResultForThis.success
                      ? "bg-green-500/10 border border-green-500/20 text-green-400"
                      : "bg-red-500/10 border border-red-500/20 text-red-400"
                  }`}
                >
                  <span>{testResultForThis.success ? "OK" : "ERR"}</span>
                  <span>{testResultForThis.message}</span>
                </div>
              )}
            </div>

            {/* Pricing footer (if model info available) */}
            {modelInfo && (modelInfo.costPerMillionInput !== undefined || modelInfo.costPerMillionOutput !== undefined) && (
              <div className="border-t border-[var(--color-border)] px-5 py-3 bg-[var(--color-surface)] flex items-center gap-6">
                <PricingDisplay model={modelInfo} compact />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
