"use client";

import { useEffect, useMemo, useState } from "react";

type Task = {
  id: number;
  title: string;
  status: string;
  priority: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result_summary: string | null;
};

const statuses = ["all", "queued", "running", "completed", "failed", "canceled"] as const;

export function TasksClient() {
  const [items, setItems] = useState<Task[]>([]);
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
  const [selected, setSelected] = useState<Task | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (status !== "all") sp.set("status", status);
    sp.set("limit", "200");
    return sp.toString();
  }, [status]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks?${query}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load tasks");
      setItems(json.tasks || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: number) {
    setDetail(null);
    const res = await fetch(`/api/tasks/${id}`, { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setDetail(json.task);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [query]);

  useEffect(() => {
    if (!selected) return;
    void loadDetail(selected.id);
  }, [selected?.id]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] px-2 py-1 rounded border ${
                  status === s
                    ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            className="text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-surface-overlay)]"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <div className="p-4 text-sm text-red-400">{error}</div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="p-4 text-sm text-[var(--color-text-secondary)]">
            Loading…
          </div>
        ) : null}

        <div className="divide-y divide-[var(--color-border)]/50">
          {items.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className={`w-full text-left px-4 py-3 hover:bg-[var(--color-surface-overlay)] ${
                selected?.id === t.id ? "bg-[var(--color-surface-overlay)]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-white">{t.title}</div>
                  <div className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
                    #{t.id} • {t.status} • p{t.priority}
                  </div>
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {new Date(t.created_at).toLocaleString()}
                </div>
              </div>
              {t.error ? (
                <div className="mt-2 text-xs text-red-400 line-clamp-2">
                  {t.error}
                </div>
              ) : t.result_summary ? (
                <div className="mt-2 text-xs text-[var(--color-text-secondary)] line-clamp-2">
                  {t.result_summary}
                </div>
              ) : null}
            </button>
          ))}
          {items.length === 0 && !loading ? (
            <div className="p-8 text-center text-sm text-[var(--color-text-secondary)]">
              No tasks yet.
            </div>
          ) : null}
        </div>
      </div>

      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Task Detail
          </div>
        </div>
        {!selected ? (
          <div className="p-4 text-sm text-[var(--color-text-secondary)]">
            Select a task.
          </div>
        ) : !detail ? (
          <div className="p-4 text-sm text-[var(--color-text-secondary)]">
            Loading…
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div>
              <div className="text-white text-sm">{detail.title}</div>
              <div className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
                #{detail.id} • {detail.status} • p{detail.priority}
              </div>
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Created: {new Date(detail.created_at).toLocaleString()}
              {detail.started_at ? (
                <div>Started: {new Date(detail.started_at).toLocaleString()}</div>
              ) : null}
              {detail.finished_at ? (
                <div>Finished: {new Date(detail.finished_at).toLocaleString()}</div>
              ) : null}
            </div>
            <div>
              <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)] mb-2">
                Input
              </div>
              <pre className="text-xs whitespace-pre-wrap bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded p-3 text-[var(--color-text-secondary)]">
                {detail.input}
              </pre>
            </div>
            {detail.result_full ? (
              <div>
                <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)] mb-2">
                  Result
                </div>
                <pre className="text-xs whitespace-pre-wrap bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded p-3 text-[var(--color-text-secondary)]">
                  {detail.result_full}
                </pre>
              </div>
            ) : null}
            {detail.error ? (
              <div>
                <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-red-400 mb-2">
                  Error
                </div>
                <pre className="text-xs whitespace-pre-wrap bg-[var(--color-surface-overlay)] border border-red-500/30 rounded p-3 text-red-300">
                  {detail.error}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

