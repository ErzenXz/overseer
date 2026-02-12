import { revalidatePath } from "next/cache";
import { StatsCard } from "@/components/StatsCard";
import { usersModel } from "@/database";
import { getQuotaManager } from "@/lib/quota-manager";
import { getCostTracker } from "@/lib/cost-tracker";
import { getAllowedModels, getUserPolicy, getUserTokenUsage, upsertUserPolicy } from "@/lib/user-policy";

async function updateUserPolicyAction(formData: FormData) {
  "use server";

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

  const userId = String(formData.get("user_id") ?? "").trim();
  const tier = String(formData.get("tier") ?? "free").trim() as "free" | "pro" | "enterprise";
  if (!userId) return;

  getQuotaManager().updateTier(userId, tier);
  revalidatePath("/users");
}

export default function UsersPage() {
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
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">User Management</h1>
          <p className="text-text-secondary mt-1">Multi-user access, quotas, and model usage policy controls.</p>
        </div>
        <div className="flex gap-3">
          <a
            href="/analytics"
            className="px-4 py-2 bg-surface-overlay hover:bg-border text-text-primary border border-border text-sm font-medium rounded transition-colors"
          >
            Analytics
          </a>
          <a
            href="/users/add"
            className="px-4 py-2 bg-accent hover:bg-accent-light text-black text-sm font-medium rounded transition-colors"
          >
            Add User
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatsCard
          title="Total Users"
          value={users.length}
          color="accent"
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>}
        />
        <StatsCard
          title="Admins"
          value={adminCount}
          color="danger"
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
        />
        <StatsCard
          title="Total Monthly Cost"
          value={`$${quotaRows.reduce((acc, row) => acc + row.cost.monthlyCost, 0).toFixed(2)}`}
          color="warning"
          icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v-2m9-4a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
      </div>

      <div className="mb-8 bg-surface-raised border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-overlay border-b border-border text-left text-text-secondary">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Last login</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/60 last:border-b-0">
                <td className="px-4 py-3 text-white">{u.username}</td>
                <td className="px-4 py-3 text-text-secondary">{u.role}</td>
                <td className="px-4 py-3 text-text-secondary">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-text-secondary">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg text-white font-(--font-mono)">Per-user AI Limits & Policies</h2>
        {quotaRows.map(({ user, tier, usage, cost, policy, tokenUsage, allowedModels }) => (
          <div key={user.id} className="bg-surface-raised border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-medium">{user.username}</h3>
                <p className="text-xs text-text-muted">
                  Tier: <span className="text-text-secondary">{tier}</span> · Daily req: {usage.dailyRequests}/{usage.dailyLimit} · Monthly req: {usage.monthlyRequests}/{usage.monthlyLimit}
                </p>
                <p className="text-xs text-text-muted">
                  Tokens (daily/monthly): {tokenUsage.dailyTokens.toLocaleString()} / {tokenUsage.monthlyTokens.toLocaleString()} · Cost (daily/monthly): ${cost.dailyCost.toFixed(4)} / ${cost.monthlyCost.toFixed(4)}
                </p>
              </div>

              <form action={updateTierAction} className="flex items-center gap-2">
                <input type="hidden" name="user_id" value={user.username} />
                <select
                  name="tier"
                  defaultValue={tier}
                  className="rounded border border-border bg-surface-overlay px-2 py-1.5 text-sm text-white"
                >
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-surface-overlay hover:bg-border text-sm text-white"
                >
                  Save Tier
                </button>
              </form>
            </div>

            <form action={updateUserPolicyAction} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="hidden" name="user_id" value={user.username} />

              <input
                name="allowed_models"
                defaultValue={allowedModels}
                placeholder="allowed models (comma-separated)"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />
              <input
                name="max_input_tokens_per_request"
                defaultValue={policy?.max_input_tokens_per_request ?? ""}
                placeholder="max input tokens / request"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />
              <input
                name="max_output_tokens_per_request"
                defaultValue={policy?.max_output_tokens_per_request ?? ""}
                placeholder="max output tokens / request"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />
              <input
                name="daily_token_limit"
                defaultValue={policy?.daily_token_limit ?? ""}
                placeholder="daily token limit"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />
              <input
                name="monthly_token_limit"
                defaultValue={policy?.monthly_token_limit ?? ""}
                placeholder="monthly token limit"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />
              <input
                name="daily_cost_limit"
                defaultValue={policy?.daily_cost_limit ?? ""}
                placeholder="daily cost limit ($)"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />
              <input
                name="monthly_cost_limit"
                defaultValue={policy?.monthly_cost_limit ?? ""}
                placeholder="monthly cost limit ($)"
                className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white"
              />

              <div className="md:col-span-3">
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium"
                >
                  Save Policy
                </button>
              </div>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
