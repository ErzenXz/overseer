import {
 loadSoul,
 loadBaseSoul,
 loadUserSoulSupplement,
 isUsingUserSoulSupplement,
} from "@/agent";
import { getCurrentUser } from "@/lib/auth";
import { SoulEditor } from "./SoulEditor";
import { cn } from "@/lib/utils";
import { InfoIcon, FileTextIcon, ActivityIcon } from "lucide-react";

export default async function SoulPage() {
 const user = await getCurrentUser();
 if (!user) {
  // Dashboard routes are typically protected by middleware; keep a safe fallback.
  return null;
 }

 const baseSoul = loadBaseSoul();
 const supplement = loadUserSoulSupplement(user.id);
 const effectiveSoul = loadSoul(user.id);
 const isCustom = isUsingUserSoulSupplement(user.id);

 // For per-user supplements, "reset" means: remove supplement (empty).
 const defaultSupplement = "";

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col gap-1.5">
    <h1 className="text-2xl font-bold tracking-tight text-foreground">
     Soul Document
    </h1>
    <p className="text-sm text-muted-foreground">
     Personalize how your assistant behaves. This is per-user (tenant-scoped).
    </p>
   </div>

   <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
    <div className="lg:col-span-2">
     <SoulEditor
      initialContent={supplement}
      isCustom={isCustom}
      defaultSoul={defaultSupplement}
     />
    </div>

    <div className="space-y-6">
     {/* Info Card */}
     <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center gap-2">
       <InfoIcon className="w-4 h-4 text-primary" />
       <h2 className="text-sm font-semibold tracking-tight text-foreground">
        How It Works
       </h2>
      </div>
      <div className="p-5 space-y-4 text-sm text-muted-foreground leading-relaxed">
       <p>
        The agent uses a base <code className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/50 font-mono text-[11px] text-foreground">SOUL.md</code> plus an optional per-user supplement.
       </p>
       <p>
        Use this editor to override style, preferences, and personality for your own
        tenant without affecting other users.
       </p>
      </div>
     </div>

     {/* Status */}
     <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center gap-2">
       <ActivityIcon className="w-4 h-4 text-primary" />
       <h2 className="text-sm font-semibold tracking-tight text-foreground">
        Status
       </h2>
      </div>
      <div className="p-5 space-y-3">
       <div className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-xs font-medium text-foreground">Supplement</span>
        <span className={cn(
         "text-[10px] font-mono px-2 py-0.5 rounded font-semibold uppercase tracking-wider",
         isCustom ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-muted text-muted-foreground border border-border/50"
        )}>
         {isCustom ? "Enabled" : "None"}
        </span>
       </div>
       <div className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-xs font-medium text-foreground">Effective chars</span>
        <span className="text-xs font-mono text-muted-foreground tabular-nums bg-background px-1.5 py-0.5 rounded border border-border/50">
         {effectiveSoul.length.toLocaleString()}
        </span>
       </div>
       <div className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-xs font-medium text-foreground">Effective lines</span>
        <span className="text-xs font-mono text-muted-foreground tabular-nums bg-background px-1.5 py-0.5 rounded border border-border/50">
         {effectiveSoul.split("\n").length.toLocaleString()}
        </span>
       </div>
      </div>
     </div>

     {/* Base Soul Preview */}
     <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center gap-2">
       <FileTextIcon className="w-4 h-4 text-primary" />
       <h2 className="text-sm font-semibold tracking-tight text-foreground">
        Base Soul
       </h2>
       <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wider border border-border/50">Read-Only</span>
      </div>
      <div className="p-0">
       <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto bg-muted/5 p-5 font-mono leading-relaxed custom-scrollbar">
        {baseSoul}
       </pre>
      </div>
     </div>
    </div>
   </div>
  </div>
 );
}

