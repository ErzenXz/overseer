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
          className={`bg-[var(--color-surface-raised)] border rounded-lg p-6 ${
            provider.is_default ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  provider.is_active
                    ? "bg-[var(--color-accent)] text-black"
                    : "bg-[var(--color-surface-overlay)]"
                }`}
              >
                <span className="text-lg font-bold">
                  {provider.display_name.charAt(0)}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{provider.display_name}</h3>
                  {provider.is_default && (
                    <span className="text-xs px-2 py-0.5 bg-[var(--color-accent-dim)] text-[var(--color-accent)] rounded">
                      Default
                    </span>
                  )}
                  {!provider.is_active && (
                    <span className="text-xs px-2 py-0.5 bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] rounded">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  Model: <span className="text-[var(--color-text-primary)]">{provider.model}</span>
                </p>
                <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)]">
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
                className="px-3 py-1.5 text-sm bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white rounded transition-colors"
              >
                Test
              </button>
              {!provider.is_default && (
                <button
                  onClick={() => handleSetDefault(provider.id)}
                  className="px-3 py-1.5 text-sm bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white rounded transition-colors"
                >
                  Set Default
                </button>
              )}
              <button
                onClick={() => handleToggleActive(provider.id, !!provider.is_active)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  provider.is_active
                    ? "text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20"
                    : "text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20"
                }`}
              >
                {provider.is_active ? "Disable" : "Enable"}
              </button>
              <a
                href={`/providers/${provider.id}/edit`}
                className="px-3 py-1.5 text-sm bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white rounded transition-colors"
              >
                Edit
              </a>
              <button
                onClick={() => handleDelete(provider.id)}
                disabled={deletingId === provider.id}
                className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
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
