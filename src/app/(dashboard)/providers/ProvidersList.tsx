"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Provider } from "@/types/database";

interface ProvidersListProps {
  providers: Provider[];
}

export function ProvidersList({ providers }: ProvidersListProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
    const btn = document.getElementById(`test-btn-${id}`);
    if (btn) btn.textContent = "Testing...";

    try {
      const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
      const data = await res.json();

      if (data.success) {
        alert(`✅ Connection successful! Latency: ${data.latencyMs}ms`);
      } else {
        alert(`❌ Connection failed: ${data.error}`);
      }
    } catch {
      alert("❌ Test failed");
    } finally {
      if (btn) btn.textContent = "Test";
    }
  };

  return (
    <div className="space-y-4">
      {providers.map((provider) => (
        <div
          key={provider.id}
          className={`bg-zinc-900/50 border rounded-xl p-6 ${
            provider.is_default ? "border-indigo-500/50" : "border-zinc-800"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  provider.is_active
                    ? "bg-gradient-to-br from-indigo-500 to-purple-600"
                    : "bg-zinc-800"
                }`}
              >
                <span className="text-lg font-bold text-white">
                  {provider.display_name.charAt(0)}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{provider.display_name}</h3>
                  {provider.is_default && (
                    <span className="text-xs px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded">
                      Default
                    </span>
                  )}
                  {!provider.is_active && (
                    <span className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-400 rounded">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-400 mt-1">
                  Model: <span className="text-zinc-300">{provider.model}</span>
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
                  <span>Max Tokens: {provider.max_tokens}</span>
                  <span>Temperature: {provider.temperature}</span>
                  <span>Priority: {provider.priority}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                id={`test-btn-${provider.id}`}
                onClick={() => handleTest(provider.id)}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Test
              </button>
              {!provider.is_default && (
                <button
                  onClick={() => handleSetDefault(provider.id)}
                  className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Set Default
                </button>
              )}
              <button
                onClick={() => handleToggleActive(provider.id, !!provider.is_active)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  provider.is_active
                    ? "text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20"
                    : "text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20"
                }`}
              >
                {provider.is_active ? "Disable" : "Enable"}
              </button>
              <a
                href={`/providers/${provider.id}/edit`}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              >
                Edit
              </a>
              <button
                onClick={() => handleDelete(provider.id)}
                disabled={deletingId === provider.id}
                className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === provider.id ? "..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
