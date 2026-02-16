"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Star, Power, FlaskConical, Pencil } from "lucide-react";
import type { Provider } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";
import {
  CapabilityBadges,
  CostTierBadge,
  PricingDisplay,
  formatTokenCount,
} from "@/components/ModelBadges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";

interface ProviderRuntimeConfig {
  providerId?: string;
  models_dev_provider_id?: string;
  thinking_level?: "low" | "medium" | "high";
}

interface ProvidersListProps {
  providers: Provider[];
}

function ProviderCardSkeleton() {
  return (
    <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <div className="flex gap-2 mt-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-3 w-80 mt-2" />
        </div>
      </div>
    </div>
  );
}

export { ProviderCardSkeleton };

export function ProvidersList({ providers }: ProvidersListProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string } | null>(null);

  const { data: catalog = [] } = trpc.providers.catalog.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const catalogMap = useMemo(() => {
    const map: Record<string, any> = {};
    for (const item of catalog) {
      map[item.id] = item;
    }
    return map;
  }, [catalog]);

  const deleteMutation = trpc.providers.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.providers.list.cancel();
      const prev = utils.providers.list.getData();
      utils.providers.list.setData(undefined, (old) =>
        (old ?? []).filter((p) => p.id !== id)
      );
      return { prev };
    },
    onSuccess: (_data, { id }) => {
      toast.success("Provider deleted");
      router.refresh();
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) utils.providers.list.setData(undefined, ctx.prev);
      toast.error("Failed to delete provider", { description: err.message });
    },
  });

  const setDefaultMutation = trpc.providers.setDefault.useMutation({
    onSuccess: () => {
      toast.success("Default provider updated");
      utils.providers.list.invalidate();
      router.refresh();
    },
    onError: (err) => {
      toast.error("Failed to set default", { description: err.message });
    },
  });

  const toggleActiveMutation = trpc.providers.update.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(vars.is_active ? "Provider enabled" : "Provider disabled");
      utils.providers.list.invalidate();
      router.refresh();
    },
    onError: (err) => {
      toast.error("Failed to toggle provider", { description: err.message });
    },
  });

  const handleDelete = (id: number) => {
    if (!confirm("Are you sure you want to delete this provider?")) return;
    deleteMutation.mutate({ id });
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    setTestResult(null);

    try {
      const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
      const data = await res.json();

      const result = {
        id,
        success: data.success,
        message: data.success ? `Connected (${data.latencyMs}ms)` : data.error || "Failed",
      };
      setTestResult(result);

      if (data.success) {
        toast.success("Connection test passed", { description: `${data.latencyMs}ms` });
      } else {
        toast.error("Connection test failed", { description: data.error || "Unknown error" });
      }
    } catch {
      setTestResult({ id, success: false, message: "Test failed" });
      toast.error("Connection test failed");
    } finally {
      setTestingId(null);
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

  function getModelInfo(providerName: string, modelId: string) {
    const providerInfo = catalogMap[providerName];
    if (!providerInfo) return null;
    return providerInfo.models.find((m: ModelInfo) => m.id === modelId) || null;
  }

  return (
    <div className="space-y-4">
      {providers.map((provider, index) => {
        const runtimeConfig = parseConfig(provider.config);
        const providerLookupId =
          runtimeConfig.models_dev_provider_id || runtimeConfig.providerId || provider.name;
        const modelInfo = getModelInfo(providerLookupId, provider.model);
        const isTestingThis = testingId === provider.id;
        const isDeletingThis = deleteMutation.isPending && deleteMutation.variables?.id === provider.id;

        return (
          <div
            key={provider.id}
            className={`stagger-item card-hover bg-[var(--color-surface-raised)] border rounded-lg overflow-hidden ${
              provider.is_default ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
            }`}
          >
            {/* Main row */}
            <div className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  {/* Avatar */}
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
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
                          {(modelInfo.supportsThinking || modelInfo.reasoning) && runtimeConfig.thinking_level && (
                            <span>
                              Thinking: <span className="text-amber-400 uppercase">{runtimeConfig.thinking_level}</span>
                            </span>
                          )}
                          {modelInfo.knowledgeCutoff && (
                            <span>Cutoff: <span className="text-[var(--color-text-secondary)]">{modelInfo.knowledgeCutoff}</span></span>
                          )}
                        </>
                      ) : (
                        <>
                          <span>
                            Max Tokens: {provider.max_tokens ?? "model default"}
                          </span>
                          <span>Temperature: {provider.temperature}</span>
                        </>
                      )}
                      <span>Priority: {provider.priority}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(provider.id)}
                    disabled={isTestingThis}
                    className="interactive"
                  >
                    {isTestingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    {isTestingThis ? "Testing..." : "Test"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    asChild
                    className="interactive"
                  >
                    <a href={`/providers/${provider.id}/edit`}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </a>
                  </Button>
                  {!provider.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDefaultMutation.mutate({ id: provider.id })}
                      className="interactive"
                    >
                      <Star className="h-3.5 w-3.5" />
                      Default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActiveMutation.mutate({ id: provider.id, is_active: !provider.is_active })}
                    className={`interactive ${
                      provider.is_active
                        ? "text-yellow-400 hover:text-yellow-300"
                        : "text-green-400 hover:text-green-300"
                    }`}
                  >
                    <Power className="h-3.5 w-3.5" />
                    {provider.is_active ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(provider.id)}
                    disabled={isDeletingThis}
                    className="interactive text-red-400 hover:text-red-300"
                  >
                    {isDeletingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </div>
              </div>
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
