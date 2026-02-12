import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { findById, updateSkill } from "@/agent/skills/registry";

interface EditSkillPageProps {
  params: Promise<{ id: string }>;
}

async function updateSkillAction(formData: FormData) {
  "use server";

  const id = Number.parseInt(String(formData.get("id") ?? "0"), 10);
  if (!Number.isFinite(id)) {
    redirect("/skills");
  }

  const existing = findById(id);
  if (!existing) {
    redirect("/skills");
  }

  const systemPrompt = String(formData.get("system_prompt") ?? "").trim();
  const config = String(formData.get("config") ?? "").trim();
  const isActive = String(formData.get("is_active") ?? "") === "on";

  let parsedConfig: string | null = null;
  if (config) {
    try {
      parsedConfig = JSON.stringify(JSON.parse(config));
    } catch {
      parsedConfig = existing.config;
    }
  } else {
    parsedConfig = null;
  }

  updateSkill(id, {
    system_prompt: systemPrompt || null,
    config: parsedConfig,
    is_active: isActive ? 1 : 0,
  });

  revalidatePath("/skills");
  redirect("/skills");
}

export default async function EditSkillPage({ params }: EditSkillPageProps) {
  const { id } = await params;
  const skillId = Number.parseInt(id, 10);

  if (!Number.isFinite(skillId)) {
    notFound();
  }

  const skill = findById(skillId);
  if (!skill) {
    notFound();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Configure Skill</h1>
          <p className="text-text-secondary mt-1">Adjust runtime behavior for `{skill.name}`.</p>
        </div>
        <Link
          href="/skills"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back
        </Link>
      </div>

      <div className="max-w-3xl bg-surface-raised border border-border rounded-lg p-6">
        <form action={updateSkillAction} className="space-y-5">
          <input type="hidden" name="id" value={skill.id} />

          <div>
            <label className="block text-sm text-white mb-2">Skill metadata</label>
            <div className="rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-text-secondary">
              <p><span className="text-text-muted">Skill ID:</span> {skill.skill_id}</p>
              <p><span className="text-text-muted">Source:</span> {skill.source}</p>
              <p><span className="text-text-muted">Version:</span> {skill.version}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm text-white mb-2">System Prompt</label>
            <textarea
              name="system_prompt"
              defaultValue={skill.system_prompt || ""}
              rows={8}
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="Optional system prompt override for this skill"
            />
          </div>

          <div>
            <label className="block text-sm text-white mb-2">Config (JSON)</label>
            <textarea
              name="config"
              defaultValue={skill.config || ""}
              rows={10}
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder='{"key":"value"}'
            />
            <p className="text-xs text-text-muted mt-1">
              Invalid JSON is ignored and previous config is kept.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={Boolean(skill.is_active)}
              className="rounded border-border bg-surface-overlay text-accent focus:ring-accent"
            />
            Active
          </label>

          <div>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium transition-colors"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
