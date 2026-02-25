import { revalidatePath } from "next/cache";
import { StatsCard } from "@/components/StatsCard";
import { usersModel } from "@/database";
import { getQuotaManager } from "@/lib/quota-manager";
import { getCostTracker } from "@/lib/cost-tracker";
import { getAllowedModels, getUserPolicy, getUserTokenUsage, upsertUserPolicy } from "@/lib/user-policy";
import { getCurrentUser } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

async function updateUserPolicyAction(formData: FormData) {
 "use server";
 const user = await getCurrentUser();
 requirePermission(user, Permission.USERS_MANAGE, {
  resource: "users",
  metadata: { action: "update_user_policy" },
 });

 const userId = String(formData.get("user_id") ?? "").trim();
 if (!userId) return;

 const parseNullableNumber = (key: string) => {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
 };

 const allowedModelsRaw = String(formData.get("allowed_models") ?? "").trim();
 const allowedModels = allowedModelsRaw
  ? allowedModelsRaw.split(",").map((m) => m.trim()).filter(Boolean)
  : [];

 upsertUserPolicy(userId, {
  allowedModels,
  maxInputTokensPerRequest: parseNullableNumber("max_input_tokens_per_request"),
  maxOutputTokensPerRequest: parseNullableNumber("max_output_tokens_per_request"),
  dailyTokenLimit: parseNullableNumber("daily_token_limit"),
  monthlyTokenLimit: parseNullableNumber("monthly_token_limit"),
  dailyCostLimit: parseNullableNumber("daily_cost_limit"),
  monthlyCostLimit: parseNullableNumber("monthly_cost_limit"),
 });

 revalidatePath("/users");
}

async function updateTierAction(formData: FormData) {
 "use server";
 const user = await getCurrentUser();
 requirePermission(user, Permission.USERS_MANAGE, {
  resource: "users",
  metadata: { action: "update_user_tier" },
 });

 const userId = String(formData.get("user_id") ?? "").trim();
 const tier = String(formData.get("tier") ?? "free").trim() as "free" | "pro" | "enterprise";
 if (!userId) return;

 getQuotaManager().updateTier(userId, tier);
 revalidatePath("/users");
}

export default async function UsersPage() {
 const user = await getCurrentUser();
 if (!user) redirect("/login");
 requirePermission(user, Permission.USERS_VIEW, {
  resource: "users",
  metadata: { action: "view_users" },
 });

 const users = usersModel.findAll();
 const quotaManager = getQuotaManager();
 const costTracker = getCostTracker();

 const quotaRows = users.map((user) => {
  const userId = user.username;
  const tier = quotaManager.getUserTier(userId);
  const usage = quotaManager.getUsage(userId);
  const cost = costTracker.getUserCostSummary(userId);
  const policy = getUserPolicy(userId);
  const tokenUsage = getUserTokenUsage(userId);
  const allowedModels = getAllowedModels(userId)?.join(", ") || "";

  return {
   user,
   tier,
   usage,
   cost,
   policy,
   tokenUsage,
   allowedModels,
  };
 });

 const adminCount = users.filter((u) => u.role === "admin").length;

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">User Management</h1>
     <p className="text-sm text-muted-foreground">Multi-user access, quotas, and model usage policy controls.</p>
    </div>
    <div className="flex items-center gap-3">
     <a
      href="/admin/analytics"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-9 px-4"
     >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
      Analytics
     </a>
     <a
      href="/admin/users/add"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-9 px-4"
     >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      Add User
     </a>
    </div>
   </div>

   <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    <StatsCard
     title="Total Users"
     value={users.length}
     color="accent"
     icon={<svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>}
    />
    <StatsCard
     title="Admins"
     value={adminCount}
     color="danger"
     icon={<svg className="w-5 h-5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
    />
    <StatsCard
     title="Total Monthly Cost"
     value={`$${quotaRows.reduce((acc, row) => acc + row.cost.monthlyCost, 0).toFixed(2)}`}
     color="warning"
     icon={<svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v-2m9-4a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
    />
   </div>

   <div className="card-hover rounded-xl border border-border bg-card shadow-sm overflow-hidden">
    <div className="overflow-x-auto custom-scrollbar">
     <table className="w-full text-sm text-left">
      <thead>
       <tr className="border-b border-border/50 bg-muted/20">
        <th className="px-6 py-4 font-semibold text-foreground tracking-tight">Username</th>
        <th className="px-6 py-4 font-semibold text-foreground tracking-tight">Role</th>
        <th className="px-6 py-4 font-semibold text-foreground tracking-tight">Created</th>
        <th className="px-6 py-4 font-semibold text-foreground tracking-tight">Last login</th>
       </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
       {users.map((u) => (
        <tr key={u.id} className="table-row-hover transition-colors group">
         <td className="px-6 py-4 font-medium text-foreground">{u.username}</td>
         <td className="px-6 py-4">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground uppercase tracking-wider border border-border/50">
           {u.role}
          </span>
         </td>
         <td className="px-6 py-4 text-muted-foreground tabular-nums">
          {new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
         </td>
         <td className="px-6 py-4 text-muted-foreground tabular-nums">
          {u.last_login_at ? new Date(u.last_login_at).toLocaleString(undefined, { 
           month: 'short', 
           day: 'numeric', 
           hour: '2-digit', 
           minute: '2-digit' 
          }) : "Never"}
         </td>
        </tr>
       ))}
      </tbody>
     </table>
    </div>
   </div>

   <div className="space-y-6">
    <div className="flex items-center justify-between">
     <h2 className="text-lg font-semibold tracking-tight text-foreground">Per-user AI Limits & Policies</h2>
    </div>
    
    <div className="grid gap-6">
     {quotaRows.map(({ user, tier, usage, cost, policy, tokenUsage, allowedModels }) => (
      <div key={user.id} className="rounded-xl border border-border bg-card shadow-sm p-6 hover:border-primary/50 transition-colors duration-200">
       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-border/50">
        <div className="flex flex-col gap-2">
         <div className="flex items-center gap-3">
          <h3 className="font-semibold text-foreground tracking-tight">{user.username}</h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary uppercase tracking-wider border border-primary/20">
           {tier}
          </span>
         </div>
         <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded border border-border/50">
           <span className="font-medium">Reqs:</span>
           <span className="tabular-nums text-foreground">{usage.dailyRequests}/{usage.dailyLimit}</span>
           <span className="text-[10px] uppercase tracking-wider mx-1 opacity-50">daily</span>
           <span className="tabular-nums text-foreground">{usage.monthlyRequests}/{usage.monthlyLimit}</span>
           <span className="text-[10px] uppercase tracking-wider opacity-50">monthly</span>
          </div>
          <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded border border-border/50">
           <span className="font-medium">Tokens:</span>
           <span className="tabular-nums text-foreground">{tokenUsage.dailyTokens.toLocaleString()}/{tokenUsage.monthlyTokens.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-1 rounded border border-border/50">
           <span className="font-medium">Cost:</span>
           <span className="tabular-nums text-foreground">${cost.dailyCost.toFixed(4)} / ${cost.monthlyCost.toFixed(4)}</span>
          </div>
         </div>
        </div>

        <form action={updateTierAction} className="flex items-center gap-2">
         <Input type="hidden" name="user_id" value={user.username} />
         <NativeSelect
          name="tier"
          defaultValue={tier}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
         >
          <option value="free">free</option>
          <option value="pro">pro</option>
          <option value="enterprise">enterprise</option>
         </NativeSelect>
         <button
          type="submit"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-9 px-4"
         >
          Save Tier
         </button>
        </form>
       </div>

       <form action={updateUserPolicyAction} className="space-y-4">
        <Input type="hidden" name="user_id" value={user.username} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <div className="space-y-1.5 lg:col-span-2">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Allowed Models</label>
          <Input
           name="allowed_models"
           defaultValue={allowedModels}
           placeholder="comma-separated"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
          />
         </div>
         
         <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Max Input Tokens</label>
          <Input
           name="max_input_tokens_per_request"
           defaultValue={policy?.max_input_tokens_per_request ?? ""}
           placeholder="per request"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm tabular-nums"
          />
         </div>
         
         <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Max Output Tokens</label>
          <Input
           name="max_output_tokens_per_request"
           defaultValue={policy?.max_output_tokens_per_request ?? ""}
           placeholder="per request"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm tabular-nums"
          />
         </div>
         
         <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Daily Token Limit</label>
          <Input
           name="daily_token_limit"
           defaultValue={policy?.daily_token_limit ?? ""}
           placeholder="daily tokens"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm tabular-nums"
          />
         </div>
         
         <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Monthly Token Limit</label>
          <Input
           name="monthly_token_limit"
           defaultValue={policy?.monthly_token_limit ?? ""}
           placeholder="monthly tokens"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm tabular-nums"
          />
         </div>
         
         <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Daily Cost Limit ($)</label>
          <Input
           name="daily_cost_limit"
           defaultValue={policy?.daily_cost_limit ?? ""}
           placeholder="daily $"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm tabular-nums"
          />
         </div>
         
         <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Monthly Cost Limit ($)</label>
          <Input
           name="monthly_cost_limit"
           defaultValue={policy?.monthly_cost_limit ?? ""}
           placeholder="monthly $"
           className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm tabular-nums"
          />
         </div>
        </div>

        <div className="flex justify-end pt-2">
         <button
          type="submit"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-9 px-4"
         >
          Save Policy
         </button>
        </div>
       </form>
      </div>
     ))}
    </div>
   </div>
  </div>
 );
}
