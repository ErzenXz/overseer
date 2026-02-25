"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SaveIcon, RefreshCcwIcon, AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface SoulEditorProps {
 initialContent: string;
 isCustom: boolean;
 defaultSoul: string;
}

export function SoulEditor({ initialContent, isCustom, defaultSoul }: SoulEditorProps) {
 const router = useRouter();
 const [content, setContent] = useState(initialContent);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [error, setError] = useState("");

 const hasChanges = content !== initialContent;

 const handleSave = async () => {
  setSaving(true);
  setError("");
  setSaved(false);

  try {
   const res = await fetch("/api/soul", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
   });

   if (!res.ok) {
    const data = await res.json();
    setError(data.error || "Failed to save");
    return;
   }

   setSaved(true);
   setTimeout(() => setSaved(false), 3000);
   router.refresh();
  } catch {
   setError("An error occurred");
  } finally {
   setSaving(false);
  }
 };

 const handleReset = async () => {
  if (!confirm("Clear your personal SOUL supplement? (This does not affect the base soul.)")) {
   return;
  }

  try {
   const res = await fetch("/api/soul", { method: "DELETE" });
   if (res.ok) {
    setContent(defaultSoul);
    router.refresh();
   }
  } catch {
   setError("Failed to reset");
  }
 };

 return (
  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[calc(100vh-12rem)]">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:px-6 border-b border-border/50 bg-muted/20 gap-4 shrink-0">
    <div className="flex items-center gap-3">
     <h2 className="text-sm font-semibold tracking-tight text-foreground font-mono">SOUL.md</h2>
     {hasChanges && (
      <span className="text-[10px] font-medium px-2 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-full uppercase tracking-wider animate-in fade-in zoom-in-95 duration-200">
       Unsaved changes
      </span>
     )}
     {saved && (
      <span className="text-[10px] font-medium px-2 py-0.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full uppercase tracking-wider flex items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
       <CheckCircle2Icon className="w-3 h-3" /> Saved
      </span>
     )}
    </div>
    <div className="flex items-center gap-2 w-full sm:w-auto">
     {isCustom && (
      <button
       onClick={handleReset}
       className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground h-8 px-3 shadow-sm"
      >
       <RefreshCcwIcon className="w-3.5 h-3.5" />
       Clear
      </button>
     )}
     <button
      onClick={handleSave}
      disabled={saving || !hasChanges}
      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-8 px-4"
     >
      {saving ? (
       <><svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Saving...</>
      ) : (
       <><SaveIcon className="w-3.5 h-3.5" /> Save Changes</>
      )}
     </button>
    </div>
   </div>

   {error && (
    <div className="p-3 mx-4 mt-4 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
     <AlertCircleIcon className="w-4 h-4" />
     {error}
    </div>
   )}

   <Textarea
    value={content}
    onChange={(e) => setContent(e.target.value)}
    className="flex-1 w-full p-6 bg-transparent text-foreground/90 font-mono text-[13px] leading-relaxed resize-none focus:outline-none custom-scrollbar"
    placeholder="# Overseer Soul Document

## Identity
..."
    spellCheck={false}
   />
  </div>
 );
}
