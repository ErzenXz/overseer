"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ModelInfo } from "@/agent/provider-info";
import {
  CapabilityBadges,
  CostTierBadge,
  ContextWindowBar,
  PricingDisplay,
  KnowledgeCutoff,
  formatTokenCount,
} from "@/components/ModelBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";

interface AddProviderButtonProps {
  variant?: "default" | "primary";
}

export function AddProviderButton({ variant = "default" }: AddProviderButtonProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    display_name: "",
    api_key: "",
    base_url: "",
    model: "",
    temperature: 0.7,
    is_default: false,
    priority: 0,
    thinking_level: "medium" as "low" | "medium" | "high",
  });

  const {
    data: catalog = [],
    isLoading: catalogLoading,
    error: catalogError,
    refetch: retryCatalog,
  } = trpc.providers.catalog.useQuery(undefined, {
    enabled: isOpen,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Auto-select the first provider when catalog loads
  const catalogReady = catalog.length > 0;
  const needsInit = catalogReady && !formData.name;
  if (needsInit) {
    const first = catalog[0];
    const firstModel = first.models[0];
    setFormData((prev) => ({
      ...prev,
      name: first.id,
      display_name: first.displayName,
      model: firstModel?.id || "",
      base_url: (first as any).apiBaseUrl || "",
      temperature: firstModel?.allowsTemperature === false ? 0 : prev.temperature,
    }));
  }

  const selectedProvider = useMemo(
    () => catalog.find((provider: any) => provider.id === formData.name),
    [catalog, formData.name]
  ) as any;

  const selectedModelInfo: ModelInfo | undefined = useMemo(() => {
    if (!selectedProvider) return undefined;
    return selectedProvider.models.find((m: ModelInfo) => m.id === formData.model);
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
      temperature: firstModel?.allowsTemperature === false ? 0 : 0.7,
    }));
  };

  const handleModelChange = (modelId: string) => {
    if (!selectedProvider) return;
    const model = selectedProvider.models.find((m: any) => m.id === modelId);
    setFormData((prev) => ({
      ...prev,
      model: modelId,
      temperature: model?.allowsTemperature === false ? 0 : prev.temperature,
    }));
  };

  const addMutation = trpc.providers.create.useMutation({
    onMutate: async (newProvider) => {
      // Optimistic update: add a placeholder to the providers list
      await utils.providers.list.cancel();
      const prev = utils.providers.list.getData();
      utils.providers.list.setData(undefined, (old) => [
        ...(old ?? []),
        {
          id: -Date.now(),
          name: newProvider.name,
          display_name: newProvider.display_name,
          model: newProvider.model,
          temperature: newProvider.temperature,
          is_active: 1,
          is_default: newProvider.is_default ? 1 : 0,
          priority: newProvider.priority,
          base_url: newProvider.base_url ?? null,
          api_key_encrypted: newProvider.api_key ? "***" : null,
          config: newProvider.config ? JSON.stringify(newProvider.config) : null,
          max_tokens: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any,
      ]);
      return { prev };
    },
    onSuccess: () => {
      setIsOpen(false);
      setError("");
      toast.success("Provider added", { description: `${formData.display_name} is ready to use.` });
      utils.providers.list.invalidate();
      router.refresh();
    },
    onError: (err, _vars, ctx) => {
      // Rollback optimistic update
      if (ctx?.prev) utils.providers.list.setData(undefined, ctx.prev);
      const msg = err.message || "An error occurred";
      setError(msg);
      toast.error("Failed to add provider", { description: msg });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

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

    addMutation.mutate({
      name: formData.name,
      display_name: formData.display_name,
      api_key: formData.api_key || undefined,
      base_url: formData.base_url || undefined,
      model: formData.model,
      temperature: formData.temperature,
      is_default: formData.is_default,
      priority: formData.priority,
      config: providerConfig as Record<string, unknown> | undefined,
    });
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setError("");
      setFormData({
        name: "",
        display_name: "",
        api_key: "",
        base_url: "",
        model: "",
        temperature: 0.7,
        is_default: false,
        priority: 0,
        thinking_level: "medium",
      });
    }
  };

  const catalogErrorMsg = catalogError?.message ?? "";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <Button
        variant={variant === "primary" ? "default" : "secondary"}
        onClick={() => setIsOpen(true)}
      >
        <Plus className="h-4 w-4" />
        Add Provider
      </Button>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[var(--font-mono)]">Add Provider</DialogTitle>
          <DialogDescription>
            Configure a new LLM provider and model for your AI agent.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Provider Select */}
          <div className="space-y-2">
            <Label>Provider</Label>
            {catalogLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-3 w-48" />
              </div>
            ) : catalogErrorMsg ? (
              <div className="space-y-2">
                <p className="text-xs text-red-400">{catalogErrorMsg}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => retryCatalog()}
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </Button>
              </div>
            ) : (
              <Select
                value={formData.name}
                onValueChange={handleProviderChange}
                disabled={catalog.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((info) => (
                    <SelectItem key={info.id} value={info.id}>
                      {info.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedProvider && (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {selectedProvider.description}
              </p>
            )}
          </div>

          {/* Model Select */}
          <div className="space-y-2">
            <Label>Model</Label>
            {selectedProvider && selectedProvider.models.length === 0 ? (
              <>
                <Input
                  value={formData.model}
                  onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="Enter model id (manual)"
                  required
                />
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  No models were returned for this provider. You can still add it by typing a model id manually.
                </p>
              </>
            ) : (
              <Select
                value={formData.model}
                onValueChange={handleModelChange}
                disabled={!selectedProvider || selectedProvider.models.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {(selectedProvider?.models || []).map((model: any) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name} {model.reasoning ? "(reasoning)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1">
                  <Label className="text-xs text-amber-300">Thinking level</Label>
                  <Select
                    value={formData.thinking_level}
                    onValueChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        thinking_level: v as "low" | "medium" | "high",
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low (faster)</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High (deeper reasoning)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* API Key */}
          {selectedProvider?.requiresKey && (
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData((prev) => ({ ...prev, api_key: e.target.value }))}
                placeholder="sk-..."
                required
              />
            </div>
          )}

          {/* Base URL */}
          {selectedProvider && (selectedProvider.id === "ollama" || selectedProvider.runtimeAdapter === "openai-compatible") && (
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input
                type="text"
                value={formData.base_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, base_url: e.target.value }))}
                placeholder="http://localhost:11434/v1"
              />
            </div>
          )}

          {/* Temperature */}
          <div className="space-y-2">
            <Label>
              Temperature
              {selectedModelInfo && !selectedModelInfo.allowsTemperature && (
                <span className="ml-1 text-[10px] text-amber-400 font-normal">(locked)</span>
              )}
            </Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={formData.temperature}
              disabled={selectedModelInfo ? !selectedModelInfo.allowsTemperature : false}
              onChange={(e) => setFormData((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
            />
          </div>

          {/* Default Provider Checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="is_default"
              checked={formData.is_default}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, is_default: checked === true }))
              }
            />
            <Label htmlFor="is_default" className="font-normal cursor-pointer">
              Set as default provider
            </Label>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={addMutation.isPending || catalogLoading || !formData.name || !formData.model}
            >
              {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {addMutation.isPending ? "Adding..." : "Add Provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
