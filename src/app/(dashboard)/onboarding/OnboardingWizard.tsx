"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_INFO, type ProviderName } from "@/agent/provider-info";

type StepId = "welcome" | "provider" | "interface" | "soul" | "done";

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

  const [providerForm, setProviderForm] = useState({
    name: "openai" as ProviderName,
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
    type: "telegram" as "telegram" | "discord",
    name: "My Telegram Bot",
    bot_token: "",
    allowed_users: "",
  });
  const [interfaceError, setInterfaceError] = useState("");
  const [interfaceSaving, setInterfaceSaving] = useState(false);

  const [soulContent, setSoulContent] = useState("");
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulError, setSoulError] = useState("");

  const stepProgress = useMemo(() => ((stepIndex + 1) / steps.length) * 100, [stepIndex]);

  const handleProviderChange = (name: ProviderName) => {
    const info = PROVIDER_INFO[name];
    setProviderForm((prev) => ({
      ...prev,
      name,
      display_name: info.displayName,
      model: info.models[0],
      base_url: name === "ollama" ? "http://localhost:11434/v1" : "",
      api_key: "",
    }));
  };

  const saveProvider = async () => {
    setProviderSaving(true);
    setProviderError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerForm),
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

  const handleNext = async () => {
    if (step.id === "provider") {
      const saved = await saveProvider();
      if (!saved) return;
    }
    if (step.id === "interface") {
      const saved = await saveInterface();
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
            <h1 className="text-3xl font-bold text-white">{step.title}</h1>
            <p className="text-zinc-400 mt-2">{step.description}</p>
          </div>
          <div className="text-xs text-zinc-500">
            Step {stepIndex + 1} of {steps.length}
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-zinc-900 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${stepProgress}%` }} />
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8">
        {step.id === "welcome" && (
          <div className="space-y-6 text-zinc-300">
            <p>
              Overseer is your self-hosted AI agent. It can manage your VPS, automate workflows,
              and connect to chat platforms.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-white font-medium">Shell access</p>
                <p className="text-sm text-zinc-500 mt-1">Full command execution on your server.</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-white font-medium">Safe by design</p>
                <p className="text-sm text-zinc-500 mt-1">Built-in guardrails for sensitive ops.</p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-white font-medium">Multi-channel</p>
                <p className="text-sm text-zinc-500 mt-1">Telegram and more when you're ready.</p>
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Provider</label>
                <select
                  value={providerForm.name}
                  onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                    <option key={key} value={key}>
                      {info.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Model</label>
                <select
                  value={providerForm.model}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, model: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {PROVIDER_INFO[providerForm.name].models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {PROVIDER_INFO[providerForm.name].requiresKey && (
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">API Key</label>
                <input
                  type="password"
                  value={providerForm.api_key}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, api_key: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="sk-..."
                  required
                />
              </div>
            )}
            {providerForm.name === "ollama" && (
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Base URL</label>
                <input
                  type="text"
                  value={providerForm.base_url}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, base_url: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="http://localhost:11434/v1"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Max Tokens</label>
                <input
                  type="number"
                  value={providerForm.max_tokens}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={providerForm.temperature}
                  onChange={(e) => setProviderForm((prev) => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                <label className="block text-sm font-medium text-zinc-300 mb-2">Platform</label>
                <select
                  value={interfaceForm.type}
                  onChange={(e) => setInterfaceForm((prev) => ({ ...prev, type: e.target.value as "telegram" | "discord" }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="telegram">Telegram</option>
                  <option value="discord" disabled>
                    Discord (Coming Soon)
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Name</label>
                <input
                  type="text"
                  value={interfaceForm.name}
                  onChange={(e) => setInterfaceForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="My Bot"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Bot Token</label>
              <input
                type="password"
                value={interfaceForm.bot_token}
                onChange={(e) => setInterfaceForm((prev) => ({ ...prev, bot_token: e.target.value }))}
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
              <p className="text-xs text-zinc-500 mt-1">Leave empty to skip for now.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Allowed Users (Optional)</label>
              <input
                type="text"
                value={interfaceForm.allowed_users}
                onChange={(e) => setInterfaceForm((prev) => ({ ...prev, allowed_users: e.target.value }))}
                className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="123456789, 987654321"
              />
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
            <p className="text-sm text-zinc-400">
              Optional: paste a custom SOUL.md snippet to override the default personality.
            </p>
            <textarea
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
              className="w-full h-64 p-4 bg-zinc-950/70 border border-zinc-800 rounded-lg text-zinc-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="# Overseer Soul\n\n## Identity\n..."
              spellCheck={false}
            />
          </div>
        )}

        {step.id === "done" && (
          <div className="space-y-4 text-zinc-300">
            <p>You're ready to go. Visit the dashboard to see live stats and tools.</p>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-white font-medium">Next suggestions</p>
              <ul className="text-sm text-zinc-500 mt-2 space-y-1">
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
          className="px-4 py-2 text-zinc-400 hover:text-white disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          disabled={
            providerSaving || interfaceSaving || soulSaving
          }
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {step.id === "done" ? "Go to Dashboard" : providerSaving || interfaceSaving || soulSaving ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
