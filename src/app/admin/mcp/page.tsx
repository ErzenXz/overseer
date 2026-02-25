import { StatsCard } from "@/components/StatsCard";
import * as mcpClient from "@/agent/mcp/client";
import { MCPServersList } from "./MCPServersList";
import { ServerIcon, NetworkIcon, CheckCircle2Icon, WrenchIcon, PlusIcon, TerminalIcon, GlobeIcon, ActivityIcon, InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MCPPage() {
 const allServers = mcpClient.getAllServers();
 const connectionStatus = mcpClient.getConnectionStatus();
 const connectedCount = connectionStatus.length;
 const totalTools = connectionStatus.reduce((acc, s) => acc + s.tools, 0);

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
   {/* Header */}
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">MCP Servers</h1>
      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 uppercase tracking-wider">
       Integration
      </span>
     </div>
     <p className="text-sm text-muted-foreground flex items-center gap-1.5">
      <NetworkIcon className="w-4 h-4" />
      Manage Model Context Protocol server connections and tools
     </p>
    </div>
    <a
     href="/admin/mcp/add"
     className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 w-full sm:w-auto"
    >
     <PlusIcon className="w-4 h-4" />
     Add MCP Server
    </a>
   </div>

   {/* Stats Grid */}
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
    <StatsCard
     title="Total Servers"
     value={allServers.length}
     icon={<ServerIcon className="w-5 h-5" />}
     color="accent"
    />
    <StatsCard
     title="Connected"
     value={connectedCount}
     icon={<CheckCircle2Icon className="w-5 h-5" />}
     color="success"
    />
    <StatsCard
     title="Active Servers"
     value={allServers.filter(s => s.is_active).length}
     icon={<ActivityIcon className="w-5 h-5" />}
     color="info"
    />
    <StatsCard
     title="Available Tools"
     value={totalTools}
     icon={<WrenchIcon className="w-5 h-5" />}
     color="warning"
    />
   </div>

   {/* Connection Status */}
   {connectionStatus.length > 0 && (
    <div className="rounded-xl border border-border bg-card shadow-sm p-5 md:p-6">
     <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-4 uppercase">
      <ActivityIcon className="w-4 h-4 text-primary" />
      Active Connections
     </h2>
     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {connectionStatus.map((status) => (
       <div key={status.server} className="flex items-center justify-between p-3.5 bg-muted/30 border border-border/50 rounded-lg hover:bg-muted/50 transition-colors group">
        <div className="flex items-center gap-3 truncate pr-2">
         <div className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
         </div>
         <span className="text-sm font-medium text-foreground truncate">{status.server}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
         <span className="px-2 py-0.5 rounded-md bg-background border border-border text-xs font-mono text-muted-foreground group-hover:border-primary/30 transition-colors">
          {status.tools}
         </span>
         <WrenchIcon className="w-3.5 h-3.5 text-muted-foreground/70" />
        </div>
       </div>
      ))}
     </div>
    </div>
   )}

   {/* Servers List */}
   {allServers.length === 0 ? (
    <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
     <div className="w-16 h-16 mb-6 rounded-2xl bg-muted flex items-center justify-center ring-1 ring-border/50">
      <NetworkIcon className="w-8 h-8 text-muted-foreground" />
     </div>
     <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">No MCP servers configured</h3>
     <p className="text-sm text-muted-foreground max-w-md mb-6">
      Add MCP servers to extend your agent with additional tools, integrations, and capabilities.
     </p>
     <a
      href="/admin/mcp/add"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4"
     >
      <PlusIcon className="w-4 h-4" />
      Add Your First Server
     </a>
    </div>
   ) : (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <MCPServersList servers={allServers} connectionStatus={connectionStatus} />
    </div>
   )}

   {/* Info Section */}
   <div className="rounded-xl border border-border bg-card shadow-sm p-5 md:p-6 bg-gradient-to-br from-card to-muted/20">
    <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-3 uppercase">
     <InfoIcon className="w-4 h-4 text-primary" />
     About MCP
    </h2>
    <p className="text-sm text-muted-foreground mb-5 max-w-3xl leading-relaxed">
     Model Context Protocol (MCP) allows your agent to connect to external servers that provide additional tools and capabilities.
     MCP servers can be run locally via standard input/output (stdio) or accessed remotely via Server-Sent Events (SSE).
    </p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
     <div className="p-4 bg-background border border-border/50 rounded-lg hover:border-border transition-colors group">
      <div className="flex items-center gap-2 mb-2">
       <div className="w-8 h-8 rounded-md bg-blue-500/10 text-blue-500 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
        <TerminalIcon className="w-4 h-4" />
       </div>
       <h3 className="font-semibold text-sm text-foreground">STDIO Servers</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed pl-10">
       Run local processes that communicate via stdin/stdout. Best for tools that need direct filesystem access or local execution.
      </p>
     </div>
     <div className="p-4 bg-background border border-border/50 rounded-lg hover:border-border transition-colors group">
      <div className="flex items-center gap-2 mb-2">
       <div className="w-8 h-8 rounded-md bg-purple-500/10 text-purple-500 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
        <GlobeIcon className="w-4 h-4" />
       </div>
       <h3 className="font-semibold text-sm text-foreground">SSE Servers</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed pl-10">
       Connect to remote servers via Server-Sent Events. Best for shared services, APIs, and cloud-hosted tools.
      </p>
     </div>
    </div>
   </div>
  </div>
 );
}
