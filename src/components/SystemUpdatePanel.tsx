"use client";

import { useEffect, useState } from "react";

type UpdateRunRecord = {
  issueId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  exitCode: number | null;
  command: string;
  headBefore?: string | null;
  headAfter?: string | null;
  output: string;
};

export function SystemUpdatePanel({
  title = "Updates",
  showAutoUpdate = true,
}: {
  title?: string;
  showAutoUpdate?: boolean;
}) {
  const [status, setStatus] = useState<{
    head: string | null;
    lastRun: UpdateRunRecord | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<
    { created: boolean; jobId?: number; error?: string } | null
  >(null);
  const [forbidden, setForbidden] = useState(false);

  const loadStatus = async () => {
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch("/api/admin/update", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      setStatus({
        head: typeof data.head === "string" ? data.head : null,
        lastRun: data.lastRun ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runUpdateNow = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/update", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as any;
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        throw new Error("Insufficient permissions to run update.");
      }
      if (!res.ok || !data?.success) {
        throw new Error(
          data?.issueId
            ? `${data?.error || "Update failed"} (Issue #${data.issueId})`
            : data?.error || `Update failed (HTTP ${res.status})`,
        );
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const enableWeeklyAutoUpdate = async () => {
    setAutoUpdateStatus(null);
    setError(null);
    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Overseer Auto Update",
          description: "Weekly self-update via scripts/update.sh",
          cron_expression: "0 3 * * 0",
          timezone: "UTC",
          enabled: true,
          prompt:
            "Run the shell tool to execute exactly: bash ./scripts/update.sh --yes --stash\nReturn a brief status including the exit code.",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        throw new Error("Insufficient permissions to configure auto-update.");
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to create cron job (HTTP ${res.status})`);
      }
      setAutoUpdateStatus({ created: true, jobId: data.job?.id });
    } catch (err) {
      setAutoUpdateStatus({
        created: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white font-[var(--font-mono)]">
            {title}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Update Overseer on this host.
          </p>
          {status?.head && (
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              Current HEAD:{" "}
              <span className="font-mono text-[var(--color-text-secondary)]">
                {status.head.slice(0, 12)}
              </span>
            </p>
          )}
          {forbidden && (
            <p className="text-xs text-amber-300 mt-2">
              You do not have permission to view or run system updates.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {showAutoUpdate && (
            <button
              onClick={enableWeeklyAutoUpdate}
              disabled={forbidden}
              className="px-4 py-2 text-sm bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-white rounded transition-colors border border-[var(--color-border)] disabled:opacity-50"
            >
              Enable Weekly Auto-Update
            </button>
          )}
          <button
            onClick={runUpdateNow}
            disabled={loading || forbidden}
            className="px-4 py-2 text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded transition-colors disabled:opacity-50"
          >
            {loading ? "Updating..." : "Update Now"}
          </button>
        </div>
      </div>

      {(error || autoUpdateStatus?.error) && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
          {error || autoUpdateStatus?.error}
        </div>
      )}

      {autoUpdateStatus?.created && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-300">
          Weekly auto-update cron job created{autoUpdateStatus.jobId ? ` (Job #${autoUpdateStatus.jobId})` : ""}.
        </div>
      )}

      {status?.lastRun && (
        <div className="mt-4 p-4 bg-[var(--color-surface-overlay)] rounded-lg border border-[var(--color-border)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-[var(--color-text-secondary)]">
              Last run:{" "}
              <span className="text-white">
                {new Date(status.lastRun.startedAt).toLocaleString()}
              </span>{" "}
              <span className="text-[var(--color-text-muted)]">
                (Issue #{status.lastRun.issueId})
              </span>
            </div>
            <div
              className={`text-xs px-2 py-1 rounded border ${
                status.lastRun.ok
                  ? "text-green-300 border-green-500/30 bg-green-500/10"
                  : "text-red-300 border-red-500/30 bg-red-500/10"
              }`}
            >
              {status.lastRun.ok ? "SUCCESS" : "FAILED"}{" "}
              {status.lastRun.exitCode !== null ? `(exit ${status.lastRun.exitCode})` : ""}
            </div>
          </div>
          <div className="mt-3 text-xs text-[var(--color-text-muted)] font-mono whitespace-pre-wrap max-h-64 overflow-auto">
            {status.lastRun.output || "(no output)"}
          </div>
        </div>
      )}
    </div>
  );
}

