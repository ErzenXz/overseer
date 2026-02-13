import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as skillsRegistry from "@/agent/skills/registry";
import { getMarketplaceSkills } from "@/agent/skills/marketplace";
import { getCurrentUser } from "@/lib/auth";
import { withToolContext } from "@/lib/tool-context";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function syncBuiltinAction() {
  "use server";

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  withToolContext({ actor: { kind: "web", id: String(user.id) } }, () => {
    skillsRegistry.syncBuiltinSkills();
  });
  revalidatePath("/skills");
  redirect("/skills/import?success=Built-in%20skills%20synced%20successfully");
}

async function importGithubAction(formData: FormData) {
  "use server";

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const url = String(formData.get("github_url") ?? "").trim();
  if (!url) {
    redirect("/skills/import?error=GitHub%20URL%20is%20required");
  }

  const imported = await withToolContext(
    { actor: { kind: "web", id: String(user.id) } },
    () => skillsRegistry.importFromGitHub(url),
  );
  if (!imported) {
    redirect("/skills/import?error=Failed%20to%20import%20skill%20from%20GitHub");
  }

  revalidatePath("/skills");
  redirect("/skills/import?success=Skill%20imported%20successfully");
}

async function importMarketplaceAction(formData: FormData) {
  "use server";

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const url = String(formData.get("github_url") ?? "").trim();
  if (!url) {
    redirect("/skills/import?error=Marketplace%20URL%20is%20required");
  }

  const imported = await withToolContext(
    { actor: { kind: "web", id: String(user.id) } },
    () => skillsRegistry.importFromGitHub(url),
  );
  if (!imported) {
    redirect("/skills/import?error=Failed%20to%20import%20marketplace%20skill");
  }

  revalidatePath("/skills");
  redirect("/skills/import?success=Marketplace%20skill%20imported%20successfully");
}

export default async function ImportSkillPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const success = typeof params.success === "string" ? params.success : null;
  const builtinCount = skillsRegistry.loadBuiltinSkills().length;
  const marketplace = await getMarketplaceSkills();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Import Skills</h1>
          <p className="text-text-secondary mt-1 text-pretty">
            Bring in community skills or refresh built-in skills from the local `skills/` directory.
          </p>
        </div>
        <Link
          href="/skills"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back to skills
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-surface-raised border border-border rounded-lg p-6">
          <h2 className="text-base text-white mb-2">Sync built-in skills</h2>
          <p className="text-sm text-text-secondary text-pretty mb-4">
            Found <span className="text-white tabular-nums">{builtinCount}</span> built-in skills. Sync will upsert them into the database.
          </p>
          <form action={syncBuiltinAction}>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-surface-overlay hover:bg-border text-sm text-white transition-colors"
            >
              Sync built-in skills
            </button>
          </form>
        </div>

        <div className="bg-surface-raised border border-border rounded-lg p-6">
          <h2 className="text-base text-white mb-2">Import from GitHub</h2>
          <p className="text-sm text-text-secondary text-pretty mb-4">
            Paste a repository URL that contains a `skill.json` at its root.
          </p>
          <form action={importGithubAction} className="space-y-4">
            <input
              name="github_url"
              required
              placeholder="https://github.com/owner/repo"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-accent hover:bg-accent-light text-black text-sm font-medium transition-colors"
            >
              Import skill
            </button>
          </form>
        </div>

        <div className="bg-surface-raised border border-border rounded-lg p-6">
          <h2 className="text-base text-white mb-2">Marketplace</h2>
          <p className="text-sm text-text-secondary text-pretty mb-4">
            Curated community skills. Source:{" "}
            <span className="text-white">
              {marketplace.source === "remote"
                ? "remote"
                : marketplace.source === "local"
                  ? "local"
                  : "none"}
            </span>
            {marketplace.url ? (
              <span className="text-text-muted"> ({marketplace.url})</span>
            ) : null}
          </p>

          {marketplace.skills.length === 0 ? (
            <div className="text-sm text-text-secondary space-y-2">
              <p>No marketplace entries available.</p>
              <p className="text-text-muted">
                Add entries to <code>skills-marketplace.json</code> or set{" "}
                <code>SKILLS_MARKETPLACE_URL</code>.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {marketplace.skills.slice(0, 6).map((skill) => (
                <div
                  key={skill.github}
                  className="rounded border border-border bg-surface-overlay p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-white">{skill.name}</div>
                      {skill.description ? (
                        <div className="text-xs text-text-secondary mt-1 text-pretty">
                          {skill.description}
                        </div>
                      ) : null}
                      <div className="text-xs text-text-muted mt-1">
                        {skill.github}
                      </div>
                    </div>
                    <form action={importMarketplaceAction}>
                      <input type="hidden" name="github_url" value={skill.github} />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded bg-surface-overlay hover:bg-border text-xs text-white transition-colors border border-border"
                      >
                        Import
                      </button>
                    </form>
                  </div>
                </div>
              ))}
              {marketplace.skills.length > 6 ? (
                <div className="text-xs text-text-muted">
                  Showing 6 of {marketplace.skills.length}. Use{" "}
                  <code>SKILLS_MARKETPLACE_URL</code> to host your full list.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 text-pretty">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mt-6 rounded border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300 text-pretty">
          {success}
        </div>
      ) : null}
    </div>
  );
}
