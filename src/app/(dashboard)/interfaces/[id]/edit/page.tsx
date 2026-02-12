import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { interfacesModel } from "@/database";

interface EditInterfacePageProps {
  params: Promise<{ id: string }>;
}

async function updateInterfaceAction(formData: FormData) {
  "use server";

  const id = Number.parseInt(String(formData.get("id") ?? "0"), 10);
  const type = String(formData.get("type") ?? "telegram") as "telegram" | "discord";
  const name = String(formData.get("name") ?? "").trim();
  const botToken = String(formData.get("bot_token") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const allowedGuilds = String(formData.get("allowed_guilds") ?? "").trim();
  const allowedUsers = String(formData.get("allowed_users") ?? "").trim();
  const isActive = String(formData.get("is_active") ?? "") === "on";

  if (!Number.isFinite(id) || !name) {
    redirect("/interfaces");
  }

  const existingConfig = interfacesModel.getDecryptedConfig(id) || {};

  interfacesModel.update(id, {
    type,
    name,
    config: {
      ...existingConfig,
      ...(botToken ? { bot_token: botToken } : {}),
      ...(type === "discord" && clientId ? { client_id: clientId } : {}),
      ...(type === "discord"
        ? {
            allowed_guilds: allowedGuilds
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          }
        : {}),
    },
    is_active: isActive,
    allowed_users: allowedUsers
      ? allowedUsers
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : [],
  });

  revalidatePath("/interfaces");
  redirect("/interfaces");
}

export default async function EditInterfacePage({ params }: EditInterfacePageProps) {
  const { id } = await params;
  const interfaceId = Number.parseInt(id, 10);
  if (!Number.isFinite(interfaceId)) notFound();

  const iface = interfacesModel.findById(interfaceId);
  if (!iface) notFound();

  const config = interfacesModel.getDecryptedConfig(interfaceId) || {};
  const allowedUsers = interfacesModel.getAllowedUsers(interfaceId).join(", ");
  const allowedGuilds = Array.isArray(config.allowed_guilds)
    ? (config.allowed_guilds as string[]).join(", ")
    : "";

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl text-white font-(--font-mono)">Edit Interface</h1>
          <p className="text-text-secondary mt-1">Update channel credentials and access controls.</p>
        </div>
        <Link
          href="/interfaces"
          className="px-3 py-2 text-sm rounded border border-border text-text-secondary hover:text-white hover:bg-surface-overlay transition-colors"
        >
          Back
        </Link>
      </div>

      <div className="max-w-2xl bg-surface-raised border border-border rounded-lg p-6">
        <form action={updateInterfaceAction} className="space-y-4">
          <input type="hidden" name="id" value={iface.id} />

          <div>
            <label className="block text-sm text-white mb-2">Type</label>
            <select
              name="type"
              defaultValue={iface.type}
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="telegram">Telegram</option>
              <option value="discord">Discord</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-white mb-2">Name</label>
            <input
              name="name"
              defaultValue={iface.name}
              required
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm text-white mb-2">Bot Token (leave blank to keep current)</label>
            <input
              type="password"
              name="bot_token"
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm text-white mb-2">Discord Client ID</label>
            <input
              name="client_id"
              defaultValue={typeof config.client_id === "string" ? config.client_id : ""}
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm text-white mb-2">Allowed Guild IDs (Discord)</label>
            <input
              name="allowed_guilds"
              defaultValue={allowedGuilds}
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm text-white mb-2">Allowed User IDs</label>
            <input
              name="allowed_users"
              defaultValue={allowedUsers}
              className="w-full rounded border border-border bg-surface-overlay px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={Boolean(iface.is_active)}
              className="rounded border-border bg-surface-overlay text-accent focus:ring-accent"
            />
            Active
          </label>

          <div className="pt-2">
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
