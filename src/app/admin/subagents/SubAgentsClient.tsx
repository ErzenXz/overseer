"use client";

import { useEffect, useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { SubAgentsList } from "./SubAgentsList";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface HealthData {
 timestamp: string;
 overall: {
  health: number;
  status: string;
  degradedAgents: number;
  openCircuits: number;
 };
 agents: Record<string, any>;
 circuitBreakers: {
  summary: {
   closed: number;
   open: number;
   halfOpen: number;
  };
  states: Array<{
   agentType: string;
   state: string;
   failureRate: number;
  }>;
 };
 resourcePools: {
  summary: {
   totalActive: number;
   totalQueued: number;
   totalCompleted: number;
   totalFailed: number;
  };
  pools: Array<any>;
 };
 degradedAgents: Array<{
  type: string;
  reasons: string[];
 }>;
 recommendations: string[];
}

interface SubAgentStats {
 total: number;
 working: number;
 completed: number;
 error: number;
 by_type: Record<string, number>;
}

interface SubAgentsClientProps {
 stats: SubAgentStats;
 allTypes: string[];
}

const subAgentConfigs: Record<string, { name: string; description: string; tools?: string[] }> = {
 generic: {
  name: "Generic Sub-Agent",
  description: "General delegated worker with the same tools as the main agent",
 },
};

const getSubAgentConfig = (type: string) => subAgentConfigs[type];

export default function SubAgentsClient({ stats, allTypes }: SubAgentsClientProps) {
 const [healthData, setHealthData] = useState<HealthData | null>(null);
 const [autoRefresh, setAutoRefresh] = useState(true);

 const fetchHealthData = async () => {
  try {
   const response = await fetch("/api/subagents/health");
   if (response.ok) {
    const data = await response.json();
    setHealthData(data);
   }
  } catch (error) {
   console.error("Failed to fetch health data:", error);
  }
 };

 useEffect(() => {
  fetchHealthData();

  if (autoRefresh) {
   const interval = setInterval(fetchHealthData, 10000);
   return () => clearInterval(interval);
  }
 }, [autoRefresh]);

 const handleResetCircuit = async (agentType?: string) => {
  try {
   const response = await fetch("/api/subagents/health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     action: "reset-circuit",
     agentType,
    }),
   });

   if (response.ok) {
    await fetchHealthData();
   }
  } catch (error) {
   console.error("Failed to reset circuit:", error);
  }
 };

 const getHealthColor = (health: number) => {
  if (health > 90) return "text-green-400";
  if (health > 70) return "text-yellow-400";
  return "text-red-400";
 };

 const getStatusBadge = (status: string) => {
  const colors = {
   healthy: "bg-green-500/10 text-green-400 border-green-500/20",
   degraded: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
   unhealthy: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
   <span
    className={`px-3 py-1 text-xs font-medium rounded-full border ${
     colors[status as keyof typeof colors] || colors.healthy
    }`}
   >
    {status.toUpperCase()}
   </span>
  );
 };

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">Sub-Agents</h1>
     <p className="text-sm text-muted-foreground">Specialized agents for specific tasks</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
     <label className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-md border border-border/50 cursor-pointer hover:bg-muted/50 transition-colors">
      <Input
       type="checkbox"
       checked={autoRefresh}
       onChange={(event) => setAutoRefresh(event.target.checked)}
       className="rounded border-border bg-background text-primary focus:ring-primary focus:ring-offset-background"
      />
      Auto-refresh
     </label>
     <button
      onClick={() => fetchHealthData()}
      className="flex items-center gap-2 px-3 py-1.5 bg-background hover:bg-muted text-foreground text-sm font-medium rounded-md transition-colors border border-border shadow-sm"
     >
      <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
       />
      </svg>
      Refresh
     </button>
     <a
      href="/admin/subagents/spawn"
      className="flex items-center gap-2 px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-md transition-colors shadow-sm"
     >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
      Spawn Sub-Agent
     </a>
    </div>
   </div>

   {healthData && (
    <div className="rounded-xl border border-primary/20 bg-primary/5 shadow-sm p-6 relative overflow-hidden">
     <div className="absolute right-0 top-0 w-32 h-32 bg-primary/10 rounded-bl-full -mr-8 -mt-8 pointer-events-none" />
     <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
      <div>
       <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider mb-2">System Health</h2>
       <div className="flex items-center gap-4">
        <div className={`text-4xl font-bold tracking-tight ${getHealthColor(healthData.overall.health)}`}>
         {healthData.overall.health}%
        </div>
        {getStatusBadge(healthData.overall.status)}
       </div>
      </div>
      <div className="sm:text-right flex flex-col gap-1.5">
       <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        Last updated: <span className="font-mono text-foreground">{new Date(healthData.timestamp).toLocaleTimeString()}</span>
       </div>
       {healthData.overall.degradedAgents > 0 && (
        <div className="text-[11px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded inline-flex items-center gap-1.5 sm:self-end">
         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
         {healthData.overall.degradedAgents} degraded agent(s)
        </div>
       )}
       {healthData.overall.openCircuits > 0 && (
        <div className="text-[11px] font-medium text-destructive bg-destructive/10 border border-destructive/20 px-2 py-0.5 rounded inline-flex items-center gap-1.5 sm:self-end">
         <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
         {healthData.overall.openCircuits} open circuit(s)
        </div>
       )}
      </div>
     </div>

     {healthData.recommendations.length > 0 && (
      <div className="mt-6 pt-5 border-t border-primary/10">
       <h3 className="text-[11px] font-semibold tracking-wider uppercase text-foreground mb-3">Recommendations</h3>
       <ul className="space-y-2">
        {healthData.recommendations.slice(0, 3).map((rec, index) => (
         <li key={index} className="text-sm text-muted-foreground flex items-start gap-2.5">
          <span className="text-primary mt-1 flex-shrink-0">•</span>
          <span>{rec}</span>
         </li>
        ))}
       </ul>
      </div>
     )}
    </div>
   )}

   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
    <StatsCard
     title="Total Sub-Agents"
     value={stats.total}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
       />
      </svg>
     }
     color="accent"
    />
    <StatsCard
     title="Currently Working"
     value={stats.working}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
     }
     color="success"
    />
    <StatsCard
     title="Completed Tasks"
     value={stats.completed}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
     }
     color="info"
    />
    <StatsCard
     title="Errors"
     value={stats.error}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
     }
     color="danger"
    />
   </div>

   {healthData && healthData.circuitBreakers.states.length > 0 && (
    <div className="rounded-xl border border-border bg-card shadow-sm p-6">
     <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider mb-5">Circuit Breakers</h2>
     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {healthData.circuitBreakers.states.map((state) => {
       const stateColors = {
        CLOSED: "border-emerald-500/30 bg-emerald-500/5",
        HALF_OPEN: "border-amber-500/30 bg-amber-500/5",
        OPEN: "border-destructive/30 bg-destructive/5",
       };

       return (
        <div
         key={state.agentType}
         className={cn(
          "p-5 rounded-xl border flex flex-col gap-3 transition-colors",
          stateColors[state.state as keyof typeof stateColors] || stateColors.CLOSED
         )}
        >
         <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground tracking-tight capitalize">
           {state.agentType}
          </span>
          <span
           className={cn(
            "text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border",
            state.state === "OPEN"
             ? "bg-destructive/10 text-destructive border-destructive/20"
             : state.state === "HALF_OPEN"
             ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
             : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
           )}
          >
           {state.state}
          </span>
         </div>
         <div className="text-xs font-medium text-muted-foreground bg-background/50 px-2.5 py-1.5 rounded border border-border/50 w-fit">
          Failure Rate: <span className="text-foreground font-mono">{(state.failureRate * 100).toFixed(1)}%</span>
         </div>
         {state.state === "OPEN" && (
          <button
           onClick={() => handleResetCircuit(state.agentType)}
           className="w-full mt-2 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground h-8 px-3 shadow-sm"
          >
           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
           </svg>
           Reset Circuit
          </button>
         )}
        </div>
       );
      })}
     </div>
    </div>
   )}

   {healthData && healthData.resourcePools.summary.totalActive + healthData.resourcePools.summary.totalQueued > 0 && (
    <div className="rounded-xl border border-border bg-card shadow-sm p-6">
     <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider mb-5">Resource Pools</h2>
     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="flex flex-col items-center justify-center p-4 bg-muted/30 rounded-lg border border-border/50">
       <div className="text-3xl font-bold tracking-tight text-emerald-500 tabular-nums">
        {healthData.resourcePools.summary.totalActive}
       </div>
       <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mt-1.5">Active</div>
      </div>
      <div className="flex flex-col items-center justify-center p-4 bg-muted/30 rounded-lg border border-border/50">
       <div className="text-3xl font-bold tracking-tight text-amber-500 tabular-nums">
        {healthData.resourcePools.summary.totalQueued}
       </div>
       <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mt-1.5">Queued</div>
      </div>
      <div className="flex flex-col items-center justify-center p-4 bg-muted/30 rounded-lg border border-border/50">
       <div className="text-3xl font-bold tracking-tight text-primary tabular-nums">
        {healthData.resourcePools.summary.totalCompleted}
       </div>
       <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mt-1.5">Completed</div>
      </div>
      <div className="flex flex-col items-center justify-center p-4 bg-muted/30 rounded-lg border border-border/50">
       <div className="text-3xl font-bold tracking-tight text-destructive tabular-nums">
        {healthData.resourcePools.summary.totalFailed}
       </div>
       <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mt-1.5">Failed</div>
      </div>
     </div>
    </div>
   )}

   {Object.keys(stats.by_type).length > 0 && (
    <div className="rounded-xl border border-border bg-card shadow-sm p-6">
     <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider mb-5">Usage by Agent Type</h2>
     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {Object.entries(stats.by_type).map(([type, count]) => {
       const config = getSubAgentConfig(type);
       const agentHealth = healthData?.agents[type];
       const successRate = agentHealth?.successRate || 0;

       return (
        <div key={type} className="flex flex-col items-center justify-center p-4 bg-muted/30 rounded-lg border border-border/50 hover:border-primary/30 transition-colors">
         <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{count}</div>
         <div className="text-xs font-medium text-muted-foreground mt-1 text-center line-clamp-1">{config?.name || type}</div>
         {agentHealth && (
          <div className="mt-2.5 flex items-center justify-center">
           <span
            className={cn(
             "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
             successRate > 0.9
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
              : successRate > 0.7
              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
            )}
           >
            {(successRate * 100).toFixed(0)}% success
           </span>
          </div>
         )}
        </div>
       );
      })}
     </div>
    </div>
   )}

  <div className="rounded-xl border border-border bg-card shadow-sm p-6">
   <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase tracking-wider mb-5">Available Sub-Agent Types</h2>
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {allTypes.map((type) => {
     const config = getSubAgentConfig(type);
     const typeIcons: Record<string, string> = {
      generic: "M12 4v16m8-8H4",
     };

     return (
      <div key={type} className="p-5 bg-muted/20 rounded-xl border border-border/50 hover:border-primary/30 transition-colors group">
       <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors ring-1 ring-primary/20">
         <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
           strokeLinecap="round"
           strokeLinejoin="round"
           strokeWidth={2}
           d={typeIcons[type] || "M12 6v6m0 0v6m0-6h6m-6 0H6"}
          />
         </svg>
        </div>
        <div className="min-w-0">
         <h3 className="font-semibold text-foreground tracking-tight truncate">{config?.name || type}</h3>
         <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{config?.description || "No description provided."}</p>
         <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded font-mono uppercase tracking-widest">{type}</span>
          {config?.tools && <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded uppercase tracking-wider">{config.tools.length} tools</span>}
         </div>
        </div>
       </div>
      </div>
     );
    })}
   </div>
  </div>

  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
   <div className="px-6 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
    <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
     <span className="w-2 h-2 rounded-full bg-primary"></span>
     Recent Sub-Agents
    </h2>
    <a href="/admin/subagents/all" className="text-xs font-semibold text-primary hover:underline uppercase tracking-wider">
     View All
    </a>
   </div>
   <SubAgentsList />
  </div>
 </div>
);
}
