import { providersModel } from "@/database";
import { ProvidersList } from "./ProvidersList";
import { AddProviderButton } from "./AddProviderButton";
import { ProviderCatalog } from "./ProviderCatalog";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function ProvidersPage() {
 const user = await getCurrentUser();
 if (!user) redirect("/login");
 if (!hasPermission(user, Permission.PROVIDERS_VIEW)) {
  redirect("/");
 }

 const providers = providersModel.findAll();

 return (
  <div className="space-y-8 animate-in fade-in duration-200">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">LLM Providers</h1>
     <p className="text-sm text-muted-foreground">Manage your AI model providers and API keys</p>
    </div>
    <AddProviderButton />
   </div>

   {providers.length === 0 ? (
    <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[320px]">
     <div className="w-16 h-16 mb-6 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
      <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
     </div>
     <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">No providers configured</h3>
     <p className="text-sm text-muted-foreground mb-6 max-w-sm">Add your first LLM provider to start using the AI agent.</p>
     <AddProviderButton variant="primary" />
    </div>
   ) : (
    <ProvidersList providers={providers} />
   )}

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
    <div className="px-6 py-5 border-b border-border/50 bg-muted/20">
     <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      Model Catalog
     </h2>
    </div>
    <div className="p-6">
     <ProviderCatalog />
    </div>
   </div>
  </div>
 );
}
