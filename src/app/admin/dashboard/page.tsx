import { redirect } from "next/navigation";
import { conversationsModel, messagesModel, providersModel, interfacesModel, toolExecutionsModel } from "@/database";
import { StatsCard } from "@/components/StatsCard";
import { getCurrentUser } from "@/lib/auth";
import { getUserPermissions, hasPermission, Permission } from "@/lib/permissions";
import { getUserSandboxRoot } from "@/lib/userfs";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
 const user = await getCurrentUser();
 if (!user) {
  redirect("/login");
 }

 const hasProviders = providersModel.findAll().length > 0;
 if (!hasProviders) {
  redirect("/admin/onboarding");
 }

 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
 const ownerId = canViewAll ? undefined : user.id;

 // Get stats
 const conversationCount = conversationsModel.count(ownerId);
 const messageCount = messagesModel.count();
 const totalTokens = messagesModel.getTotalTokens();
 const providerCount = providersModel.findActive().length;
 const interfaceCount = canViewAll
  ? interfacesModel.findActive().length
  : interfacesModel.findActiveByOwner(user.id).length;
 const toolStats = toolExecutionsModel.getStats();
 const totalToolExecutions = toolStats.reduce((acc, s) => acc + s.count, 0);

 // Get recent conversations
 const recentConversations = conversationsModel.findAll(5, 0, ownerId);

 // Get recent tool executions
 const recentToolExecutions = toolExecutionsModel.findRecent(10);

 // Tenant panel data (always scoped to current web user unless tenant:view_all is granted).
 const sandboxRoot = getUserSandboxRoot({ kind: "web", id: String(user.id) });
 const enabledInterfacesForUser = interfacesModel.findActiveByOwner(user.id);
 const effectivePerms = new Set(getUserPermissions(user));
 const systemPerms = [
  { perm: Permission.SYSTEM_SHELL, label: "Shell" },
  { perm: Permission.SYSTEM_FILES_READ, label: "Files: Read" },
  { perm: Permission.SYSTEM_FILES_WRITE, label: "Files: Write" },
  { perm: Permission.SYSTEM_FILES_DELETE, label: "Files: Delete" },
 ] as const;

 return (
  <div className="space-y-8 animate-in fade-in duration-200">
   <div className="flex flex-col gap-1.5">
    <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
    <p className="text-sm text-muted-foreground">Welcome back, {user.username}. Here's what's happening with your agent.</p>
   </div>

   {/* Stats Grid */}
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    <StatsCard
     title="Conversations"
     value={conversationCount}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
     }
     color="accent"
    />
    <StatsCard
     title="Messages"
     value={messageCount}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
     }
     color="success"
    />
    <StatsCard
     title="Tokens Used"
     value={totalTokens.toLocaleString()}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
     }
     color="warning"
    />
    <StatsCard
     title="Tool Executions"
     value={totalToolExecutions}
     icon={
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      </svg>
     }
     color="info"
    />
   </div>

   <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
    {/* Main Left Column */}
    <div className="xl:col-span-2 space-y-6">
     {/* Tenant Panel */}
     <div className="card-hover rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-border/50 bg-muted/20 flex items-center justify-between">
       <h2 className="text-sm font-semibold tracking-tight text-foreground">Sandbox & Access</h2>
       <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-widest">Workspace</span>
      </div>
      
      <div className="p-6">
       <div className="flex flex-col md:flex-row gap-8">
        <div className="flex-1">
         <h3 className="text-sm font-medium text-foreground mb-4">Environment</h3>
         <div className="space-y-4">
          <div>
           <p className="text-xs text-muted-foreground mb-1.5">Sandbox Root Directory</p>
           <div className="font-mono text-xs text-foreground break-all bg-muted/50 border border-border rounded-md px-3 py-2">
            {sandboxRoot}
           </div>
           <p className="mt-2 text-[11px] text-muted-foreground">
            All web and connector chats for your user run in this isolated environment.
           </p>
          </div>
         </div>
        </div>

        <div className="w-full md:w-64 shrink-0">
         <h3 className="text-sm font-medium text-foreground mb-4">Host Capabilities</h3>
         <div className="flex flex-col gap-2">
          {systemPerms.map((p) => {
           const ok = effectivePerms.has(p.perm);
           return (
            <div key={p.perm} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50">
             <span className="text-xs font-medium text-foreground">{p.label}</span>
             <span
              className={cn(
               "text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold",
               ok ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
              )}
             >
              {ok ? "GRANTED" : "DENIED"}
             </span>
            </div>
           );
          })}
         </div>
         {!effectivePerms.has(Permission.SYSTEM_SHELL) &&
          !effectivePerms.has(Permission.SYSTEM_FILES_READ) &&
          !effectivePerms.has(Permission.SYSTEM_FILES_WRITE) &&
          !effectivePerms.has(Permission.SYSTEM_FILES_DELETE) && (
           <p className="mt-3 text-[11px] text-muted-foreground bg-amber-500/10 text-amber-500 border border-amber-500/20 p-2 rounded-md">
            Your workspace is sandboxed. Ask an administrator if you require VPS-level access.
           </p>
          )}
        </div>
       </div>
      </div>
     </div>

     {/* Recent Conversations */}
     <div className="card-hover rounded-xl border border-border bg-card shadow-sm">
      <div className="px-6 py-5 border-b border-border/50 bg-muted/20 flex items-center justify-between">
       <h2 className="text-sm font-semibold tracking-tight text-foreground">Recent Conversations</h2>
       <a href="/admin/conversations" className="text-xs font-medium text-primary hover:underline">View All</a>
      </div>
      
      <div className="divide-y divide-border/50">
       {recentConversations.length > 0 ? (
        recentConversations.map((conv) => (
         <a
          key={conv.id}
          href={`/admin/conversations/${conv.id}`}
          className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group"
         >
          <div>
           <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
            {conv.external_username || conv.external_user_id}
           </p>
           <p className="text-xs text-muted-foreground mt-1">
            {conv.message_count} messages
           </p>
          </div>
          <div className="text-right">
           <span className="inline-flex text-[10px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
            {conv.interface_type}
           </span>
           <p className="text-xs text-muted-foreground mt-1.5">
            {new Date(conv.updated_at).toLocaleDateString()}
           </p>
          </div>
         </a>
        ))
       ) : (
        <div className="p-8 text-center">
         <p className="text-sm text-muted-foreground">No conversations yet</p>
        </div>
       )}
      </div>
     </div>
    </div>

    {/* Sidebar Right Column */}
    <div className="space-y-6">
     {/* System Status */}
     <div className="card-hover rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
       <h2 className="text-sm font-semibold tracking-tight text-foreground">Health & Status</h2>
      </div>
      <div className="p-5 space-y-4">
       <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
         <div className="relative flex h-2 w-2">
          {providerCount > 0 ? (
           <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
           </>
          ) : (
           <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
          )}
         </div>
         <span className="text-sm font-medium text-foreground">Models</span>
        </div>
        <span className="text-xs text-muted-foreground">{providerCount} Active</span>
       </div>
       
       <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
         <div className="relative flex h-2 w-2">
          {interfaceCount > 0 ? (
           <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
           </>
          ) : (
           <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          )}
         </div>
         <span className="text-sm font-medium text-foreground">Connectors</span>
        </div>
        <span className="text-xs text-muted-foreground">{interfaceCount} Enabled</span>
       </div>

       <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
         <div className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
         </div>
         <span className="text-sm font-medium text-foreground">Core Agent</span>
        </div>
        <span className="text-xs font-medium text-emerald-500">Online</span>
       </div>
      </div>
     </div>

     {/* Quick Actions */}
     <div className="card-hover rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
       <h2 className="text-sm font-semibold tracking-tight text-foreground">Quick Actions</h2>
      </div>
      <div className="p-3 grid grid-cols-2 gap-2">
       <a
        href="/admin/providers"
        className="flex flex-col items-center justify-center p-4 gap-2 rounded-lg bg-muted/30 hover:bg-primary/5 hover:text-primary transition-colors text-foreground border border-border/50 hover:border-primary/20"
       >
        <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-xs font-medium text-center">LLM Providers</span>
       </a>
       <a
        href="/admin/interfaces"
        className="flex flex-col items-center justify-center p-4 gap-2 rounded-lg bg-muted/30 hover:bg-primary/5 hover:text-primary transition-colors text-foreground border border-border/50 hover:border-primary/20"
       >
        <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-1" />
        </svg>
        <span className="text-xs font-medium text-center">Interfaces</span>
       </a>
       <a
        href="/admin/soul"
        className="flex flex-col items-center justify-center p-4 gap-2 rounded-lg bg-muted/30 hover:bg-primary/5 hover:text-primary transition-colors text-foreground border border-border/50 hover:border-primary/20"
       >
        <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span className="text-xs font-medium text-center">Edit Soul</span>
       </a>
       <a
        href="/admin/audit"
        className="flex flex-col items-center justify-center p-4 gap-2 rounded-lg bg-muted/30 hover:bg-primary/5 hover:text-primary transition-colors text-foreground border border-border/50 hover:border-primary/20"
       >
        <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-medium text-center">Audit Logs</span>
       </a>
      </div>
     </div>

     {/* Recent Tool Executions */}
     <div className="card-hover rounded-xl border border-border bg-card shadow-sm">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
       <h2 className="text-sm font-semibold tracking-tight text-foreground">Recent Tools</h2>
       <a href="/admin/tools" className="text-xs font-medium text-primary hover:underline">View All</a>
      </div>
      <div className="divide-y divide-border/50">
       {recentToolExecutions.length > 0 ? (
        recentToolExecutions.slice(0, 5).map((exec) => (
         <div key={exec.id} className="p-4 flex items-center justify-between">
          <div>
           <p className="text-sm font-mono text-foreground">{exec.tool_name}</p>
           <p className="text-xs text-muted-foreground mt-1">
            {exec.execution_time_ms ? `${exec.execution_time_ms}ms` : '-'}
           </p>
          </div>
          <span className={cn(
           "text-[10px] font-mono px-2 py-0.5 rounded font-semibold",
           exec.success ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
          )}>
           {exec.success ? 'OK' : 'FAIL'}
          </span>
         </div>
        ))
       ) : (
        <div className="p-6 text-center">
         <p className="text-sm text-muted-foreground">No tool executions yet</p>
        </div>
       )}
      </div>
     </div>
    </div>
   </div>
  </div>
 );
}
