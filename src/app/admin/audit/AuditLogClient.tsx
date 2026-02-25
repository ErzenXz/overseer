"use client";

import { useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { AuditLogEntry } from "@/components/admin/AuditLogEntry";
import type { Log } from "@/types/database";
import { cn } from "@/lib/utils";
import { DownloadIcon, Trash2Icon, SearchIcon, FilterIcon, RefreshCcwIcon, InfoIcon, ShieldAlertIcon, AlertCircleIcon, DatabaseIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

interface AuditLogClientProps {
 logs: Log[];
 stats: { level: string; count: number }[];
}

export default function AuditLogClient({ logs, stats }: AuditLogClientProps) {
 const [levelFilter, setLevelFilter] = useState<string>("all");
 const [categoryFilter, setCategoryFilter] = useState<string>("all");
 const [searchQuery, setSearchQuery] = useState("");

 const filteredLogs = logs.filter((log) => {
  const matchesLevel = levelFilter === "all" || log.level === levelFilter;
  const matchesCategory = categoryFilter === "all" || log.category === categoryFilter;
  const matchesSearch = searchQuery === "" ||
   log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
   log.category.toLowerCase().includes(searchQuery.toLowerCase());
  return matchesLevel && matchesCategory && matchesSearch;
 });

 const categories = Array.from(new Set(logs.map((log) => log.category)));

 const errorCount = stats.find((entry) => entry.level === "error")?.count || 0;
 const warnCount = stats.find((entry) => entry.level === "warn")?.count || 0;
 const infoCount = stats.find((entry) => entry.level === "info")?.count || 0;
 const debugCount = stats.find((entry) => entry.level === "debug")?.count || 0;

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Log</h1>
     <p className="text-sm text-muted-foreground">Security and system activity audit trail</p>
    </div>
    <div className="flex items-center gap-3">
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-9 px-4">
      <DownloadIcon className="w-4 h-4" />
      Export Logs
     </button>
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm h-9 px-4">
      <Trash2Icon className="w-4 h-4" />
      Clear Old Logs
     </button>
    </div>
   </div>

   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
    <StatsCard
     title="Error Logs"
     value={errorCount}
     subtitle="Last 24 hours"
     icon={<ShieldAlertIcon className="w-5 h-5 text-destructive" />}
     color="danger"
    />
    <StatsCard
     title="Warning Logs"
     value={warnCount}
     subtitle="Last 24 hours"
     icon={<AlertCircleIcon className="w-5 h-5 text-amber-500" />}
     color="warning"
    />
    <StatsCard
     title="Info Logs"
     value={infoCount}
     subtitle="Last 24 hours"
     icon={<InfoIcon className="w-5 h-5 text-info" />}
     color="info"
    />
    <StatsCard
     title="Total Entries"
     value={logs.length}
     subtitle="In database"
     icon={<DatabaseIcon className="w-5 h-5 text-primary" />}
     color="accent"
    />
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm p-6 space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
     <div className="md:col-span-2 space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Search</label>
      <div className="relative">
       <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
       <Input
        type="text"
        placeholder="Search logs..."
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        className="w-full h-9 pl-9 pr-4 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
       />
      </div>
     </div>

     <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Level</label>
      <div className="relative">
       <FilterIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
       <NativeSelect
        value={levelFilter}
        onChange={(event) => setLevelFilter(event.target.value)}
        className="w-full h-9 pl-9 pr-8 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors appearance-none"
       >
        <option value="all">All Levels</option>
        <option value="error">Error</option>
        <option value="warn">Warning</option>
        <option value="info">Info</option>
        <option value="debug">Debug</option>
       </NativeSelect>
      </div>
     </div>

     <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
      <div className="relative">
       <FilterIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
       <NativeSelect
        value={categoryFilter}
        onChange={(event) => setCategoryFilter(event.target.value)}
        className="w-full h-9 pl-9 pr-8 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors appearance-none"
       >
        <option value="all">All Categories</option>
        {categories.map((category) => (
         <option key={category} value={category}>{category}</option>
        ))}
       </NativeSelect>
      </div>
     </div>
    </div>

    <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-border/50">
     <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-2">Quick filter:</span>
     {["all", "error", "warn", "info", "debug"].map((level) => {
      const isActive = levelFilter === level;
      return (
       <button
        key={level}
        onClick={() => setLevelFilter(level)}
        className={cn(
         "px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors duration-200 border",
         isActive
          ? level === "error" ? "bg-destructive/10 text-destructive border-destructive/20 shadow-sm"
          : level === "warn" ? "bg-amber-500/10 text-amber-500 border-amber-500/20 shadow-sm"
          : level === "info" ? "bg-info/10 text-info border-info/20 shadow-sm"
          : level === "debug" ? "bg-muted text-foreground border-border shadow-sm"
          : "bg-primary/10 text-primary border-primary/20 shadow-sm"
          : "bg-transparent text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground"
        )}
       >
        {level}
       </button>
      );
     })}
    </div>
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
     <div>
      <h2 className="text-sm font-semibold tracking-tight text-foreground">Log Entries</h2>
      <p className="text-[11px] text-muted-foreground mt-0.5">
       Showing <span className="font-medium text-foreground">{filteredLogs.length}</span> of <span className="font-medium text-foreground">{logs.length}</span> entries
      </p>
     </div>
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-8 px-3">
      <RefreshCcwIcon className="w-3.5 h-3.5" />
      Auto-refresh
     </button>
    </div>

    <div className="divide-y divide-border/50 bg-muted/5">
     {filteredLogs.length > 0 ? (
      filteredLogs.map((log) => (
       <AuditLogEntry key={log.id} log={log} />
      ))
     ) : (
      <div className="flex flex-col items-center justify-center p-12 text-center">
       <div className="w-16 h-16 mb-4 rounded-full bg-muted flex items-center justify-center ring-1 ring-border/50">
        <SearchIcon className="w-8 h-8 text-muted-foreground opacity-50" />
       </div>
       <h3 className="text-sm font-medium text-foreground mb-1">No logs found</h3>
       <p className="text-[11px] text-muted-foreground">Try adjusting your filters or search query</p>
      </div>
     )}
    </div>
   </div>

   <div className="rounded-xl border border-info/20 bg-info/5 p-5 flex items-start gap-4">
    <div className="p-2 bg-info/10 rounded-lg shrink-0 ring-1 ring-info/20">
     <InfoIcon className="w-5 h-5 text-info" />
    </div>
    <div>
     <h3 className="text-sm font-medium text-info mb-1.5 tracking-tight">Log Retention Policy</h3>
     <p className="text-xs text-info/80 leading-relaxed">
      Logs are automatically cleaned up after 30 days. Critical security events are retained for 90 days.
      You can export logs at any time for long-term archival.
     </p>
    </div>
   </div>
  </div>
 );
}
