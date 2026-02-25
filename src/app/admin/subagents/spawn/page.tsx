import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as subAgentManager from "@/agent/subagents/manager";
import { getCurrentUser } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function spawnSubAgentAction(formData: FormData) {
 "use server";

 const user = await getCurrentUser();
 if (!user) {
  redirect("/login");
 }

 const parentSessionId = String(formData.get("parent_session_id") ?? "manual-dashboard").trim();
 const name = String(formData.get("name") ?? "").trim();
 const task = String(formData.get("assigned_task") ?? "").trim();

 if (!task) {
  redirect("/admin/subagents/spawn?error=Task%20is%20required");
 }

 subAgentManager.createSubAgent({
  parent_session_id: parentSessionId || "manual-dashboard",
  agent_type: "subagent",
  owner_user_id: user.id,
  name: name || undefined,
  assigned_task: task,
 });

 revalidatePath("/subagents");
 revalidatePath("/subagents/all");
 redirect("/admin/subagents/spawn?success=Sub-agent%20created%20and%20queued");
}

export default async function SpawnSubAgentPage({
 searchParams,
}: {
 searchParams: SearchParams;
}) {
 const params = await searchParams;
 const error = typeof params.error === "string" ? params.error : null;
 const success = typeof params.success === "string" ? params.success : null;

 return (
  <div>
   <div className="flex items-center justify-between mb-8">
    <div>
     <h1 className="text-xl text-foreground font-mono">Spawn Sub-Agent</h1>
     <p className="text-muted-foreground mt-1 text-pretty">
      Manually create a generic delegated sub-agent task for testing and orchestration workflows.
     </p>
    </div>
    <Link
     href="/subagents"
     className="px-3 py-2 text-sm rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
     Back to sub-agents
    </Link>
   </div>

   <div className="max-w-3xl bg-card border border-border rounded-lg p-6">
    <form action={spawnSubAgentAction} className="space-y-5">
     <div>
      <label htmlFor="parent_session_id" className="block text-sm text-foreground mb-2">
       Parent session id
      </label>
      <Input
       id="parent_session_id"
       name="parent_session_id"
       defaultValue="manual-dashboard"
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>

     <div>
      <label htmlFor="name" className="block text-sm text-foreground mb-2">
       Optional display name
      </label>
      <Input
       id="name"
       name="name"
       placeholder="Security Audit Agent"
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>

     <div>
      <label htmlFor="assigned_task" className="block text-sm text-foreground mb-2">
       Assigned task
      </label>
      <Textarea
       id="assigned_task"
       name="assigned_task"
       required
       rows={5}
       placeholder="Analyze nginx logs and summarize top 5 recurring errors."
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>

     {error ? <p className="text-sm text-red-400 text-pretty">{error}</p> : null}
     {success ? <p className="text-sm text-green-400 text-pretty">{success}</p> : null}

     <div className="flex items-center gap-3">
      <button
       type="submit"
       className="px-4 py-2 rounded bg-primary hover:bg-primary-light text-primary-foreground text-sm font-medium transition-colors"
      >
       Spawn sub-agent
      </button>
      <Link href="/subagents/all" className="text-sm text-accent hover:text-primary">
       View all sub-agents →
      </Link>
     </div>
    </form>
   </div>
  </div>
 );
}
