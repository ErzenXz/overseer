"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Star, Power, FlaskConical, Pencil } from "lucide-react";
import type { Provider } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";
import {
 CapabilityBadges,
 CostTierBadge,
 PricingDisplay,
 formatTokenCount,
} from "@/components/ModelBadges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

interface ProviderRuntimeConfig {
 providerId?: string;
 models_dev_provider_id?: string;
 thinking_level?: "low" | "medium" | "high";
}

interface ProvidersListProps {
 providers: Provider[];
}

function ProviderCardSkeleton() {
 return (
  <div className="rounded-xl border border-border bg-card shadow-sm p-5">
   <div className="flex items-start gap-4">
    <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
    <div className="flex-1 space-y-2">
     <Skeleton className="h-5 w-40" />
     <Skeleton className="h-4 w-64" />
     <div className="flex gap-2 mt-2">
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-5 w-14 rounded-full" />
     </div>
     <Skeleton className="h-3 w-80 mt-2" />
    </div>
   </div>
  </div>
 );
}

export { ProviderCardSkeleton };

export function ProvidersList({ providers }: ProvidersListProps) {
 const router = useRouter();
 const utils = trpc.useUtils();
 const [testingId, setTestingId] = useState<number | null>(null);
 const [testResult, setTestResult] = useState<{ id: number; success: boolean; message: string } | null>(null);

 const { data: catalog = [] } = trpc.providers.catalog.useQuery(undefined, {
  staleTime: 5 * 60_000,
 });

 const catalogMap = useMemo(() => {
  const map: Record<string, any> = {};
  for (const item of catalog) {
   map[item.id] = item;
  }
  return map;
 }, [catalog]);

 const deleteMutation = trpc.providers.delete.useMutation({
  onMutate: async ({ id }) => {
   await utils.providers.list.cancel();
   const prev = utils.providers.list.getData();
   utils.providers.list.setData(undefined, (old) =>
    (old ?? []).filter((p) => p.id !== id)
   );
   return { prev };
  },
  onSuccess: (_data, { id }) => {
   toast.success("Provider deleted");
   router.refresh();
  },
  onError: (err, _vars, ctx) => {
   if (ctx?.prev) utils.providers.list.setData(undefined, ctx.prev);
   toast.error("Failed to delete provider", { description: err.message });
  },
 });

 const setDefaultMutation = trpc.providers.setDefault.useMutation({
  onSuccess: () => {
   toast.success("Default provider updated");
   utils.providers.list.invalidate();
   router.refresh();
  },
  onError: (err) => {
   toast.error("Failed to set default", { description: err.message });
  },
 });

 const toggleActiveMutation = trpc.providers.update.useMutation({
  onSuccess: (_data, vars) => {
   toast.success(vars.is_active ? "Provider enabled" : "Provider disabled");
   utils.providers.list.invalidate();
   router.refresh();
  },
  onError: (err) => {
   toast.error("Failed to toggle provider", { description: err.message });
  },
 });

 const handleDelete = (id: number) => {
  if (!confirm("Are you sure you want to delete this provider?")) return;
  deleteMutation.mutate({ id });
 };

 const handleTest = async (id: number) => {
  setTestingId(id);
  setTestResult(null);

  try {
   const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
   const data = await res.json();

   const result = {
    id,
    success: data.success,
    message: data.success ? `Connected (${data.latencyMs}ms)` : data.error || "Failed",
   };
   setTestResult(result);

   if (data.success) {
    toast.success("Connection test passed", { description: `${data.latencyMs}ms` });
   } else {
    toast.error("Connection test failed", { description: data.error || "Unknown error" });
   }
  } catch {
   setTestResult({ id, success: false, message: "Test failed" });
   toast.error("Connection test failed");
  } finally {
   setTestingId(null);
  }
 };

 const parseConfig = (raw: string | null): ProviderRuntimeConfig => {
  if (!raw) return {};
  try {
   return JSON.parse(raw) as ProviderRuntimeConfig;
  } catch {
   return {};
  }
 };

 function getModelInfo(providerName: string, modelId: string) {
  const providerInfo = catalogMap[providerName];
  if (!providerInfo) return null;
  return providerInfo.models.find((m: ModelInfo) => m.id === modelId) || null;
 }

 return (
  <div className="space-y-4">
   {providers.map((provider, index) => {
    const runtimeConfig = parseConfig(provider.config);
    const providerLookupId =
     runtimeConfig.models_dev_provider_id || runtimeConfig.providerId || provider.name;
    const modelInfo = getModelInfo(providerLookupId, provider.model);
    const isTestingThis = testingId === provider.id;
    const isDeletingThis = deleteMutation.isPending && deleteMutation.variables?.id === provider.id;

    return (
     <div
      key={provider.id}
      className={cn(
       "group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-colors duration-200",
       provider.is_active ? "border-border hover:border-primary/50 hover:shadow-md" : "border-border/50 bg-muted/10 opacity-75 grayscale-[0.5]"
      )}
     >
      {isDeletingThis && (
       <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
       </div>
      )}
      
      {/* Main row */}
      <div className="p-6">
       <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="flex items-start gap-5 min-w-0 flex-1">
         {/* Avatar */}
         <div
          className={cn(
           "w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-colors shadow-sm",
           provider.is_active
            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
            : "bg-muted text-muted-foreground ring-1 ring-border"
          )}
         >
          <span className="text-xl font-bold tracking-tight">
           {provider.display_name.charAt(0)}
          </span>
         </div>

         <div className="min-w-0 flex-1 space-y-2">
          {/* Name + badges */}
          <div className="flex items-center gap-2.5 flex-wrap">
           <h3 className="text-base font-semibold tracking-tight text-foreground">{provider.display_name}</h3>
           {provider.is_default && (
            <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full font-semibold uppercase tracking-wider">
             Default
            </span>
           )}
           {!provider.is_active && (
            <span className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded-full font-medium uppercase tracking-wider">
             Disabled
            </span>
           )}
           {modelInfo && <CostTierBadge tier={modelInfo.costTier} />}
          </div>

          {/* Model ID */}
          <p className="text-sm text-muted-foreground flex items-baseline gap-1.5">
           Model: <span className="text-foreground font-mono text-xs font-medium bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">{provider.model}</span>
           {modelInfo && modelInfo.name !== provider.model && (
            <span className="text-[11px] text-muted-foreground/80">({modelInfo.name})</span>
           )}
          </p>

          {/* Capabilities row */}
          {modelInfo && (
           <div className="pt-1">
            <CapabilityBadges model={modelInfo} />
           </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 pt-1.5 text-xs text-muted-foreground flex-wrap">
           {modelInfo ? (
            <>
             <span className="flex items-center gap-1.5">
              Context <span className="font-medium text-foreground">{formatTokenCount(modelInfo.contextWindow)}</span>
             </span>
             <span className="w-1 h-1 rounded-full bg-border" />
             <span className="flex items-center gap-1.5">
              Max Out <span className="font-medium text-foreground">{formatTokenCount(modelInfo.maxOutput)}</span>
             </span>
             {(modelInfo.supportsThinking || modelInfo.reasoning) && runtimeConfig.thinking_level && (
              <>
               <span className="w-1 h-1 rounded-full bg-border" />
               <span className="flex items-center gap-1.5">
                Think <span className="font-medium text-primary uppercase">{runtimeConfig.thinking_level}</span>
               </span>
              </>
             )}
             {modelInfo.knowledgeCutoff && (
              <>
               <span className="w-1 h-1 rounded-full bg-border" />
               <span className="flex items-center gap-1.5">
                Cutoff <span className="font-medium text-foreground">{modelInfo.knowledgeCutoff}</span>
               </span>
              </>
             )}
            </>
           ) : (
            <>
             <span className="flex items-center gap-1.5">
              Max Tokens <span className="font-medium text-foreground">{provider.max_tokens ?? "Auto"}</span>
             </span>
             <span className="w-1 h-1 rounded-full bg-border" />
             <span className="flex items-center gap-1.5">
              Temp <span className="font-medium text-foreground">{provider.temperature}</span>
             </span>
            </>
           )}
           <span className="w-1 h-1 rounded-full bg-border" />
           <span className="flex items-center gap-1.5">
            Priority <span className="font-medium text-foreground">{provider.priority}</span>
           </span>
          </div>
         </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap md:flex-col items-center md:items-end gap-2 shrink-0">
         <div className="flex items-center gap-1.5">
          <Button
           variant="outline"
           size="sm"
           onClick={() => handleTest(provider.id)}
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
           <a href={`/admin/providers/${provider.id}/edit`}>
            <Pencil className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            Edit
           </a>
          </Button>
         </div>
         
         <div className="flex items-center gap-1.5">
          {!provider.is_default && (
           <Button
            variant="ghost"
            size="sm"
            onClick={() => setDefaultMutation.mutate({ id: provider.id })}
            className="h-8 px-3 text-xs font-medium hover:text-primary hover:bg-primary/10"
           >
            <Star className="h-3.5 w-3.5 mr-1.5" />
            Default
           </Button>
          )}
          <Button
           variant="ghost"
           size="sm"
           onClick={() => toggleActiveMutation.mutate({ id: provider.id, is_active: !provider.is_active })}
           className={cn(
            "h-8 px-3 text-xs font-medium",
            provider.is_active
             ? "hover:bg-amber-500/10 hover:text-amber-500"
             : "hover:bg-emerald-500/10 hover:text-emerald-500"
           )}
          >
           <Power className="h-3.5 w-3.5 mr-1.5" />
           {provider.is_active ? "Disable" : "Enable"}
          </Button>
          <Button
           variant="ghost"
           size="sm"
           onClick={() => handleDelete(provider.id)}
           disabled={isDeletingThis}
           className="h-8 px-3 text-xs font-medium hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
          >
           {isDeletingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
           Delete
          </Button>
         </div>
        </div>
       </div>

       {/* Test Result Feedback Inline */}
       {testResult && testResult.id === provider.id && (
        <div className={cn(
         "mt-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300",
         testResult.success ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"
        )}>
         <div className={cn("w-2 h-2 rounded-full", testResult.success ? "bg-emerald-500" : "bg-destructive")} />
         <span className="font-medium">{testResult.success ? "Connection successful:" : "Connection failed:"}</span>
         <span className="opacity-90 font-mono text-xs">{testResult.message}</span>
        </div>
       )}
      </div>

      {/* Pricing footer (if model info available) */}
      {modelInfo && (modelInfo.costPerMillionInput !== undefined || modelInfo.costPerMillionOutput !== undefined) && (
       <div className="border-t border-border/50 px-6 py-3 bg-muted/20 flex items-center justify-between gap-6">
        <PricingDisplay model={modelInfo} compact />
       </div>
      )}
     </div>
    );
   })}
  </div>
 );
}
