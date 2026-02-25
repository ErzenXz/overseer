"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

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
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
    <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-muted/20 shrink-0">
     <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
      {statuses.map((s) => (
       <button
        key={s}
        onClick={() => setStatus(s)}
        className={cn(
         "text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full transition-colors duration-200 whitespace-nowrap border shadow-sm",
         status === s
          ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
          : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
       >
        {s}
       </button>
      ))}
     </div>
     <button
      onClick={() => void load()}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm shrink-0 ml-4"
     >
      <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Refresh
     </button>
    </div>

    {error ? (
     <div className="p-4 m-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-start gap-2">
      <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      {error}
     </div>
    ) : null}

    <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-border/50">
     {loading && items.length === 0 ? (
      <div className="flex flex-col items-center justify-center h-40 space-y-3 text-muted-foreground">
       <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
       </svg>
       <span className="text-sm font-medium">Loading tasks...</span>
      </div>
     ) : null}

     {items.map((t) => (
      <button
       key={t.id}
       onClick={() => setSelected(t)}
       className={cn(
        "w-full text-left px-5 py-4 transition-colors hover:bg-muted/50 focus:outline-none focus:bg-muted/50",
        selected?.id === t.id ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
       )}
      >
       <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
         <div className="flex items-center gap-2 mb-1.5">
          <span className={cn(
           "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider",
           t.status === "completed" ? "bg-emerald-500/10 text-emerald-500" :
           t.status === "failed" ? "bg-destructive/10 text-destructive" :
           t.status === "running" ? "bg-amber-500/10 text-amber-500" :
           "bg-muted text-muted-foreground border border-border/50"
          )}>
           {t.status}
          </span>
          <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">
           p{t.priority}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
           #{t.id}
          </span>
         </div>
         <div className="text-sm font-medium text-foreground truncate">{t.title}</div>
        </div>
        <div className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 pt-1">
         {new Date(t.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
       </div>
       {t.error ? (
        <div className="mt-2.5 text-xs text-destructive bg-destructive/10 border border-destructive/20 p-2 rounded-md line-clamp-2 leading-relaxed">
         {t.error}
        </div>
       ) : t.result_summary ? (
        <div className="mt-2.5 text-xs text-muted-foreground bg-muted/30 border border-border/50 p-2 rounded-md line-clamp-2 leading-relaxed">
         {t.result_summary}
        </div>
       ) : null}
      </button>
     ))}
     {items.length === 0 && !loading && !error ? (
      <div className="flex flex-col items-center justify-center h-40 space-y-3 text-muted-foreground">
       <svg className="w-10 h-10 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
       </svg>
       <span className="text-sm font-medium">No tasks found.</span>
      </div>
     ) : null}
    </div>
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20 shrink-0">
     <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
      <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Task Detail
     </h2>
    </div>
    
    <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
     {!selected ? (
      <div className="flex flex-col items-center justify-center h-full space-y-3 text-muted-foreground">
       <svg className="w-10 h-10 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
       </svg>
       <span className="text-sm font-medium">Select a task to view details.</span>
      </div>
     ) : !detail ? (
      <div className="flex flex-col items-center justify-center h-full space-y-3 text-muted-foreground">
       <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
       </svg>
       <span className="text-sm font-medium">Loading details...</span>
      </div>
     ) : (
      <div className="space-y-6">
       <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
         <span className={cn(
          "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider",
          detail.status === "completed" ? "bg-emerald-500/10 text-emerald-500" :
          detail.status === "failed" ? "bg-destructive/10 text-destructive" :
          detail.status === "running" ? "bg-amber-500/10 text-amber-500" :
          "bg-muted text-muted-foreground border border-border/50"
         )}>
          {detail.status}
         </span>
         <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">
          p{detail.priority}
         </span>
         <span className="text-[11px] text-muted-foreground font-mono">
          #{detail.id}
         </span>
        </div>
        <h3 className="text-lg font-bold text-foreground tracking-tight leading-snug">{detail.title}</h3>
       </div>

       <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs bg-muted/20 border border-border/50 rounded-lg p-4">
        <div>
         <span className="text-muted-foreground block mb-1 font-medium">Created</span>
         <span className="text-foreground">{new Date(detail.created_at).toLocaleString()}</span>
        </div>
        {detail.started_at && (
         <div>
          <span className="text-muted-foreground block mb-1 font-medium">Started</span>
          <span className="text-foreground">{new Date(detail.started_at).toLocaleString()}</span>
         </div>
        )}
        {detail.finished_at && (
         <div className="sm:col-span-2 border-t border-border/50 pt-3 mt-1">
          <span className="text-muted-foreground block mb-1 font-medium">Finished</span>
          <span className="text-foreground">{new Date(detail.finished_at).toLocaleString()}</span>
         </div>
        )}
       </div>

       <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Input</h4>
        <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/30 border border-border/50 rounded-lg p-4 text-foreground/80 overflow-x-auto leading-relaxed">
         {detail.input}
        </pre>
       </div>

       {detail.result_full && (
        <div className="space-y-2">
         <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Result</h4>
         <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/30 border border-border/50 rounded-lg p-4 text-foreground/80 overflow-x-auto leading-relaxed">
          {detail.result_full}
         </pre>
        </div>
       )}

       {detail.error && (
        <div className="space-y-2">
         <h4 className="text-xs font-semibold uppercase tracking-wider text-destructive flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          Error
         </h4>
         <pre className="text-xs font-mono whitespace-pre-wrap bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-destructive/90 overflow-x-auto leading-relaxed">
          {detail.error}
         </pre>
        </div>
       )}
      </div>
     )}
    </div>
   </div>
  </div>
 );
}

