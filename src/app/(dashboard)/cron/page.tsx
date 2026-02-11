"use client";

import { useState, useEffect, useCallback } from "react";

interface CronJob {
  id: number;
  name: string;
  description: string | null;
  cron_expression: string;
  prompt: string;
  enabled: number;
  created_by: string;
  timezone: string;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
  run_count: number;
  schedule_description: string;
  created_at: string;
  recent_executions?: CronExecution[];
}

interface CronExecution {
  id: number;
  cron_job_id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  output_summary: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_calls_count: number | null;
}

interface EngineStatus {
  running: boolean;
  activeJobs: number;
  totalJobs: number;
  enabledJobs: number;
  pollIntervalMs: number;
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCron, setFormCron] = useState("0 * * * *");
  const [formPrompt, setFormPrompt] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTimezone, setFormTimezone] = useState("UTC");

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/cron?history=true");
      if (!res.ok) throw new Error("Failed to fetch cron jobs");
      const data = await res.json();
      setJobs(data.jobs || []);
      setEngine(data.engine || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 30_000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleCreate = async () => {
    if (!formName || !formCron || !formPrompt) {
      setError("Name, cron expression, and prompt are required");
      return;
    }

    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          cron_expression: formCron,
          prompt: formPrompt,
          description: formDesc || undefined,
          timezone: formTimezone,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create job");
      }

      setShowCreate(false);
      setFormName("");
      setFormCron("0 * * * *");
      setFormPrompt("");
      setFormDesc("");
      setFormTimezone("UTC");
      setError(null);
      fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggle = async (jobId: number, enabled: boolean) => {
    try {
      await fetch(`/api/cron/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (jobId: number) => {
    if (!confirm("Are you sure you want to delete this cron job?")) return;
    try {
      await fetch(`/api/cron/${jobId}`, { method: "DELETE" });
      if (selectedJob?.id === jobId) setSelectedJob(null);
      fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunNow = async (jobId: number) => {
    try {
      await fetch(`/api/cron/${jobId}/run`, { method: "POST" });
      fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString();
  };

  const statusColor = (status: string | null) => {
    switch (status) {
      case "success": return "text-green-400";
      case "running": return "text-amber-400";
      case "failed": return "text-red-400";
      default: return "text-[var(--color-text-muted)]";
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[var(--color-text-muted)] text-sm">Loading cron jobs...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Cron Jobs</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Scheduled AI agent tasks that run automatically
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-light)] transition-colors"
          >
            {showCreate ? "Cancel" : "New Cron Job"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-300">
              &times;
            </button>
          </div>
        )}

        {/* Engine Status Bar */}
        {engine && (
          <div className="mb-6 flex items-center gap-4 p-3 rounded bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${engine.running ? "bg-green-400" : "bg-red-400"}`} />
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                Engine {engine.running ? "Running" : "Stopped"}
              </span>
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              {engine.enabledJobs} enabled / {engine.totalJobs} total
            </div>
            {engine.activeJobs > 0 && (
              <div className="text-xs text-amber-400">
                {engine.activeJobs} running now
              </div>
            )}
            <div className="text-xs text-[var(--color-text-muted)] ml-auto">
              Poll: {engine.pollIntervalMs / 1000}s
            </div>
          </div>
        )}

        {/* Create Form */}
        {showCreate && (
          <div className="mb-6 p-5 rounded-lg bg-[var(--color-surface-raised)] border border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Create Cron Job</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Daily health check"
                  className="w-full px-3 py-2 text-sm rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Cron Expression
                </label>
                <input
                  type="text"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className="w-full px-3 py-2 text-sm font-mono rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  min hour day month weekday (e.g. &quot;0 9 * * *&quot; = daily 9 AM UTC)
                </p>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  AI Prompt
                </label>
                <textarea
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  placeholder="Check disk space usage and report if any partition exceeds 80%..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Monitors disk usage across all partitions"
                  className="w-full px-3 py-2 text-sm rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Timezone</label>
                <input
                  type="text"
                  value={formTimezone}
                  onChange={(e) => setFormTimezone(e.target.value)}
                  placeholder="UTC"
                  className="w-full px-3 py-2 text-sm rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCreate}
                className="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-light)] transition-colors"
              >
                Create Job
              </button>
            </div>
          </div>
        )}

        {/* Jobs List */}
        {jobs.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-[var(--color-text-muted)] text-sm">
              No cron jobs configured yet.
            </div>
            <p className="text-[var(--color-text-muted)] text-xs mt-1">
              Create one above or ask the AI agent to schedule tasks.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                  selectedJob?.id === job.id
                    ? "bg-[var(--color-surface-overlay)] border-[var(--color-accent)]/30"
                    : "bg-[var(--color-surface-raised)] border-[var(--color-border)] hover:border-[var(--color-border-hover)]"
                }`}
                onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
              >
                {/* Job Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${job.enabled ? "bg-green-400" : "bg-[var(--color-text-muted)]"}`} />
                    <div>
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">{job.name}</span>
                      <span className="ml-2 text-xs font-mono text-[var(--color-text-muted)]">#{job.id}</span>
                    </div>
                    <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                      {job.cron_expression}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {job.schedule_description}
                    </span>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {job.last_status && (
                      <span className={`text-xs font-medium ${statusColor(job.last_status)}`}>
                        {job.last_status}
                      </span>
                    )}
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {job.run_count} runs
                    </span>
                    <button
                      onClick={() => handleRunNow(job.id)}
                      className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface-overlay)] transition-colors"
                      title="Run now"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleToggle(job.id, !job.enabled)}
                      className={`p-1.5 rounded transition-colors ${
                        job.enabled
                          ? "text-green-400 hover:text-yellow-400 hover:bg-[var(--color-surface-overlay)]"
                          : "text-[var(--color-text-muted)] hover:text-green-400 hover:bg-[var(--color-surface-overlay)]"
                      }`}
                      title={job.enabled ? "Disable" : "Enable"}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {job.enabled ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        )}
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Job Details (expanded) */}
                {selectedJob?.id === job.id && (
                  <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-[var(--color-text-muted)]">Prompt:</span>
                        <p className="mt-1 text-[var(--color-text-secondary)] bg-[var(--color-surface)] p-2 rounded font-mono text-[11px] whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar">
                          {job.prompt}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-muted)]">Created by:</span>
                          <span className="text-[var(--color-text-secondary)]">{job.created_by}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-muted)]">Timezone:</span>
                          <span className="text-[var(--color-text-secondary)]">{job.timezone}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-muted)]">Last run:</span>
                          <span className="text-[var(--color-text-secondary)]">{formatDate(job.last_run_at)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-muted)]">Next run:</span>
                          <span className="text-[var(--color-text-secondary)]">{formatDate(job.next_run_at)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--color-text-muted)]">Created:</span>
                          <span className="text-[var(--color-text-secondary)]">{formatDate(job.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Execution History */}
                    {job.recent_executions && job.recent_executions.length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Recent Executions</h4>
                        <div className="space-y-1">
                          {job.recent_executions.map((exec) => (
                            <div
                              key={exec.id}
                              className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--color-surface)] text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className={`font-medium ${statusColor(exec.status)}`}>
                                  {exec.status}
                                </span>
                                <span className="text-[var(--color-text-muted)]">
                                  {formatDate(exec.started_at)}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
                                {exec.duration_ms && (
                                  <span>{(exec.duration_ms / 1000).toFixed(1)}s</span>
                                )}
                                {(exec.input_tokens || exec.output_tokens) && (
                                  <span>{(exec.input_tokens || 0) + (exec.output_tokens || 0)} tokens</span>
                                )}
                                {exec.tool_calls_count ? (
                                  <span>{exec.tool_calls_count} tools</span>
                                ) : null}
                                {exec.error && (
                                  <span className="text-red-400 truncate max-w-48" title={exec.error}>
                                    {exec.error}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
