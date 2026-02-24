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

import { PlayIcon, StopCircleIcon, PlusIcon, XIcon, ClockIcon, ActivityIcon, CheckCircle2Icon, XCircleIcon, AlertCircleIcon, Settings2Icon, FileTextIcon, TerminalIcon, CpuIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <div className="flex-1 flex flex-col items-center justify-center gap-4 h-[50vh]">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        <div className="text-muted-foreground text-sm font-medium">Loading cron jobs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Cron Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled AI agent tasks that run automatically
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className={cn(
            "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shadow-sm h-9 px-4 w-full sm:w-auto",
            showCreate 
              ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {showCreate ? (
            <><XIcon className="w-4 h-4" /> Cancel</>
          ) : (
            <><PlusIcon className="w-4 h-4" /> New Cron Job</>
          )}
        </button>
      </div>

      {/* Engine Status */}
      {engine && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card-hover rounded-xl border border-border bg-card shadow-sm p-5 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <ActivityIcon className="w-4 h-4" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Engine Status</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full animate-pulse",
                engine.running ? "bg-success" : "bg-destructive"
              )} />
              <span className="text-lg font-bold tracking-tight text-foreground">
                {engine.running ? "Running" : "Stopped"}
              </span>
            </div>
          </div>
          
          <div className="card-hover rounded-xl border border-border bg-card shadow-sm p-5 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <CpuIcon className="w-4 h-4" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Active Jobs</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground tabular-nums">
              {engine.activeJobs}
            </span>
          </div>

          <div className="card-hover rounded-xl border border-border bg-card shadow-sm p-5 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <CheckCircle2Icon className="w-4 h-4" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Enabled Jobs</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground tabular-nums">
              {engine.enabledJobs} <span className="text-sm font-normal text-muted-foreground">/ {engine.totalJobs}</span>
            </span>
          </div>

          <div className="card-hover rounded-xl border border-border bg-card shadow-sm p-5 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <ClockIcon className="w-4 h-4" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Poll Interval</span>
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground tabular-nums">
              {engine.pollIntervalMs / 1000}s
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="w-4 h-4" />
            <span className="font-medium">{error}</span>
          </div>
          <button 
            onClick={() => setError(null)} 
            className="p-1 rounded-md hover:bg-destructive/20 transition-colors"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
            <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
              <Settings2Icon className="w-4 h-4 text-primary" />
              Create Cron Job
            </h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Daily health check"
                  className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
                />
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Cron Expression
                </label>
                <input
                  type="text"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                  placeholder="0 9 * * *"
                  className="w-full h-9 px-3 font-mono bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
                />
                <p className="text-[10px] text-muted-foreground pt-1">
                  min hour day month weekday (e.g. <code className="font-mono bg-muted px-1 py-0.5 rounded border border-border/50">0 9 * * *</code> = daily 9 AM)
                </p>
              </div>
              
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  AI Prompt
                </label>
                <textarea
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  placeholder="Check disk space usage and report if any partition exceeds 80%..."
                  rows={3}
                  className="w-full p-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground resize-y min-h-[80px]"
                />
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Description <span className="text-muted-foreground/50 lowercase normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Monitors disk usage across all partitions"
                  className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
                />
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Timezone</label>
                <input
                  type="text"
                  value={formTimezone}
                  onChange={(e) => setFormTimezone(e.target.value)}
                  placeholder="UTC"
                  className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground uppercase"
                />
              </div>
            </div>
            
            <div className="mt-6 pt-5 border-t border-border/50 flex justify-end">
              <button
                onClick={handleCreate}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-9 px-4 w-full sm:w-auto"
              >
                <PlusIcon className="w-4 h-4" />
                Create Job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jobs List */}
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
          <div className="w-16 h-16 mb-6 rounded-2xl bg-muted flex items-center justify-center ring-1 ring-border/50">
            <ClockIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">
            No cron jobs configured
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Create one above or ask the AI agent to schedule tasks for you.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const isSelected = selectedJob?.id === job.id;
            
            return (
              <div
                key={job.id}
                className={cn(
                  "rounded-xl border shadow-sm transition-all duration-200 overflow-hidden cursor-pointer",
                  isSelected
                    ? "bg-muted/10 border-primary shadow-md ring-1 ring-primary/20"
                    : "bg-card border-border hover:border-primary/50 hover:shadow-md"
                )}
                onClick={() => setSelectedJob(isSelected ? null : job)}
              >
                {/* Job Header */}
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-4 mt-0.5",
                      job.enabled 
                        ? "bg-success/10 text-success ring-success/5" 
                        : "bg-muted text-muted-foreground ring-muted/20"
                    )}>
                      {job.enabled ? <PlayIcon className="w-5 h-5 ml-0.5" /> : <StopCircleIcon className="w-5 h-5" />}
                    </div>
                    
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold tracking-tight text-foreground">{job.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-muted text-muted-foreground border border-border/50">
                          #{job.id}
                        </span>
                        {job.last_status && (
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
                            job.last_status === "success" ? "bg-success/10 text-success border-success/20" :
                            job.last_status === "running" ? "bg-warning/10 text-warning border-warning/20 animate-pulse" :
                            job.last_status === "failed" ? "bg-destructive/10 text-destructive border-destructive/20" :
                            "bg-muted text-muted-foreground border-border/50"
                          )}>
                            {job.last_status}
                          </span>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/50 font-mono text-foreground">
                            {job.cron_expression}
                          </code>
                          <span className="hidden sm:inline-block text-muted-foreground/70">{job.schedule_description}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 self-start lg:self-auto ml-14 lg:ml-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs font-medium text-muted-foreground bg-muted/30 px-2.5 py-1.5 rounded-md border border-border/50 hidden sm:inline-block">
                      {job.run_count} runs
                    </span>
                    
                    <button
                      onClick={() => handleRunNow(job.id)}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm h-8 px-3"
                      title="Run now"
                    >
                      <PlayIcon className="w-3.5 h-3.5" />
                      Run
                    </button>
                    
                    <button
                      onClick={() => handleToggle(job.id, !job.enabled)}
                      className={cn(
                        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shadow-sm h-8 px-3",
                        job.enabled
                          ? "border border-warning/20 bg-warning/10 text-warning hover:bg-warning hover:text-warning-foreground"
                          : "border border-success/20 bg-success/10 text-success hover:bg-success hover:text-success-foreground"
                      )}
                      title={job.enabled ? "Disable" : "Enable"}
                    >
                      {job.enabled ? <StopCircleIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
                      {job.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(job.id); }}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-transparent hover:bg-destructive/10 hover:text-destructive text-muted-foreground shadow-none h-8 w-8 px-0"
                      title="Delete"
                    >
                      <Trash2Icon className="w-4 h-4" />
                      <span className="sr-only">Delete</span>
                    </button>
                  </div>
                </div>

                {/* Job Details (expanded) */}
                {selectedJob?.id === job.id && (
                  <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                    <div className="pt-4 border-t border-border">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm">
                        <div className="space-y-1.5">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Prompt</span>
                          <div className="bg-muted/30 border border-border/50 rounded-lg p-3 font-mono text-xs text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
                            {job.prompt}
                          </div>
                        </div>
                        
                        <div className="space-y-3">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details</h4>
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                              <span className="text-muted-foreground">Created by</span>
                              <span className="font-medium text-foreground">{job.created_by}</span>
                            </div>
                            <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                              <span className="text-muted-foreground">Timezone</span>
                              <span className="font-medium text-foreground">{job.timezone}</span>
                            </div>
                            <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                              <span className="text-muted-foreground">Last run</span>
                              <span className="font-medium text-foreground">{formatDate(job.last_run_at)}</span>
                            </div>
                            <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                              <span className="text-muted-foreground">Next run</span>
                              <span className="font-medium text-foreground">{formatDate(job.next_run_at)}</span>
                            </div>
                            <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                              <span className="text-muted-foreground">Created</span>
                              <span className="font-medium text-foreground">{formatDate(job.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Execution History */}
                      {job.recent_executions && job.recent_executions.length > 0 && (
                        <div className="mt-6">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent Executions</h4>
                          <div className="space-y-2">
                            {job.recent_executions.map((exec) => (
                              <div
                                key={exec.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-muted/20 border border-border/50 text-sm hover:bg-muted/40 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-2 h-2 rounded-full",
                                    exec.status === "success" ? "bg-success" : 
                                    exec.status === "running" ? "bg-warning animate-pulse" : 
                                    "bg-destructive"
                                  )} />
                                  <span className={cn(
                                    "font-medium capitalize text-xs",
                                    exec.status === "success" ? "text-success" : 
                                    exec.status === "running" ? "text-warning" : 
                                    "text-destructive"
                                  )}>
                                    {exec.status}
                                  </span>
                                  <span className="text-muted-foreground text-xs border-l border-border/50 pl-3">
                                    {formatDate(exec.started_at)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  {exec.duration_ms && (
                                    <span className="flex items-center gap-1">
                                      <ClockIcon className="w-3 h-3" />
                                      {(exec.duration_ms / 1000).toFixed(1)}s
                                    </span>
                                  )}
                                  {(exec.input_tokens || exec.output_tokens) && (
                                    <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5 rounded">
                                      <TerminalIcon className="w-3 h-3" />
                                      {(exec.input_tokens || 0) + (exec.output_tokens || 0)}
                                    </span>
                                  )}
                                  {exec.tool_calls_count ? (
                                    <span className="flex items-center gap-1 bg-muted/50 px-1.5 py-0.5 rounded">
                                      <Settings2Icon className="w-3 h-3" />
                                      {exec.tool_calls_count}
                                    </span>
                                  ) : null}
                                </div>
                                {exec.error && (
                                  <div className="w-full sm:w-auto mt-2 sm:mt-0 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-2 py-1 rounded truncate max-w-xs" title={exec.error}>
                                    {exec.error}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}
    </div>
  );
}
