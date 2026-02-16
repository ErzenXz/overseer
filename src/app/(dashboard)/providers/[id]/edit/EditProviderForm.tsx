"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Provider } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";

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

interface ProviderRuntimeConfig {
  providerId?: string;
  models_dev_provider_id?: string;
  provider_npm?: string;
  runtime_adapter?: string;
  thinking_level?: "low" | "medium" | "high";
}

interface EditProviderFormProps {
  provider: Provider;
}

function parseRuntimeConfig(raw: string | null): ProviderRuntimeConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ProviderRuntimeConfig;
  } catch {
    return {};
  }
}

export function EditProviderForm({ provider }: EditProviderFormProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [error, setError] = useState("");

  const initialConfig = useMemo(() => parseRuntimeConfig(provider.config), [provider.config]);

  const [formData, setFormData] = useState(() => ({
    display_name: provider.display_name,
    api_key: "",
    base_url: provider.base_url ?? "",
    provider_name:
      initialConfig.models_dev_provider_id || initialConfig.providerId || provider.name,
    model: provider.model,
    temperature: provider.temperature,
    is_active: Boolean(provider.is_active),
    is_default: Boolean(provider.is_default),
    priority: provider.priority,
    thinking_level: (initialConfig.thinking_level ?? "medium") as "low" | "medium" | "high",
  }));

  const {
    data: catalog = [],
    isLoading: catalogLoading,
    error: catalogError,
    refetch: retryCatalog,
  } = trpc.providers.catalog.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const catalogErrorMsg = catalogError
    ? `${catalogError.message}. You can still update manually.`
    : "";

  const selectedProvider = useMemo(
    () => catalog.find((entry) => entry.id === formData.provider_name),
    [catalog, formData.provider_name],
  );

  const selectedModelInfo = useMemo(() => {
    if (!selectedProvider) return undefined;
    return selectedProvider.models.find((model: any) => model.id === formData.model);
  }, [selectedProvider, formData.model]);

  const showReasoningControls = Boolean(
    selectedModelInfo?.supportsThinking || selectedModelInfo?.reasoning,
  );

  const handleProviderChange = (providerName: string) => {
    const nextProvider = catalog.find((entry) => entry.id === providerName);
    const firstModel = nextProvider?.models[0];

    setFormData((prev) => ({
      ...prev,
      provider_name: providerName,
      model: firstModel?.id ?? prev.model,
      base_url: nextProvider?.apiBaseUrl ?? prev.base_url,
      temperature: firstModel?.allowsTemperature === false ? 0 : prev.temperature,
    }));
  };

  const handleModelChange = (modelId: string) => {
    const model = selectedProvider?.models.find((entry: any) => entry.id === modelId);

    setFormData((prev) => ({
      ...prev,
      model: modelId,
      temperature: model?.allowsTemperature === false ? 0 : prev.temperature,
    }));
  };

  const saveMutation = trpc.providers.update.useMutation({
    onSuccess: () => {
      toast.success("Provider updated", { description: `${formData.display_name} saved.` });
      utils.providers.list.invalidate();
      router.push("/providers");
      router.refresh();
    },
    onError: (err) => {
      const msg = err.message || "Failed to update provider";
      setError(msg);
      toast.error("Failed to update provider", { description: msg });
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    const existingConfig = parseRuntimeConfig(provider.config);
    const mergedConfig: Record<string, unknown> = { ...existingConfig };

    if (selectedProvider) {
      mergedConfig.models_dev_provider_id = (selectedProvider as any).id;
      mergedConfig.provider_npm = (selectedProvider as any).npm;
      mergedConfig.runtime_adapter = (selectedProvider as any).runtimeAdapter;
    }

    if (showReasoningControls) {
      mergedConfig.thinking_level = formData.thinking_level;
    } else {
      delete mergedConfig.thinking_level;
    }

    saveMutation.mutate({
      id: provider.id,
      name: (selectedProvider as any)?.runtimeAdapter ?? provider.name,
      display_name: formData.display_name,
      api_key: formData.api_key || undefined,
      base_url: formData.base_url || undefined,
      model: formData.model,
      temperature: formData.temperature,
      is_active: formData.is_active,
      is_default: formData.is_default,
      priority: formData.priority,
      config: mergedConfig,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {catalogErrorMsg && (
        <div className="flex items-start gap-2 text-sm text-amber-300">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{catalogErrorMsg}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => retryCatalog()}>
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Display name</Label>
          <Input
            value={formData.display_name}
            onChange={(e) => setFormData((prev) => ({ ...prev, display_name: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Provider</Label>
          {catalogLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select
              value={formData.provider_name}
              onValueChange={handleProviderChange}
              disabled={catalog.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Model</Label>
        {selectedProvider ? (
          <Select
            value={formData.model}
            onValueChange={handleModelChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {selectedProvider.models.map((model: any) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name} {model.reasoning ? "(reasoning)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={formData.model}
            onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
            required
          />
        )}
      </div>

      <div className="space-y-2">
        <Label>Base URL (optional)</Label>
        <Input
          value={formData.base_url}
          onChange={(e) => setFormData((prev) => ({ ...prev, base_url: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label>API key (leave blank to keep current)</Label>
        <Input
          value={formData.api_key}
          onChange={(e) => setFormData((prev) => ({ ...prev, api_key: e.target.value }))}
          type="password"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, temperature: Number.parseFloat(e.target.value) }))
            }
            disabled={selectedModelInfo ? !selectedModelInfo.allowsTemperature : false}
          />
        </div>

        {showReasoningControls ? (
          <div className="space-y-2">
            <Label>Thinking level</Label>
            <Select
              value={formData.thinking_level}
              onValueChange={(v) =>
                setFormData((prev) => ({
                  ...prev,
                  thinking_level: v as "low" | "medium" | "high",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="text-xs text-[var(--color-text-muted)] self-end pb-2">Selected model has no reasoning controls.</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Priority</Label>
          <Input
            type="number"
            value={formData.priority}
            onChange={(e) => setFormData((prev) => ({ ...prev, priority: Number.parseInt(e.target.value, 10) || 0 }))}
          />
        </div>

        <div className="flex items-center gap-2 mt-7">
          <Checkbox
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({ ...prev, is_active: checked === true }))
            }
          />
          <Label htmlFor="is_active" className="font-normal cursor-pointer">Active</Label>
        </div>

        <div className="flex items-center gap-2 mt-7">
          <Checkbox
            id="is_default"
            checked={formData.is_default}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({ ...prev, is_default: checked === true }))
            }
          />
          <Label htmlFor="is_default" className="font-normal cursor-pointer">Default</Label>
        </div>
      </div>

      <div className="pt-2 flex items-center gap-3">
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
