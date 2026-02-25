"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

interface SettingsFormProps {
 settings: Record<string, string>;
}

export function SettingsForm({ settings }: SettingsFormProps) {
 const router = useRouter();
 const [formData, setFormData] = useState({
  "agent.max_steps": settings["agent.max_steps"] || "25",
  "agent.max_retries": settings["agent.max_retries"] || "3",
  "agent.timeout_ms": settings["agent.timeout_ms"] || "120000",
  "tools.require_confirmation": settings["tools.require_confirmation"] || "false",
  "tools.shell_timeout_ms": settings["tools.shell_timeout_ms"] || "30000",
  "tools.max_file_size_mb": settings["tools.max_file_size_mb"] || "10",
 });
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setSaving(true);
  setSaved(false);

  try {
   await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(formData),
   });

   setSaved(true);
   setTimeout(() => setSaved(false), 3000);
   router.refresh();
  } finally {
   setSaving(false);
  }
 };

 return (
  <form onSubmit={handleSubmit} className="card-hover rounded-xl border border-border bg-card shadow-sm overflow-hidden">
   <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
    <h2 className="text-sm font-semibold tracking-tight text-foreground">Agent Settings</h2>
    {saved && <span className="text-[10px] font-medium px-2 py-0.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full uppercase tracking-wider flex items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
     Saved
    </span>}
   </div>

   <div className="p-5 space-y-6">
    <div className="space-y-4">
     <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground tracking-tight">Max Steps</label>
      <Input
       type="number"
       value={formData["agent.max_steps"]}
       onChange={(e) => setFormData((prev) => ({ ...prev, "agent.max_steps": e.target.value }))}
       className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
      />
      <p className="text-[11px] text-muted-foreground">Maximum number of tool-calling steps per request</p>
     </div>

     <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground tracking-tight">Max Retries</label>
      <Input
       type="number"
       value={formData["agent.max_retries"]}
       onChange={(e) => setFormData((prev) => ({ ...prev, "agent.max_retries": e.target.value }))}
       className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
      />
      <p className="text-[11px] text-muted-foreground">Number of retries for failed API calls</p>
     </div>

     <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground tracking-tight">Agent Timeout (ms)</label>
      <Input
       type="number"
       value={formData["agent.timeout_ms"]}
       onChange={(e) => setFormData((prev) => ({ ...prev, "agent.timeout_ms": e.target.value }))}
       className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
      />
     </div>

     <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground tracking-tight">Shell Command Timeout (ms)</label>
      <Input
       type="number"
       value={formData["tools.shell_timeout_ms"]}
       onChange={(e) => setFormData((prev) => ({ ...prev, "tools.shell_timeout_ms": e.target.value }))}
       className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
      />
     </div>

     <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground tracking-tight">Max File Size (MB)</label>
      <Input
       type="number"
       value={formData["tools.max_file_size_mb"]}
       onChange={(e) => setFormData((prev) => ({ ...prev, "tools.max_file_size_mb": e.target.value }))}
       className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
      />
     </div>
    </div>

    <div className="pt-4 border-t border-border/50">
     <label htmlFor="require_confirmation" className="flex items-center gap-3 cursor-pointer group">
      <div className="relative flex items-center justify-center">
       <Input
        type="checkbox"
        id="require_confirmation"
        checked={formData["tools.require_confirmation"] === "true"}
        onChange={(e) =>
         setFormData((prev) => ({
          ...prev,
          "tools.require_confirmation": e.target.checked ? "true" : "false",
         }))
        }
        className="peer sr-only"
       />
       <div className="w-5 h-5 rounded-md border border-border bg-background peer-checked:bg-primary peer-checked:border-primary transition-colors duration-200 shadow-sm flex items-center justify-center group-hover:border-primary/50 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
        <svg className="w-3.5 h-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100 transition-opacity duration-200 scale-50 peer-checked:scale-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
       </div>
      </div>
      <span className="text-sm font-medium text-foreground tracking-tight select-none">
       Require confirmation for destructive commands
      </span>
     </label>
    </div>

    <div className="pt-2">
     <button
      type="submit"
      disabled={saving}
      className="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 shadow-sm"
     >
      {saving ? (
       <><svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Saving...</>
      ) : (
       "Save Settings"
      )}
     </button>
    </div>
   </div>
  </form>
 );
}
