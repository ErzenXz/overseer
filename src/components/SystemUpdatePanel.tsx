"use client";

import { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";

export function SystemUpdatePanel({
 title = "Updates",
 showAutoUpdate = true,
}: {
 title?: string;
 showAutoUpdate?: boolean;
}) {
 const utils = trpc.useUtils();
 const [autoUpdateStatus, setAutoUpdateStatus] = useState<
  { created: boolean; jobId?: number; error?: string } | null
 >(null);
 const [forbidden, setForbidden] = useState(false);

 const {
  data: status,
  error: statusError,
  isLoading: statusLoading,
 } = trpc.system.updateStatus.useQuery(undefined, {
  refetchInterval: (query) => {
   const lastRun = query.state.data?.lastRun;
   if (lastRun?.status === "running") return 5000;
   return false;
  },
  retry: (failureCount, error) => {
   // Don't retry on auth errors
   if (error.data?.code === "UNAUTHORIZED") {
    setForbidden(true);
    return false;
   }
   return failureCount < 2;
  },
 });

 const isRunning = status?.lastRun?.status === "running";

 const updateMutation = trpc.system.runUpdate.useMutation({
  onSuccess: () => {
   toast.success("Update started", { description: "Polling for progress..." });
   utils.system.updateStatus.invalidate();
  },
  onError: (err) => {
   toast.error("Update failed", { description: err.message });
  },
 });

 const autoUpdateMutation = trpc.system.enableAutoUpdate.useMutation({
  onSuccess: (data) => {
   setAutoUpdateStatus({ created: true, jobId: data.jobId });
   toast.success("Auto-update enabled", { description: "Weekly updates every Sunday at 3 AM UTC." });
  },
  onError: (err) => {
   setAutoUpdateStatus({ created: false, error: err.message });
   toast.error("Failed to enable auto-update", { description: err.message });
  },
 });

 const errorMsg =
  updateMutation.error?.message ??
  statusError?.message ??
  null;

 return (
  <div className="bg-card border border-border rounded-lg p-6">
   <div className="flex items-start justify-between gap-4 flex-wrap">
    <div className="min-w-0">
     <h2 className="text-lg font-semibold text-foreground font-mono">
      {title}
     </h2>
     <p className="text-sm text-muted-foreground mt-1">
      Update Overseer on this host.
     </p>
     {status?.head && (
      <p className="text-xs text-muted-foreground mt-2">
       Current HEAD:{" "}
       <span className="font-mono text-muted-foreground">
        {status.head.slice(0, 12)}
       </span>
      </p>
     )}
     {forbidden && (
      <p className="text-xs text-amber-300 mt-2">
       You do not have permission to view or run system updates.
      </p>
     )}
    </div>

    <div className="flex items-center gap-3">
     {showAutoUpdate && (
      <Button
       variant="secondary"
       size="sm"
       onClick={() => autoUpdateMutation.mutate()}
       disabled={forbidden || autoUpdateMutation.isPending}
      >
       {autoUpdateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
       Enable Weekly Auto-Update
      </Button>
     )}
     <Button
      onClick={() => updateMutation.mutate()}
      disabled={updateMutation.isPending || isRunning || forbidden}
     >
      {(updateMutation.isPending || isRunning) && (
       <Loader2 className="h-4 w-4 animate-spin" />
      )}
      {isRunning ? "Updating..." : updateMutation.isPending ? "Starting..." : "Update Now"}
     </Button>
    </div>
   </div>

   {errorMsg && (
    <div className="mt-4 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
     <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
     <span>{errorMsg}</span>
    </div>
   )}

   {autoUpdateStatus?.error && (
    <div className="mt-4 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
     <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
     <span>{autoUpdateStatus.error}</span>
    </div>
   )}

   {autoUpdateStatus?.created && (
    <div className="mt-4 flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-300">
     <CheckCircle2 className="h-4 w-4 shrink-0" />
     Weekly auto-update cron job created{autoUpdateStatus.jobId ? ` (Job #${autoUpdateStatus.jobId})` : ""}.
    </div>
   )}

   {isRunning && (
    <div className="mt-4 flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-blue-300">
     <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
     Update in progress... This page will refresh automatically when complete.
    </div>
   )}

   {status?.lastRun && status.lastRun.status !== "running" && (
    <div className="mt-4 p-4 bg-muted rounded-lg border border-border">
     <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-sm text-muted-foreground">
       Last run:{" "}
       <span className="text-foreground">
        {new Date(status.lastRun.startedAt).toLocaleString()}
       </span>{" "}
       <span className="text-muted-foreground">
        (Issue #{status.lastRun.issueId})
       </span>
      </div>
      <div
       className={`text-xs px-2 py-1 rounded border ${
        status.lastRun.ok
         ? "text-green-500 border-green-500/30 bg-green-500/10"
         : "text-red-500 border-red-500/30 bg-red-500/10"
       }`}
      >
       {status.lastRun.ok ? "SUCCESS" : "FAILED"}{" "}
       {status.lastRun.exitCode !== null ? `(exit ${status.lastRun.exitCode})` : ""}
      </div>
     </div>
     <div className="mt-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-64 overflow-auto">
      {status.lastRun.output || "(no output)"}
     </div>
    </div>
   )}
  </div>
 );
}

