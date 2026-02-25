"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Interface } from "@/types/database";

import { cn } from "@/lib/utils";
import { Loader2, Trash2, Power, FlaskConical, Pencil, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InterfacesListProps {
 interfaces: Interface[];
}

const interfaceIcons: Record<string, React.ReactNode> = {
 telegram: (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
   <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
  </svg>
 ),
 discord: (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
   <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
 ),
 slack: (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
   <path d="M6.3 14.4a2.1 2.1 0 01-2.1-2.1c0-1.15.94-2.1 2.1-2.1h2.1v2.1c0 1.16-.94 2.1-2.1 2.1zm1.05 0c0 1.16.94 2.1 2.1 2.1 1.15 0 2.1-.94 2.1-2.1v-5.25h-4.2v5.25zm2.1-10.9c-1.16 0-2.1.94-2.1 2.1 0 1.15.94 2.1 2.1 2.1h2.1V5.6c0-1.16-.94-2.1-2.1-2.1zm0 1.05h5.25c1.16 0 2.1-.94 2.1-2.1 0-1.15-.94-2.1-2.1-2.1h-5.25v4.2zm10.9 2.1c0-1.16-.94-2.1-2.1-2.1-1.15 0-2.1.94-2.1 2.1v2.1h2.1c1.16 0 2.1-.94 2.1-2.1zm0 1.05h-5.25c-1.16 0-2.1.94-2.1 2.1 0 1.15.94 2.1 2.1 2.1h5.25v-4.2zm-2.1 10.9c1.16 0 2.1-.94 2.1-2.1 0-1.15-.94-2.1-2.1-2.1h-2.1v2.1c0 1.16.94 2.1 2.1 2.1zm0-1.05h-5.25c-1.16 0-2.1.94-2.1 2.1 0 1.15.94 2.1 2.1 2.1h5.25v-4.2z"/>
  </svg>
 ),
 whatsapp: (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
   <path d="M20.52 3.48A11.84 11.84 0 0012 0 11.96 11.96 0 000 12c0 2.12.55 4.17 1.6 5.98L0 24l6.2-1.57A11.93 11.93 0 0012 24a12 12 0 008.52-20.52zM12 21.82c-1.92 0-3.8-.52-5.44-1.5l-.39-.23-3.68.93.98-3.58-.25-.37A9.73 9.73 0 012.18 12 9.82 9.82 0 0112 2.18 9.82 9.82 0 0121.82 12 9.83 9.83 0 0112 21.82zm5.65-7.27c-.31-.16-1.83-.9-2.12-1-.29-.11-.5-.16-.71.16-.2.31-.82 1-.99 1.2-.18.2-.35.23-.66.08-.31-.16-1.29-.48-2.46-1.53-.91-.81-1.52-1.82-1.7-2.13-.18-.31-.02-.47.14-.63.14-.14.31-.35.47-.52.16-.18.2-.31.31-.52.1-.2.05-.39-.03-.55-.08-.16-.71-1.71-.98-2.34-.26-.63-.53-.54-.71-.55h-.6c-.2 0-.52.08-.79.39-.27.31-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.16.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.35.19 1.86.12.57-.08 1.83-.75 2.09-1.47.26-.72.26-1.34.18-1.47-.08-.13-.29-.2-.6-.36z"/>
  </svg>
 ),
};

export function InterfacesList({ interfaces }: InterfacesListProps) {
 const router = useRouter();
 const [deletingId, setDeletingId] = useState<number | null>(null);
 const [testingId, setTestingId] = useState<number | null>(null);
 const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string } | null>(null);

 const parseConfig = (raw: string): Record<string, unknown> => {
  try {
   const parsed = JSON.parse(raw) as Record<string, unknown>;
   return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
   return {};
  }
 };

 const handleDelete = async (id: number) => {
  if (!confirm("Are you sure you want to delete this interface?")) return;

  setDeletingId(id);
  try {
   const res = await fetch(`/api/interfaces/${id}`, { method: "DELETE" });
   if (res.ok) {
    router.refresh();
   }
  } finally {
   setDeletingId(null);
  }
 };

 const handleToggleActive = async (id: number, currentActive: boolean) => {
  await fetch(`/api/interfaces/${id}`, {
   method: "PATCH",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify({ is_active: !currentActive }),
  });
  router.refresh();
 };

 const handleTest = async (id: number) => {
  setTestingId(id);
  setTestResult(null);

  try {
   const res = await fetch(`/api/interfaces/${id}/test`, { method: "POST" });
   const data = await res.json();
   setTestResult({
    id,
    success: Boolean(data.success),
    message: data.message || data.error || "Unknown result",
   });
  } catch {
   setTestResult({ id, success: false, message: "Interface test failed" });
  } finally {
   setTestingId(null);
  }
 };

 return (
  <div className="space-y-4">
   {interfaces.map((iface) => {
    const config = parseConfig(iface.config);
    const hasToken = !!config.bot_token;
    const requiresToken =
     iface.type === "telegram" || iface.type === "discord" || iface.type === "slack";
    const hasClientId = iface.type !== "discord" || Boolean(config.client_id);
    const isHealthyConfig =
     (!requiresToken || hasToken) && hasClientId;
    const isTestingThis = testingId === iface.id;
    const testResultForThis = testResult?.id === iface.id ? testResult : null;

    return (
     <div
      key={iface.id}
      className={cn(
       "group relative overflow-hidden rounded-xl border bg-card p-6 shadow-sm transition-colors duration-200",
       iface.is_active ? "border-border hover:border-primary/50 hover:shadow-md" : "border-border/50 bg-muted/10 opacity-75 grayscale-[0.5]"
      )}
     >
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
       <div className="flex items-start gap-5 min-w-0 flex-1">
        <div
         className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors shadow-sm",
          iface.is_active
           ? iface.type === "telegram"
            ? "bg-sky-500/10 text-sky-500 ring-1 ring-sky-500/20"
            : iface.type === "discord"
            ? "bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20"
            : "bg-primary/10 text-primary ring-1 ring-primary/20"
           : "bg-muted text-muted-foreground ring-1 ring-border"
         )}
        >
         {interfaceIcons[iface.type] || (
          <MessageSquare className="w-5 h-5" />
         )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
         <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className="text-base font-semibold tracking-tight text-foreground">{iface.name}</h3>
          <span className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground border border-border/50 rounded-full font-medium uppercase tracking-wider">
           {iface.type}
          </span>
          {iface.is_active ? (
           <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-500 rounded-full font-semibold uppercase tracking-wider">
            Active
           </span>
          ) : (
           <span className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-full font-medium uppercase tracking-wider">
            Disabled
           </span>
          )}
         </div>
         <p className="text-sm text-muted-foreground flex items-baseline gap-1.5">
          {requiresToken ? (
           <>Token <span className="text-foreground font-mono text-xs font-medium bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">{hasToken ? "••••••••" : "Not configured"}</span></>
          ) : (
           <>Config <span className="text-foreground font-mono text-xs font-medium bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">{Object.keys(config).length > 0 ? "configured" : "empty"}</span></>
          )}
         </p>
         {iface.type === "discord" && (
          <p className="text-xs text-muted-foreground">
           Client ID: {hasClientId ? <span className="text-foreground font-medium">configured</span> : <span className="text-amber-500">missing</span>}
          </p>
         )}
         {!isHealthyConfig && (
          <p className="text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded inline-block mt-1">
           Setup incomplete. Add all required platform fields.
          </p>
         )}
        </div>
       </div>

       <div className="flex flex-wrap md:flex-col items-center md:items-end gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
         <Button
          variant="outline"
          size="sm"
          onClick={() => handleTest(iface.id)}
          disabled={isTestingThis}
          className="h-8 px-3 text-xs font-medium shadow-sm"
         >
          {isTestingThis ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />}
          {isTestingThis ? "Testing" : "Test"}
         </Button>
         <Button
          variant="outline"
          size="sm"
          asChild
          className="h-8 px-3 text-xs font-medium shadow-sm"
         >
          <a href={`/admin/interfaces/${iface.id}/edit`}>
           <Pencil className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
           Edit
          </a>
         </Button>
        </div>
        
        <div className="flex items-center gap-1.5">
         <Button
          variant="ghost"
          size="sm"
          onClick={() => handleToggleActive(iface.id, !!iface.is_active)}
          className={cn(
           "h-8 px-3 text-xs font-medium",
           iface.is_active
            ? "hover:bg-amber-500/10 hover:text-amber-500"
            : "hover:bg-emerald-500/10 hover:text-emerald-500"
          )}
         >
          <Power className="h-3.5 w-3.5 mr-1.5" />
          {iface.is_active ? "Disable" : "Enable"}
         </Button>
         <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDelete(iface.id)}
          disabled={deletingId === iface.id}
          className="h-8 px-3 text-xs font-medium hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
         >
          {deletingId === iface.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
          Delete
         </Button>
        </div>
       </div>
      </div>

      {testResultForThis && (
       <div
        className={cn(
         "mt-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300",
         testResultForThis.success ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"
        )}
       >
        <div className={cn("w-2 h-2 rounded-full", testResultForThis.success ? "bg-emerald-500" : "bg-destructive")} />
        <span className="font-medium">{testResultForThis.success ? "Connection successful:" : "Connection failed:"}</span>
        <span className="opacity-90 font-mono text-xs">{testResultForThis.message}</span>
       </div>
      )}
     </div>
    );
   })}
  </div>
 );
}
