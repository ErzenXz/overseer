"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);

  const initialConfig = useMemo(() => parseRuntimeConfig(provider.config), [provider.config]);

  const [formData, setFormData] = useState(() => ({
    display_name: provider.display_name,
    api_key: "",
    base_url: provider.base_url ?? "",
    provider_name:
      initialConfig.models_dev_provider_id || initialConfig.providerId || provider.name,
    model: provider.model,
    max_tokens: provider.max_tokens,
    use_model_default_tokens: provider.max_tokens == null,
    temperature: provider.temperature,
    is_active: Boolean(provider.is_active),
    is_default: Boolean(provider.is_default),
    priority: provider.priority,
    thinking_level: (initialConfig.thinking_level ?? "medium") as "low" | "medium" | "high",
  }));

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError("");

      try {
        const res = await fetch("/api/providers/catalog", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Catalog request failed (${res.status})`);
        }

        const data = await res.json();
        const providers = (data.providers || []) as CatalogProvider[];

        if (!cancelled) {
          setCatalog(providers);
        }
      } catch {
        if (!cancelled) {
          setCatalogError("Failed to load provider catalog. You can still update manually.");
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
  }, []);

  const selectedProvider = useMemo(
    () => catalog.find((entry) => entry.id === formData.provider_name),
    [catalog, formData.provider_name],
  );

  const selectedModelInfo = useMemo(() => {
    if (!selectedProvider) return undefined;
    return selectedProvider.models.find((model) => model.id === formData.model);
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
      max_tokens: prev.use_model_default_tokens
        ? null
        : firstModel?.maxOutput ?? prev.max_tokens,
    }));
  };

  const handleModelChange = (modelId: string) => {
    const model = selectedProvider?.models.find((entry) => entry.id === modelId);

    setFormData((prev) => ({
      ...prev,
      model: modelId,
      temperature: model?.allowsTemperature === false ? 0 : prev.temperature,
      max_tokens: prev.use_model_default_tokens
        ? null
        : model?.maxOutput ?? prev.max_tokens,
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const existingConfig = parseRuntimeConfig(provider.config);
      const mergedConfig: Record<string, unknown> = {
        ...existingConfig,
      };

      if (selectedProvider) {
        mergedConfig.models_dev_provider_id = selectedProvider.id;
        mergedConfig.provider_npm = selectedProvider.npm;
        mergedConfig.runtime_adapter = selectedProvider.runtimeAdapter;
      }

      if (showReasoningControls) {
        mergedConfig.thinking_level = formData.thinking_level;
      } else {
        delete mergedConfig.thinking_level;
      }

      const res = await fetch(`/api/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedProvider?.runtimeAdapter ?? provider.name,
          display_name: formData.display_name,
          api_key: formData.api_key || undefined,
          base_url: formData.base_url || undefined,
          model: formData.model,
          max_tokens: formData.use_model_default_tokens ? null : formData.max_tokens,
          temperature: formData.temperature,
          is_active: formData.is_active,
          is_default: formData.is_default,
          priority: formData.priority,
          config: mergedConfig,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to update provider" }));
        setError(data.error || "Failed to update provider");
        return;
      }

      router.push("/providers?success=Provider%20updated");
      router.refresh();
    } catch {
      setError("Failed to update provider");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-surface-raised border border-border rounded-lg p-6">
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {catalogError ? <p className="text-sm text-amber-300">{catalogError}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm text-white">
          Display name
          <input
            value={formData.display_name}
            onChange={(e) => setFormData((prev) => ({ ...prev, display_name: e.target.value }))}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            required
          />
        </label>

        <label className="text-sm text-white">
          Provider
          <select
            value={formData.provider_name}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            disabled={catalogLoading || catalog.length === 0}
          >
            {catalog.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm text-white">
        Model
        {selectedProvider ? (
          <select
            value={formData.model}
            onChange={(e) => handleModelChange(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
          >
            {selectedProvider.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} {model.reasoning ? "(reasoning)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={formData.model}
            onChange={(e) => setFormData((prev) => ({ ...prev, model: e.target.value }))}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            required
          />
        )}
      </label>

      <label className="block text-sm text-white">
        Base URL (optional)
        <input
          value={formData.base_url}
          onChange={(e) => setFormData((prev) => ({ ...prev, base_url: e.target.value }))}
          className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
        />
      </label>

      <label className="block text-sm text-white">
        API key (leave blank to keep current)
        <input
          value={formData.api_key}
          onChange={(e) => setFormData((prev) => ({ ...prev, api_key: e.target.value }))}
          type="password"
          className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="text-sm text-white">
          <label className="inline-flex items-center gap-2 mb-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={formData.use_model_default_tokens}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  use_model_default_tokens: e.target.checked,
                  max_tokens: e.target.checked
                    ? null
                    : selectedModelInfo?.maxOutput ?? prev.max_tokens ?? 4096,
                }))
              }
            />
            Use model default max tokens
          </label>
          <input
            type="number"
            value={formData.max_tokens ?? ""}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              setFormData((prev) => ({
                ...prev,
                max_tokens: Number.isFinite(parsed) ? parsed : null,
              }));
            }}
            disabled={formData.use_model_default_tokens}
            placeholder="model default"
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white disabled:opacity-50"
          />
        </div>

        <label className="text-sm text-white">
          Temperature
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={formData.temperature}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, temperature: Number.parseFloat(e.target.value) }))
            }
            disabled={selectedModelInfo ? !selectedModelInfo.allowsTemperature : false}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white disabled:opacity-50"
          />
        </label>

        {showReasoningControls ? (
          <label className="text-sm text-white">
            Thinking level
            <select
              value={formData.thinking_level}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  thinking_level: e.target.value as "low" | "medium" | "high",
                }))
              }
              className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        ) : (
          <div className="text-xs text-text-muted self-end pb-2">Selected model has no reasoning controls.</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-sm text-white">
          Priority
          <input
            type="number"
            value={formData.priority}
            onChange={(e) => setFormData((prev) => ({ ...prev, priority: Number.parseInt(e.target.value, 10) || 0 }))}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
          />
        </label>

        <label className="text-sm text-white inline-flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={formData.is_active}
            onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
          />
          Active
        </label>

        <label className="text-sm text-white inline-flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={formData.is_default}
            onChange={(e) => setFormData((prev) => ({ ...prev, is_default: e.target.checked }))}
          />
          Default
        </label>
      </div>

      <div className="pt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded bg-accent text-black hover:bg-accent-light disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}
