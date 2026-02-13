"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_INFO, type ProviderName } from "@/agent/provider-info";
import type { InterfaceType } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";

type StepId =
  | "welcome"
  | "provider"
  | "interface"
  | "personalize"
  | "soul"
  | "done";

const steps: Array<{ id: StepId; title: string; description: string }> = [
  {
    id: "welcome",
    title: "Welcome to Overseer",
    description: "Set up your self-hosted AI agent in a few steps.",
  },
  {
    id: "provider",
    title: "Add your AI provider",
    description: "Connect your first model so the agent can think.",
  },
  {
    id: "interface",
    title: "Connect a chat interface",
    description: "Optional: connect Telegram or Discord.",
  },
  {
    id: "personalize",
    title: "Personalize your assistant",
    description: "Answer a few questions so the agent feels human and personal.",
  },
  {
    id: "soul",
    title: "Customize the soul",
    description: "Optional: define the agent's personality.",
  },
  {
    id: "done",
    title: "All set",
    description: "Finish and head to your dashboard.",
  },
];

export function OnboardingWizard() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];

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

  const [providerCatalog, setProviderCatalog] = useState<CatalogProvider[]>([]);
  const [providerCatalogLoading, setProviderCatalogLoading] = useState(false);
  const [providerCatalogError, setProviderCatalogError] = useState("");

  const [providerForm, setProviderForm] = useState({
    name: "openai",
    display_name: "OpenAI",
    api_key: "",
    base_url: "",
    model: "gpt-4o",
    max_tokens: 4096,
    temperature: 0.7,
    is_default: true,
    priority: 0,
  });
  const [providerError, setProviderError] = useState("");
  const [providerSaving, setProviderSaving] = useState(false);

  const [interfaceForm, setInterfaceForm] = useState({
    type: "telegram" as InterfaceType,
    name: "My Telegram Bot",
    bot_token: "",
    allowed_users: "",
  });
  const [interfaceError, setInterfaceError] = useState("");
  const [interfaceSaving, setInterfaceSaving] = useState(false);

  const [personalizeForm, setPersonalizeForm] = useState({
    userPreferredName: "",
    userPronouns: "",
    agentName: "Overseer",
    toneDefault: "friendly" as "direct" | "friendly" | "formal" | "playful",
    verbosityDefault: "balanced" as "short" | "balanced" | "detailed",
    whenUncertain: "ask" as "ask" | "assume_and_note",
    confirmations: "risky_only" as "always" | "risky_only" | "catastrophic_only",
    decisionStyle: "recommend_one" as "recommend_one" | "offer_three" | "ask_first",
    technicalDepth: "ask_which" as "explain" | "just_do" | "ask_which",
    proactivity: "suggest_next" as "suggest_next" | "only_answer",
    primaryGoals: "mixed" as "devops" | "coding" | "business_ops" | "learning" | "mixed",
    stressHandling: "straight_to_fix" as "calm_empathetic" | "straight_to_fix",
    timezone: "",
  });
  const [personalizeError, setPersonalizeError] = useState("");
  const [personalizeSaving, setPersonalizeSaving] = useState(false);

  const [soulContent, setSoulContent] = useState("");
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulError, setSoulError] = useState("");

  const stepProgress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  const selectedCatalogProvider = useMemo(
    () => providerCatalog.find((p) => p.id === providerForm.name),
    [providerCatalog, providerForm.name],
  );

  const fallbackProviderInfo = useMemo(() => {
    const name = providerForm.name as ProviderName;
    return name in PROVIDER_INFO ? PROVIDER_INFO[name] : null;
  }, [providerForm.name]);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      setProviderCatalogLoading(true);
      setProviderCatalogError("");
      try {
        const res = await fetch("/api/providers/catalog", { cache: "no-store" });
        if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
        const data = await res.json();
        const providers = (data.providers || []) as CatalogProvider[];
        if (cancelled) return;
        setProviderCatalog(providers);
        if (providers.length > 0 && !providerForm.name) {
          const first = providers[0];
          const firstModel = first.models[0];
          setProviderForm((prev) => ({
            ...prev,
            name: first.id,
            display_name: first.displayName,
            model: firstModel?.id || prev.model,
            base_url: first.apiBaseUrl || prev.base_url,
          }));
        }
      } catch (e) {
        if (cancelled) return;
        setProviderCatalogError(
          e instanceof Error ? e.message : "Failed to load provider catalog",
        );
      } finally {
        if (!cancelled) setProviderCatalogLoading(false);
      }
    };
    void loadCatalog();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProviderChange = (name: string) => {
    const catalogEntry = providerCatalog.find((p) => p.id === name);
    if (catalogEntry) {
      const firstModel = catalogEntry.models[0];
      setProviderForm((prev) => ({
        ...prev,
        name,
        display_name: catalogEntry.displayName,
        model: firstModel?.id || prev.model,
        base_url: catalogEntry.apiBaseUrl || prev.base_url,
        api_key: "",
      }));
      return;
    }

    const staticName = name as ProviderName;
    if (staticName in PROVIDER_INFO) {
      const info = PROVIDER_INFO[staticName];
      setProviderForm((prev) => ({
        ...prev,
        name,
        display_name: info.displayName,
        model: info.models[0]?.id || prev.model,
        base_url: staticName === "ollama" ? "http://localhost:11434/v1" : "",
        api_key: "",
      }));
    }
  };

  const saveProvider = async () => {
    setProviderSaving(true);
    setProviderError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...providerForm,
          config: selectedCatalogProvider
            ? {
                models_dev_provider_id: selectedCatalogProvider.id,
                provider_npm: selectedCatalogProvider.npm,
                runtime_adapter: selectedCatalogProvider.runtimeAdapter,
              }
            : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setProviderError(data.error || "Failed to add provider");
        return false;
      }
      return true;
    } catch {
      setProviderError("Failed to add provider");
      return false;
    } finally {
      setProviderSaving(false);
    }
  };

  const saveInterface = async () => {
    if (!interfaceForm.bot_token.trim()) {
      return true;
    }
    setInterfaceSaving(true);
    setInterfaceError("");
    try {
      const res = await fetch("/api/interfaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: interfaceForm.type,
          name: interfaceForm.name,
          config: {
            bot_token: interfaceForm.bot_token,
          },
          allowed_users: interfaceForm.allowed_users
            ? interfaceForm.allowed_users.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setInterfaceError(data.error || "Failed to add interface");
        return false;
      }
      return true;
    } catch {
      setInterfaceError("Failed to add interface");
      return false;
    } finally {
      setInterfaceSaving(false);
    }
  };

  const saveSoul = async () => {
    if (!soulContent.trim()) {
      return true;
    }
    setSoulSaving(true);
    setSoulError("");
    try {
      const res = await fetch("/api/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: soulContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        setSoulError(data.error || "Failed to save soul");
        return false;
      }
      return true;
    } catch {
      setSoulError("Failed to save soul");
      return false;
    } finally {
      setSoulSaving(false);
    }
  };

  const savePersonalize = async () => {
    setPersonalizeSaving(true);
    setPersonalizeError("");
    try {
      const res = await fetch("/api/profile/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: personalizeForm, refine: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPersonalizeError(data.error || "Failed to save personalization");
        return false;
      }
      return true;
    } catch {
      setPersonalizeError("Failed to save personalization");
      return false;
    } finally {
      setPersonalizeSaving(false);
    }
  };

  const handleNext = async () => {
    if (step.id === "provider") {
      const saved = await saveProvider();
      if (!saved) return;
    }
    if (step.id === "interface") {
      const saved = await saveInterface();
      if (!saved) return;
    }
    if (step.id === "personalize") {
      const saved = await savePersonalize();
      if (!saved) return;
    }
    if (step.id === "soul") {
      const saved = await saveSoul();
      if (!saved) return;
    }
    if (step.id === "done") {
      router.push("/dashboard");
      return;
    }
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const handleBack = () => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">{step.title}</h1>
            <p className="text-[var(--color-text-secondary)] mt-2">{step.description}</p>
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            Step {stepIndex + 1} of {steps.length}
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-[var(--color-surface-raised)] overflow-hidden">
          <div className="h-full bg-[var(--color-accent)]" style={{ width: `${stepProgress}%` }} />
        </div>
      </div>

      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-8">
        {step.id === "welcome" && (
          <div className="space-y-6 text-[var(--color-text-primary)]">
            <p>
              Overseer is your self-hosted AI agent. It can manage your VPS, automate workflows,
              and connect to chat platforms.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-white font-medium">Shell access</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">Full command execution on your server.</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-white font-medium">Safe by design</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">Built-in guardrails for sensitive ops.</p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <p className="text-white font-medium">Multi-channel</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">Telegram and more when you're ready.</p>
              </div>
            </div>
          </div>
        )}

        {step.id === "provider" && (
          <div className="space-y-6">
            {providerError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {providerError}
              </div>
            )}
            {providerCatalogError && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-300 text-sm">
                Provider catalog unavailable. Falling back to built-in providers.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Provider</label>
                <select
                  value={providerForm.name}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  disabled={providerCatalogLoading}
                >
                  {providerCatalog.length > 0
                    ? providerCatalog.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))
                    : Object.entries(PROVIDER_INFO).map(([key, info]) => (
                        <option key={key} value={key}>
                          {info.displayName}
                        </option>
                      ))}
                </select>
                {providerCatalogLoading && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">Loading provider catalog…</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Model</label>
                {(
                  (selectedCatalogProvider?.models?.length ?? 0) > 0 ||
                  (fallbackProviderInfo?.models?.length ?? 0) > 0
                ) ? (
                  <select
                    value={providerForm.model}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, model: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  >
                    {(selectedCatalogProvider?.models ||
                      fallbackProviderInfo?.models ||
                      []).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} {model.reasoning ? "(reasoning)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={providerForm.model}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, model: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    placeholder="Model id (e.g. gpt-4o)"
                    required
                  />
                )}
              </div>
            </div>
            {(selectedCatalogProvider?.requiresKey ?? fallbackProviderInfo?.requiresKey ?? true) && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">API Key</label>
                <input
                  type="password"
                  value={providerForm.api_key}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, api_key: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="sk-..."
                  required
                />
              </div>
            )}
            {((selectedCatalogProvider &&
              (selectedCatalogProvider.id === "ollama" ||
                selectedCatalogProvider.runtimeAdapter === "openai-compatible")) ||
              (!selectedCatalogProvider && providerForm.name === "ollama")) && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Base URL</label>
                <input
                  type="text"
                  value={providerForm.base_url}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, base_url: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="http://localhost:11434/v1"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Max Tokens</label>
                <input
                  type="number"
                  value={providerForm.max_tokens}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={providerForm.temperature}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            </div>
          </div>
        )}

        {step.id === "interface" && (
          <div className="space-y-6">
            {interfaceError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {interfaceError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Platform</label>
                <select
                  value={interfaceForm.type}
                  onChange={(e) => setInterfaceForm((prev) => ({ ...prev, type: e.target.value as InterfaceType }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="telegram">Telegram</option>
                  <option value="discord">Discord</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Name</label>
                <input
                  type="text"
                  value={interfaceForm.name}
                  onChange={(e) => setInterfaceForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="My Bot"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Bot Token</label>
              <input
                type="password"
                value={interfaceForm.bot_token}
                onChange={(e) => setInterfaceForm((prev) => ({ ...prev, bot_token: e.target.value }))}
                className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Leave empty to skip for now.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Allowed Users (Optional)</label>
              <input
                type="text"
                value={interfaceForm.allowed_users}
                onChange={(e) => setInterfaceForm((prev) => ({ ...prev, allowed_users: e.target.value }))}
                className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                placeholder="123456789, 987654321"
              />
            </div>
          </div>
        )}

        {step.id === "personalize" && (
          <div className="space-y-6">
            {personalizeError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {personalizeError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Your preferred name (optional)
                </label>
                <input
                  type="text"
                  value={personalizeForm.userPreferredName}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({ ...prev, userPreferredName: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="e.g. Erzen"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Pronouns (optional)
                </label>
                <input
                  type="text"
                  value={personalizeForm.userPronouns}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({ ...prev, userPronouns: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="e.g. he/him"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Agent name
                </label>
                <input
                  type="text"
                  value={personalizeForm.agentName}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({ ...prev, agentName: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="Overseer"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Tone
                </label>
                <select
                  value={personalizeForm.toneDefault}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      toneDefault: e.target.value as typeof prev.toneDefault,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="direct">Direct</option>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                  <option value="playful">Playful</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Verbosity
                </label>
                <select
                  value={personalizeForm.verbosityDefault}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      verbosityDefault: e.target.value as typeof prev.verbosityDefault,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="short">Short</option>
                  <option value="balanced">Balanced</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  When uncertain
                </label>
                <select
                  value={personalizeForm.whenUncertain}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      whenUncertain: e.target.value as typeof prev.whenUncertain,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="ask">Ask clarifying questions</option>
                  <option value="assume_and_note">Assume and clearly note it</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Confirmations
                </label>
                <select
                  value={personalizeForm.confirmations}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      confirmations: e.target.value as typeof prev.confirmations,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="always">Always confirm destructive actions</option>
                  <option value="risky_only">Confirm risky actions only</option>
                  <option value="catastrophic_only">Only confirm catastrophic actions</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Decision style
                </label>
                <select
                  value={personalizeForm.decisionStyle}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      decisionStyle: e.target.value as typeof prev.decisionStyle,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="recommend_one">Recommend one option</option>
                  <option value="offer_three">Offer up to 3 options</option>
                  <option value="ask_first">Ask before deciding</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Technical depth
                </label>
                <select
                  value={personalizeForm.technicalDepth}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      technicalDepth: e.target.value as typeof prev.technicalDepth,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="ask_which">Ask which you prefer</option>
                  <option value="just_do">Just do it (minimal explanation)</option>
                  <option value="explain">Explain while doing</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Proactivity
                </label>
                <select
                  value={personalizeForm.proactivity}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      proactivity: e.target.value as typeof prev.proactivity,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="suggest_next">Suggest next steps</option>
                  <option value="only_answer">Only answer what I ask</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Primary goals
                </label>
                <select
                  value={personalizeForm.primaryGoals}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      primaryGoals: e.target.value as typeof prev.primaryGoals,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="mixed">Mixed</option>
                  <option value="devops">DevOps / VPS admin</option>
                  <option value="coding">Coding</option>
                  <option value="business_ops">Business ops</option>
                  <option value="learning">Learning</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Stress handling
                </label>
                <select
                  value={personalizeForm.stressHandling}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({
                      ...prev,
                      stressHandling: e.target.value as typeof prev.stressHandling,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="straight_to_fix">Straight to fix</option>
                  <option value="calm_empathetic">Calm + empathetic</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Timezone (optional)
                </label>
                <input
                  type="text"
                  value={personalizeForm.timezone}
                  onChange={(e) =>
                    setPersonalizeForm((prev) => ({ ...prev, timezone: e.target.value }))
                  }
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="e.g. America/New_York"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                These answers are saved into your long-term memory and also generate a per-user
                SOUL supplement.
              </p>
            </div>
          </div>
        )}

        {step.id === "soul" && (
          <div className="space-y-4">
            {soulError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                {soulError}
              </div>
            )}
            <p className="text-sm text-[var(--color-text-secondary)]">
              Optional: paste a custom SOUL.md snippet to override the default personality.
            </p>
            <textarea
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
              className="w-full h-64 p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              placeholder="# Overseer Soul\n\n## Identity\n..."
              spellCheck={false}
            />
          </div>
        )}

        {step.id === "done" && (
          <div className="space-y-4 text-[var(--color-text-primary)]">
            <p>You're ready to go. Visit the dashboard to see live stats and tools.</p>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <p className="text-white font-medium">Next suggestions</p>
              <ul className="text-sm text-[var(--color-text-muted)] mt-2 space-y-1">
                <li>• Add a second provider for fallback.</li>
                <li>• Connect Telegram to chat with your agent.</li>
                <li>• Review the soul to set tone and safety rules.</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-6">
        <button
          onClick={handleBack}
          disabled={stepIndex === 0}
          className="px-4 py-2 text-[var(--color-text-secondary)] hover:text-white disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={
            providerSaving || interfaceSaving || personalizeSaving || soulSaving
          }
          className="px-5 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {step.id === "done"
            ? "Go to Dashboard"
            : providerSaving || interfaceSaving || personalizeSaving || soulSaving
              ? "Saving..."
              : "Continue"}
        </button>
      </div>
    </div>
  );
}
