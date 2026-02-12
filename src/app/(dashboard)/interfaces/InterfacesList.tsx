"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Interface } from "@/types/database";

interface InterfacesListProps {
  interfaces: Interface[];
}

const interfaceIcons: Record<string, React.ReactNode> = {
  telegram: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
    </svg>
  ),
  discord: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  ),
};

export function InterfacesList({ interfaces }: InterfacesListProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string } | null>(null);

  const parseConfig = (raw: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this interface?")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/interfaces/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    await fetch(`/api/interfaces/${id}`, {
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
      const res = await fetch(`/api/interfaces/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult({
        id,
        success: Boolean(data.success),
        message: data.message || data.error || "Unknown result",
      });
    } catch {
      setTestResult({ id, success: false, message: "Interface test failed" });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {interfaces.map((iface) => {
        const config = parseConfig(iface.config);
        const hasToken = !!config.bot_token;
        const hasClientId = iface.type !== "discord" || Boolean(config.client_id);
        const isHealthyConfig = hasToken && hasClientId;
        const isTestingThis = testingId === iface.id;
        const testResultForThis = testResult?.id === iface.id ? testResult : null;

        return (
          <div
            key={iface.id}
            className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    iface.is_active
                      ? iface.type === "telegram"
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : "bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {interfaceIcons[iface.type] || (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white">{iface.name}</h3>
                    <span className="text-xs px-2 py-0.5 bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] rounded capitalize">
                      {iface.type}
                    </span>
                    {iface.is_active ? (
                      <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                        Active
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] rounded">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                    Token: {hasToken ? "••••••••" : "Not configured"}
                  </p>
                  {iface.type === "discord" && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      Client ID: {hasClientId ? "configured" : "missing"}
                    </p>
                  )}
                  {!isHealthyConfig && (
                    <p className="text-xs text-amber-400 mt-1">
                      Setup incomplete. Add all required platform fields.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleActive(iface.id, !!iface.is_active)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    iface.is_active
                      ? "text-yellow-400 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20"
                      : "text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20"
                  }`}
                >
                  {iface.is_active ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => handleTest(iface.id)}
                  disabled={isTestingThis}
                  className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded-lg transition-colors disabled:opacity-50"
                >
                  {isTestingThis ? "Testing..." : "Test"}
                </button>
                <a
                  href={`/interfaces/${iface.id}/edit`}
                  className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
                >
                  Edit
                </a>
                <button
                  onClick={() => handleDelete(iface.id)}
                  disabled={deletingId === iface.id}
                  className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  {deletingId === iface.id ? "..." : "Delete"}
                </button>
              </div>
            </div>

            {testResultForThis && (
              <div
                className={`mt-3 px-3 py-2 rounded-lg text-xs border ${
                  testResultForThis.success
                    ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : "bg-red-500/10 border-red-500/20 text-red-400"
                }`}
              >
                {testResultForThis.message}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
