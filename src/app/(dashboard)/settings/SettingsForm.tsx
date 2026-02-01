"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SettingsFormProps {
  settings: Record<string, string>;
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState({
    "agent.max_steps": settings["agent.max_steps"] || "25",
    "agent.max_retries": settings["agent.max_retries"] || "3",
    "agent.timeout_ms": settings["agent.timeout_ms"] || "120000",
    "tools.require_confirmation": settings["tools.require_confirmation"] || "true",
    "tools.shell_timeout_ms": settings["tools.shell_timeout_ms"] || "30000",
    "tools.max_file_size_mb": settings["tools.max_file_size_mb"] || "10",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Agent Settings</h2>
        {saved && <span className="text-sm text-green-400">Saved!</span>}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Max Steps</label>
          <input
            type="number"
            value={formData["agent.max_steps"]}
            onChange={(e) => setFormData((prev) => ({ ...prev, "agent.max_steps": e.target.value }))}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-zinc-500 mt-1">Maximum number of tool-calling steps per request</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Max Retries</label>
          <input
            type="number"
            value={formData["agent.max_retries"]}
            onChange={(e) => setFormData((prev) => ({ ...prev, "agent.max_retries": e.target.value }))}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-zinc-500 mt-1">Number of retries for failed API calls</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Timeout (ms)</label>
          <input
            type="number"
            value={formData["agent.timeout_ms"]}
            onChange={(e) => setFormData((prev) => ({ ...prev, "agent.timeout_ms": e.target.value }))}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Shell Command Timeout (ms)</label>
          <input
            type="number"
            value={formData["tools.shell_timeout_ms"]}
            onChange={(e) => setFormData((prev) => ({ ...prev, "tools.shell_timeout_ms": e.target.value }))}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Max File Size (MB)</label>
          <input
            type="number"
            value={formData["tools.max_file_size_mb"]}
            onChange={(e) => setFormData((prev) => ({ ...prev, "tools.max_file_size_mb": e.target.value }))}
            className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="require_confirmation"
            checked={formData["tools.require_confirmation"] === "true"}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                "tools.require_confirmation": e.target.checked ? "true" : "false",
              }))
            }
            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
          />
          <label htmlFor="require_confirmation" className="text-sm text-zinc-300">
            Require confirmation for destructive commands
          </label>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="mt-6 w-full py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </form>
  );
}
