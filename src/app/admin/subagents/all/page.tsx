import Link from "next/link";
import { db } from "@/database";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";

interface SubAgentRow {
 id: number;
 sub_agent_id: string;
 parent_session_id: string | null;
 name: string;
 agent_type: string;
 status: "idle" | "working" | "completed" | "error";
 assigned_task: string | null;
 created_at: string;
 completed_at: string | null;
 tokens_used: number;
 step_count: number;
}

const statusClasses: Record<SubAgentRow["status"], string> = {
 idle: "bg-muted text-muted-foreground border-border/50",
 working: "bg-amber-500/10 text-amber-500 border-amber-500/20",
 completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
 error: "bg-destructive/10 text-destructive border-destructive/20",
};

export default function AllSubAgentsPage() {
 const rows = db
  .prepare(
   `SELECT id, sub_agent_id, parent_session_id, name, agent_type, status, assigned_task, created_at, completed_at, tokens_used, step_count
    FROM sub_agents
    ORDER BY created_at DESC
    LIMIT 200`
  )
  .all() as SubAgentRow[];

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">All Sub-Agents</h1>
     <p className="text-sm text-muted-foreground text-pretty">
      Inspect every sub-agent job across statuses, including completed and failed runs.
     </p>
    </div>
    <div className="flex items-center gap-3 shrink-0">
     <Link
      href="/admin/subagents"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground h-9 px-4 shadow-sm"
     >
      <ArrowLeftIcon className="w-4 h-4" />
      Back
     </Link>
     <Link
      href="/admin/subagents/spawn"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 shadow-sm"
     >
      <PlusIcon className="w-4 h-4" />
      Spawn new
     </Link>
    </div>
   </div>

   {rows.length === 0 ? (
    <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
     <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-6 ring-1 ring-border">
      <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
     </div>
     <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">No sub-agent runs found yet</h3>
     <p className="text-sm text-muted-foreground text-pretty mb-8 max-w-md">
      Spawn your first sub-agent to see its execution history here.
     </p>
     <Link
      href="/admin/subagents/spawn"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-6 shadow-sm"
     >
      Create your first run
     </Link>
    </div>
   ) : (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-sm text-left">
       <thead className="bg-muted/20 border-b border-border/50">
        <tr className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">
         <th className="px-6 py-4">Type</th>
         <th className="px-6 py-4">Name</th>
         <th className="px-6 py-4">Status</th>
         <th className="px-6 py-4">Parent session</th>
         <th className="px-6 py-4">Steps</th>
         <th className="px-6 py-4">Tokens</th>
         <th className="px-6 py-4">Task</th>
        </tr>
       </thead>
       <tbody className="divide-y divide-border/50">
        {rows.map((row) => (
         <tr key={row.id} className="hover:bg-muted/30 transition-colors group">
          <td className="px-6 py-4 whitespace-nowrap">
           <span className="text-xs font-semibold text-foreground bg-muted/50 px-2 py-1 rounded border border-border/50 uppercase tracking-widest">
            {row.agent_type}
           </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap font-medium text-foreground">
           {row.name}
          </td>
          <td className="px-6 py-4 whitespace-nowrap">
           <span className={cn(
            "inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest border",
            statusClasses[row.status]
           )}>
            {row.status}
           </span>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-muted-foreground font-mono text-xs">
           {row.parent_session_id ? (
            <span className="bg-muted/30 px-1.5 py-0.5 rounded border border-border/30">{row.parent_session_id}</span>
           ) : (
            <span className="text-muted-foreground/50">—</span>
           )}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-foreground tabular-nums font-mono text-xs">
           {row.step_count}
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-foreground tabular-nums font-mono text-xs">
           {row.tokens_used.toLocaleString()}
          </td>
          <td className="px-6 py-4 text-muted-foreground max-w-xs truncate" title={row.assigned_task ?? ""}>
           {row.assigned_task ? (
            <span className="text-xs truncate block">{row.assigned_task}</span>
           ) : (
            <span className="text-muted-foreground/50">—</span>
           )}
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    </div>
   )}
  </div>
 );
}
