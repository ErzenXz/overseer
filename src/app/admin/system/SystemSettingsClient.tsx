"use client";

import { useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import type { Setting } from "@/types/database";
import { SystemUpdatePanel } from "@/components/SystemUpdatePanel";
import { SettingsIcon, RotateCcwIcon, SaveIcon, ActivityIcon, BotIcon, WrenchIcon, ShieldCheckIcon, CheckCircle2Icon, XIcon, DatabaseIcon, PowerOffIcon, Trash2Icon, RefreshCcwIcon, ZapIcon, ShieldAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface SystemSettingsClientProps {
 settings: Setting[];
}

export default function SystemSettingsClient({ settings }: SystemSettingsClientProps) {
 const settingsByCategory: Record<string, Setting[]> = {
  agent: settings.filter((setting) => setting.key.startsWith("agent.")),
  tools: settings.filter((setting) => setting.key.startsWith("tools.")),
  ui: settings.filter((setting) => setting.key.startsWith("ui.")),
  security: settings.filter((setting) => setting.key.startsWith("security.")),
  quota: settings.filter((setting) => setting.key.startsWith("quota.")),
 };

 const [editingSetting, setEditingSetting] = useState<string | null>(null);
 const [editValue, setEditValue] = useState("");

 const handleEdit = (key: string, currentValue: string) => {
  setEditingSetting(key);
  setEditValue(currentValue);
 };

 const handleSave = () => {
  // In production, this would save to database
  console.log("Saving", editingSetting, editValue);
  setEditingSetting(null);
 };

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
   {/* Header */}
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">System Settings</h1>
      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 uppercase tracking-wider">
       Global
      </span>
     </div>
     <p className="text-sm text-muted-foreground flex items-center gap-1.5">
      <SettingsIcon className="w-4 h-4" />
      Configure global system behavior, limits, and security
     </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-9 px-4 w-full sm:w-auto">
      <RotateCcwIcon className="w-4 h-4" />
      Reset to Defaults
     </button>
     <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 w-full sm:w-auto">
      <SaveIcon className="w-4 h-4" />
      Save All Changes
     </button>
    </div>
   </div>

   <div className="mb-6">
    <SystemUpdatePanel title="Updates" showAutoUpdate />
   </div>

   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
    <StatsCard
     title="Total Settings"
     value={settings.length}
     icon={<SettingsIcon className="w-5 h-5" />}
     color="accent"
    />
    <StatsCard
     title="Agent Settings"
     value={settingsByCategory.agent.length}
     icon={<BotIcon className="w-5 h-5" />}
     color="success"
    />
    <StatsCard
     title="Tool Settings"
     value={settingsByCategory.tools.length}
     icon={<WrenchIcon className="w-5 h-5" />}
     color="info"
    />
    <StatsCard
     title="Security Settings"
     value={settingsByCategory.security.length || 0}
     icon={<ShieldCheckIcon className="w-5 h-5" />}
     color="warning"
    />
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-8">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
     <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 uppercase">
      <BotIcon className="w-4 h-4 text-primary" />
      Agent Configuration
     </h2>
    </div>
    <div className="divide-y divide-border/50">
     {settingsByCategory.agent.map((setting) => (
      <div key={setting.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 hover:bg-muted/10 transition-colors group">
       <div className="flex-1">
        <h3 className="text-sm font-medium text-foreground">{setting.key}</h3>
        {setting.description && (
         <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">{setting.description}</p>
        )}
       </div>
       {editingSetting === setting.key ? (
        <div className="flex flex-wrap items-center gap-2 sm:w-auto w-full">
         <Input
          type="text"
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          className="flex-1 sm:w-48 h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
         />
         <div className="flex gap-2 shrink-0">
          <button
           onClick={handleSave}
           className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-background transition-colors border border-emerald-500/20"
          >
           <CheckCircle2Icon className="w-3.5 h-3.5" />
           Save
          </button>
          <button
           onClick={() => setEditingSetting(null)}
           className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors shadow-sm"
          >
           <XIcon className="w-3.5 h-3.5" />
           Cancel
          </button>
         </div>
        </div>
       ) : (
        <div className="flex items-center gap-3 w-full sm:w-auto">
         <code className="flex-1 sm:flex-none text-sm font-medium text-foreground px-3 py-1.5 bg-muted/30 border border-border/50 rounded-md truncate max-w-[200px] text-right" title={setting.value}>
          {setting.value}
         </code>
         <button
          onClick={() => handleEdit(setting.key, setting.value)}
          className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors shadow-sm opacity-0 group-hover:opacity-100 focus-within:opacity-100 shrink-0"
         >
          Edit
         </button>
        </div>
       )}
      </div>
     ))}
    </div>
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-8">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
     <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 uppercase">
      <WrenchIcon className="w-4 h-4 text-primary" />
      Tool Configuration
     </h2>
    </div>
    <div className="divide-y divide-border/50">
     {settingsByCategory.tools.map((setting) => (
      <div key={setting.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 hover:bg-muted/10 transition-colors group">
       <div className="flex-1">
        <h3 className="text-sm font-medium text-foreground">{setting.key}</h3>
        {setting.description && (
         <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-2xl">{setting.description}</p>
        )}
       </div>
       {editingSetting === setting.key ? (
        <div className="flex flex-wrap items-center gap-2 sm:w-auto w-full">
         <Input
          type="text"
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          className="flex-1 sm:w-48 h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
         />
         <div className="flex gap-2 shrink-0">
          <button
           onClick={handleSave}
           className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-background transition-colors border border-emerald-500/20"
          >
           <CheckCircle2Icon className="w-3.5 h-3.5" />
           Save
          </button>
          <button
           onClick={() => setEditingSetting(null)}
           className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors shadow-sm"
          >
           <XIcon className="w-3.5 h-3.5" />
           Cancel
          </button>
         </div>
        </div>
       ) : (
        <div className="flex items-center gap-3 w-full sm:w-auto">
         <code className="flex-1 sm:flex-none text-sm font-medium text-foreground px-3 py-1.5 bg-muted/30 border border-border/50 rounded-md truncate max-w-[200px] text-right" title={setting.value}>
          {setting.value}
         </code>
         <button
          onClick={() => handleEdit(setting.key, setting.value)}
          className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors shadow-sm opacity-0 group-hover:opacity-100 focus-within:opacity-100 shrink-0"
         >
          Edit
         </button>
        </div>
       )}
      </div>
     ))}
    </div>
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-8">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
     <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 uppercase">
      <ActivityIcon className="w-4 h-4 text-primary" />
      Quota & Rate Limits
     </h2>
    </div>
    <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
     {["free", "pro", "enterprise"].map((tier) => (
      <div key={tier} className="flex flex-col p-5 bg-background border border-border/50 rounded-xl hover:border-primary/30 transition-colors group relative overflow-hidden">
       <div className={cn(
        "absolute top-0 left-0 w-full h-1",
        tier === "free" ? "bg-muted-foreground/30" : 
        tier === "pro" ? "bg-primary" : 
        "bg-gradient-to-r from-purple-500 to-primary"
       )} />
       <h3 className="font-semibold text-foreground capitalize mb-4 flex items-center gap-2">
        {tier} Tier
        {tier === "enterprise" && <ZapIcon className="w-3.5 h-3.5 text-purple-500 fill-purple-500/20" />}
       </h3>
       <div className="space-y-3 text-sm flex-1">
        <div className="flex items-center justify-between pb-2 border-b border-border/50">
         <span className="text-muted-foreground">Messages/day</span>
         <span className="font-semibold text-foreground font-mono">
          {tier === "free" ? "100" : tier === "pro" ? "1,000" : "Unlimited"}
         </span>
        </div>
        <div className="flex items-center justify-between pb-2 border-b border-border/50">
         <span className="text-muted-foreground">Tokens/day</span>
         <span className="font-semibold text-foreground font-mono">
          {tier === "free" ? "50K" : tier === "pro" ? "500K" : "Unlimited"}
         </span>
        </div>
        <div className="flex items-center justify-between">
         <span className="text-muted-foreground">Sessions</span>
         <span className="font-semibold text-foreground font-mono">
          {tier === "free" ? "5" : tier === "pro" ? "50" : "Unlimited"}
         </span>
        </div>
       </div>
      </div>
     ))}
    </div>
   </div>

   <div className="rounded-xl border border-destructive/20 bg-destructive/5 overflow-hidden">
    <div className="px-5 py-4 border-b border-destructive/10 bg-destructive/10">
     <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center shrink-0">
       <ShieldAlertIcon className="w-4 h-4 text-destructive" />
      </div>
      <div>
       <h3 className="text-sm font-semibold text-destructive uppercase tracking-wider">Dangerous Operations</h3>
       <p className="text-xs text-destructive/80 mt-1">
        These operations can significantly impact system behavior and user data. Use with extreme caution.
       </p>
      </div>
     </div>
    </div>
    <div className="p-5 flex flex-col sm:flex-row flex-wrap gap-3">
     <button className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium rounded-md bg-background border border-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors shadow-sm">
      <RefreshCcwIcon className="w-3.5 h-3.5" />
      Clear All Caches
     </button>
     <button className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium rounded-md bg-background border border-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors shadow-sm">
      <DatabaseIcon className="w-3.5 h-3.5" />
      Reset Database
     </button>
     <button className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium rounded-md bg-background border border-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors shadow-sm">
      <PowerOffIcon className="w-3.5 h-3.5" />
      Revoke All Sessions
     </button>
     <button className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium rounded-md bg-background border border-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors shadow-sm">
      <Trash2Icon className="w-3.5 h-3.5" />
      Purge System Logs
     </button>
    </div>
   </div>
  </div>
 );
}
