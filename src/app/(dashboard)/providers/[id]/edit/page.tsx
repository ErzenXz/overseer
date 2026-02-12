import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { providersModel } from "@/database";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function updateProviderAction(formData: FormData) {
  "use server";

  const providerId = Number(formData.get("provider_id"));
  const model = String(formData.get("model") ?? "").trim();

  if (!providerId || !model) {
    redirect(`/providers/${providerId}/edit?error=Missing%20required%20fields`);
  }

  const existing = providersModel.findById(providerId);
  if (!existing) {
    redirect("/providers?error=Provider%20not%20found");
  }

  let existingConfig: Record<string, unknown> = {};
  try {
    existingConfig = existing?.config ? (JSON.parse(existing.config) as Record<string, unknown>) : {};
  } catch {
    existingConfig = {};
  }

  const thinkingLevel = String(formData.get("thinking_level") ?? "").trim();
  const nextConfig = {
    ...existingConfig,
    thinking_level:
      thinkingLevel === "low" || thinkingLevel === "medium" || thinkingLevel === "high"
        ? thinkingLevel
        : undefined,
  };

  const maxTokensRaw = String(formData.get("max_tokens") ?? "").trim();
  const maxTokens = maxTokensRaw ? Number.parseInt(maxTokensRaw, 10) : null;
  const temperature = Number.parseFloat(String(formData.get("temperature") ?? "0.7"));
  const priorityRaw = Number.parseInt(
    String(formData.get("priority") ?? existing?.priority ?? 0),
    10,
  );

  providersModel.update(providerId, {
    display_name: String(formData.get("display_name") ?? "").trim() || existing?.display_name,
    api_key: String(formData.get("api_key") ?? "").trim() || undefined,
    base_url: String(formData.get("base_url") ?? "").trim() || undefined,
    model,
    max_tokens: Number.isFinite(maxTokens as number) ? maxTokens : null,
    temperature: Number.isFinite(temperature) ? temperature : existing?.temperature,
    is_active: formData.get("is_active") === "on",
    is_default: formData.get("is_default") === "on",
    priority: Number.isFinite(priorityRaw) ? priorityRaw : existing?.priority,
    config: nextConfig,
  });

  revalidatePath("/providers");
  redirect("/providers?success=Provider%20updated");
}

export default async function EditProviderPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const providerId = Number.parseInt(id, 10);

  if (!Number.isFinite(providerId)) {
    notFound();
  }

  const provider = providersModel.findById(providerId);
  if (!provider) {
    notFound();
  }

  let config: Record<string, unknown> = {};
  try {
    config = provider.config ? (JSON.parse(provider.config) as Record<string, unknown>) : {};
  } catch {
    config = {};
  }

  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Edit Provider</h1>
          <p className="text-text-secondary mt-1">Update provider settings and thinking configuration.</p>
        </div>
        <Link href="/providers" className="px-3 py-2 rounded border border-border text-text-secondary hover:text-white">
          Back
        </Link>
      </div>

      <form action={updateProviderAction} className="space-y-4 bg-surface-raised border border-border rounded-lg p-6">
        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <input type="hidden" name="provider_id" value={provider.id} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm text-white">
            Display name
            <input
              name="display_name"
              defaultValue={provider.display_name}
              className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
              required
            />
          </label>

          <label className="text-sm text-white">
            Model
            <input
              name="model"
              defaultValue={provider.model}
              className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
              required
            />
          </label>
        </div>

        <label className="block text-sm text-white">
          Base URL (optional)
          <input
            name="base_url"
            defaultValue={provider.base_url ?? ""}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
          />
        </label>

        <label className="block text-sm text-white">
          API key (leave blank to keep current)
          <input
            name="api_key"
            type="password"
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="text-sm text-white">
            Max tokens (optional)
            <input
              name="max_tokens"
              type="number"
              defaultValue={provider.max_tokens ?? ""}
              placeholder="model default"
              className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-white">
            Temperature
            <input
              name="temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              defaultValue={provider.temperature}
              className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-white">
            Thinking level
            <select
              name="thinking_level"
              defaultValue={String(config.thinking_level ?? "medium")}
              className="mt-1 w-full rounded border border-border bg-surface-overlay px-3 py-2 text-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        <label className="text-sm text-white inline-flex items-center gap-2 mr-6">
          <input type="checkbox" name="is_active" defaultChecked={Boolean(provider.is_active)} /> Active
        </label>
        <label className="text-sm text-white inline-flex items-center gap-2">
          <input type="checkbox" name="is_default" defaultChecked={Boolean(provider.is_default)} /> Default
        </label>

        <div className="pt-2">
          <button type="submit" className="px-4 py-2 rounded bg-accent text-black hover:bg-accent-light">
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}
