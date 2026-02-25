import { settingsModel } from "@/database";
import { SettingsForm } from "./SettingsForm";
import { SystemUpdatePanel } from "@/components/SystemUpdatePanel";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
 const user = await getCurrentUser();
 if (!user) redirect("/login");
 if (!hasPermission(user, Permission.SYSTEM_SETTINGS_READ)) {
  redirect("/");
 }

 const settings = settingsModel.getAll();
 const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col gap-1.5">
    <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
    <p className="text-sm text-muted-foreground">Configure system settings and preferences</p>
   </div>

   <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
    <div className="space-y-6">
     <SettingsForm settings={settingsMap} />
    </div>

    <div className="space-y-6">
     {/* System Info */}
     <div className="card-hover rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
       <h2 className="text-sm font-semibold tracking-tight text-foreground">System Information</h2>
      </div>
      <div className="p-5 space-y-4 text-sm">
       <div className="flex justify-between items-center p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-muted-foreground font-medium">Version</span>
        <span className="text-foreground font-mono text-xs">1.0.0</span>
       </div>
       <div className="flex justify-between items-center p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-muted-foreground font-medium">Node.js</span>
        <span className="text-foreground font-mono text-xs">{process.version}</span>
       </div>
       <div className="flex justify-between items-center p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-muted-foreground font-medium">Platform</span>
        <span className="text-foreground font-mono text-xs">{process.platform}</span>
       </div>
       <div className="flex justify-between items-center p-2 rounded-md bg-muted/30 border border-border/50">
        <span className="text-muted-foreground font-medium">Environment</span>
        <span className="text-foreground font-mono text-xs">{process.env.NODE_ENV || "development"}</span>
       </div>
      </div>
     </div>

     <SystemUpdatePanel title="Updates" showAutoUpdate />

     {/* Danger Zone */}
     <div className="rounded-xl border border-destructive/20 bg-destructive/5 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-destructive/20 bg-destructive/10 flex items-center gap-2">
       <svg className="w-4 h-4 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
       <h2 className="text-sm font-semibold tracking-tight text-destructive">Danger Zone</h2>
      </div>
      <div className="p-5">
       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
         <h3 className="text-sm font-medium text-foreground">Clear Data</h3>
         <p className="text-xs text-muted-foreground mt-1">Clear all conversations and messages. This action cannot be undone.</p>
        </div>
        <button className="shrink-0 px-4 py-2 text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive border border-destructive/20 rounded-md transition-colors shadow-sm">
         Clear All Data
        </button>
       </div>
      </div>
     </div>
    </div>
   </div>
  </div>
 );
}
