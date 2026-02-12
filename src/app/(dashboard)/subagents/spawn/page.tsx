import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as subAgentManager from "@/agent/subagents/manager";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const allowedTypes = new Set(subAgentManager.getAllSubAgentTypes());

async function spawnSubAgentAction(formData: FormData) {
  "use server";

  const parentSessionId = String(formData.get("parent_session_id") ?? "manual-dashboard").trim();
  const agentType = String(formData.get("agent_type") ?? "code").trim() as ReturnType<
    typeof subAgentManager.getAllSubAgentTypes
  >[number];
  const name = String(formData.get("name") ?? "").trim();
  const task = String(formData.get("assigned_task") ?? "").trim();

  if (!task) {
    redirect("/subagents/spawn?error=Task%20is%20required");
  }

  if (!allowedTypes.has(agentType)) {
    redirect("/subagents/spawn?error=Invalid%20sub-agent%20type");
  }

  subAgentManager.createSubAgent({
    parent_session_id: parentSessionId || "manual-dashboard",
    agent_type: agentType,
    name: name || undefined,
    assigned_task: task,
  });

  revalidatePath("/subagents");
  revalidatePath("/subagents/all");
  redirect("/subagents/spawn?success=Sub-agent%20created%20and%20queued");
}

export default async function SpawnSubAgentPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const success = typeof params.success === "string" ? params.success : null;
  const allTypes = subAgentManager.getAllSubAgentTypes();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Spawn Sub-Agent</h1>
          <p className="text-text-secondary mt-1 text-pretty">
            Manually create a specialized sub-agent task for testing and orchestration workflows.
          </p>
        </div>
        <Link
          href="/subagents"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back to sub-agents
        </Link>
      </div>

      <div className="max-w-3xl bg-surface-raised border border-border rounded-lg p-6">
        <form action={spawnSubAgentAction} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="agent_type" className="block text-sm text-white mb-2">
                Agent type
              </label>
              <select
                id="agent_type"
                name="agent_type"
                className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {allTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="parent_session_id" className="block text-sm text-white mb-2">
                Parent session id
              </label>
              <input
                id="parent_session_id"
                name="parent_session_id"
                defaultValue="manual-dashboard"
                className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          <div>
            <label htmlFor="name" className="block text-sm text-white mb-2">
              Optional display name
            </label>
            <input
              id="name"
              name="name"
              placeholder="Security Audit Agent"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label htmlFor="assigned_task" className="block text-sm text-white mb-2">
              Assigned task
            </label>
            <textarea
              id="assigned_task"
              name="assigned_task"
              required
              rows={5}
              placeholder="Analyze nginx logs and summarize top 5 recurring errors."
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {error ? <p className="text-sm text-red-400 text-pretty">{error}</p> : null}
          {success ? <p className="text-sm text-green-400 text-pretty">{success}</p> : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium transition-colors"
            >
              Spawn sub-agent
            </button>
            <Link href="/subagents/all" className="text-sm text-accent hover:text-accent-light">
              View all sub-agents →
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
