import { StatsCard } from "@/components/StatsCard";
import { SessionCard } from "@/components/admin/SessionCard";
import { agentSessionsModel } from "@/database/models/agent-sessions";
import type { AgentSession } from "@/database/models/agent-sessions";
import { ActivityIcon, ClockIcon, MessageSquareIcon, BanknoteIcon, PowerOffIcon, ShieldAlertIcon, ZapIcon, InfoIcon } from "lucide-react";

export default function SessionsPage() {
 const activeSessions = agentSessionsModel.findActive();
 const stats = agentSessionsModel.getStats();

 // Group sessions by interface type
 const sessionsByInterface = activeSessions.reduce((acc: Record<string, AgentSession[]>, session: AgentSession) => {
  const type = session.interface_type;
  if (!acc[type]) acc[type] = [];
  acc[type].push(session);
  return acc;
 }, {} as Record<string, AgentSession[]>);

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
   {/* Header */}
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Session Management</h1>
      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 uppercase tracking-wider">
       Runtime
      </span>
     </div>
     <p className="text-sm text-muted-foreground flex items-center gap-1.5">
      <ActivityIcon className="w-4 h-4" />
      Monitor and manage active agent sessions across all interfaces
     </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500 hover:text-background shadow-sm h-9 px-4 w-full sm:w-auto">
      <ClockIcon className="w-4 h-4" />
      Kill Idle Sessions
     </button>
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground shadow-sm h-9 px-4 w-full sm:w-auto">
      <ShieldAlertIcon className="w-4 h-4" />
      Emergency Stop All
     </button>
    </div>
   </div>

   {/* Stats Grid */}
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
    <StatsCard
     title="Active Sessions"
     value={stats.active + stats.busy}
     icon={<ZapIcon className="w-5 h-5" />}
     color="success"
    />
    <StatsCard
     title="Idle Sessions"
     value={stats.idle}
     icon={<ClockIcon className="w-5 h-5" />}
     color="info"
    />
    <StatsCard
     title="Today's Sessions"
     value={stats.total_sessions}
     icon={<ActivityIcon className="w-5 h-5" />}
     color="accent"
    />
    <StatsCard
     title="Total Tokens Used"
     value={stats.total_tokens.toLocaleString()}
     subtitle={`Est. Cost: $${stats.total_cost.toFixed(4)}`}
     icon={<BanknoteIcon className="w-5 h-5" />}
     color="warning"
    />
   </div>

   {/* Session Status Overview */}
   <div className="rounded-xl border border-border bg-card shadow-sm p-5 md:p-6 bg-gradient-to-br from-card to-muted/20">
    <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-4 uppercase">
     <ActivityIcon className="w-4 h-4 text-primary" />
     Session Status Overview
    </h2>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
     <div className="flex flex-col items-center justify-center p-4 bg-background border border-border/50 rounded-lg hover:border-emerald-500/30 transition-colors group">
      <div className="text-3xl font-bold text-emerald-500 ">{stats.active}</div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Active</div>
     </div>
     <div className="flex flex-col items-center justify-center p-4 bg-background border border-border/50 rounded-lg hover:border-amber-500/30 transition-colors group">
      <div className="text-3xl font-bold text-amber-500 ">{stats.busy}</div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Busy</div>
     </div>
     <div className="flex flex-col items-center justify-center p-4 bg-background border border-border/50 rounded-lg hover:border-blue-500/30 transition-colors group">
      <div className="text-3xl font-bold text-blue-500 ">{stats.idle}</div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Idle</div>
     </div>
     <div className="flex flex-col items-center justify-center p-4 bg-background border border-border/50 rounded-lg hover:border-destructive/30 transition-colors group">
      <div className="text-3xl font-bold text-destructive ">{stats.error}</div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Error</div>
     </div>
     <div className="flex flex-col items-center justify-center p-4 bg-background border border-border/50 rounded-lg hover:border-border transition-colors group col-span-2 sm:col-span-1 lg:col-span-1">
      <div className="text-3xl font-bold text-foreground ">{stats.total}</div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Total</div>
     </div>
    </div>
   </div>

   {/* Sessions by Interface */}
   {activeSessions.length > 0 ? (
    <div className="space-y-8">
     {Object.entries(sessionsByInterface).map(([interfaceType, sessions]: [string, AgentSession[]]) => (
      <div key={interfaceType} className="space-y-4">
       <div className="flex items-center justify-between pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
         <h2 className="text-lg font-semibold tracking-tight text-foreground capitalize">
          {interfaceType} Sessions
         </h2>
         <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          {sessions.length}
         </span>
        </div>
        <button className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-destructive hover:text-destructive-foreground bg-destructive/10 hover:bg-destructive rounded-md transition-colors border border-destructive/20">
         <PowerOffIcon className="w-3.5 h-3.5" />
         Kill All {interfaceType}
        </button>
       </div>
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sessions.map((session: AgentSession) => (
         <SessionCard key={session.id} session={session} />
        ))}
       </div>
      </div>
     ))}
    </div>
   ) : (
    <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
     <div className="w-16 h-16 mb-6 rounded-2xl bg-muted flex items-center justify-center ring-1 ring-border/50">
      <MessageSquareIcon className="w-8 h-8 text-muted-foreground" />
     </div>
     <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">No active sessions</h3>
     <p className="text-sm text-muted-foreground max-w-sm">
      Sessions will appear here when agents start processing requests.
     </p>
    </div>
   )}

   {/* Session History */}
   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
     <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 uppercase">
      <ClockIcon className="w-4 h-4 text-primary" />
      Recent Session History
     </h2>
     <a href="/admin/sessions/history" className="inline-flex items-center text-xs font-medium text-primary hover:text-primary/80 transition-colors">
      View all history &rarr;
     </a>
    </div>
    <div className="p-12 text-center flex flex-col items-center justify-center min-h-[200px]">
     <InfoIcon className="w-8 h-8 text-muted-foreground/50 mb-3" />
     <p className="text-sm font-medium text-foreground">Session history feature coming soon</p>
     <p className="text-xs text-muted-foreground mt-1">This panel will show completed and historical sessions.</p>
    </div>
   </div>
  </div>
 );
}
