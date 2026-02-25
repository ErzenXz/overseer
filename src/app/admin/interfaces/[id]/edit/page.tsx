import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { interfacesModel } from "@/database";
import type { InterfaceType } from "@/types/database";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission, requirePermission } from "@/lib/permissions";
import { EditInterfaceForm } from "./EditInterfaceForm";

interface EditInterfacePageProps {
 params: Promise<{ id: string }>;
}

async function updateInterfaceAction(formData: FormData) {
 "use server";

 const user = await getCurrentUser();
 if (!user) {
  redirect("/login");
 }
 requirePermission(user, Permission.INTERFACES_UPDATE, {
  resource: "interfaces",
  metadata: { action: "update" },
 });

 const id = Number.parseInt(String(formData.get("id") ?? "0"), 10);
 const type = String(formData.get("type") ?? "telegram") as InterfaceType;
 const name = String(formData.get("name") ?? "").trim();
 const botToken = String(formData.get("bot_token") ?? "").trim();
 const clientId = String(formData.get("client_id") ?? "").trim();
 const allowedGuilds = String(formData.get("allowed_guilds") ?? "").trim();
 const allowedUsers = String(formData.get("allowed_users") ?? "").trim();
 const slackAppToken = String(formData.get("slack_app_token") ?? "").trim();
 const slackSigningSecret = String(formData.get("slack_signing_secret") ?? "").trim();
 const matrixHomeserver = String(formData.get("matrix_homeserver") ?? "").trim();
 const matrixAccessToken = String(formData.get("matrix_access_token") ?? "").trim();
 const matrixRoomIds = String(formData.get("matrix_room_ids") ?? "").trim();
 const configJson = String(formData.get("config_json") ?? "").trim();
 const isActive = String(formData.get("is_active") ?? "") === "on";

 if (!Number.isFinite(id) || !name) {
  redirect("/admin/interfaces");
 }

 const existingIface = interfacesModel.findById(id);
 if (!existingIface) {
  redirect("/admin/interfaces");
 }
 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
 if (!canViewAll && existingIface.owner_user_id !== user.id) {
  redirect("/admin/interfaces");
 }

 const existingConfig = interfacesModel.getDecryptedConfig(id) || {};
 let extraConfig: Record<string, unknown> = {};
 if (configJson) {
  try {
   extraConfig = JSON.parse(configJson) as Record<string, unknown>;
   if (!extraConfig || typeof extraConfig !== "object" || Array.isArray(extraConfig)) {
    throw new Error("config_json must be an object");
   }
  } catch {
   // If config JSON is invalid, keep existing config and continue (avoid breaking edits).
   extraConfig = {};
  }
 }

 interfacesModel.update(id, {
  type,
  name,
  config: {
   ...existingConfig,
   ...extraConfig,
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
   ...(type === "slack" && slackAppToken ? { app_token: slackAppToken } : {}),
   ...(type === "slack" && slackSigningSecret ? { signing_secret: slackSigningSecret } : {}),
   ...(type === "matrix" && matrixHomeserver ? { homeserver: matrixHomeserver } : {}),
   ...(type === "matrix" && matrixAccessToken ? { access_token: matrixAccessToken } : {}),
   ...(type === "matrix"
    ? {
      room_ids: matrixRoomIds
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
 redirect("/admin/interfaces");
}

export default async function EditInterfacePage({ params }: EditInterfacePageProps) {
 const user = await getCurrentUser();
 if (!user) {
  redirect("/login");
 }
 requirePermission(user, Permission.INTERFACES_VIEW, {
  resource: "interfaces",
  metadata: { action: "view_edit_page" },
 });

 const { id } = await params;
 const interfaceId = Number.parseInt(id, 10);
 if (!Number.isFinite(interfaceId)) notFound();

 const iface = interfacesModel.findById(interfaceId);
 if (!iface) notFound();
 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
 if (!canViewAll && iface.owner_user_id !== user.id) {
  notFound();
 }

 const config = interfacesModel.getDecryptedConfig(interfaceId) || {};
 const configForEditor = { ...(config as Record<string, unknown>) };
 for (const key of [
  "bot_token",
  "webhook_secret",
  "signing_secret",
  "app_token",
  "access_token",
  "refresh_token",
  "client_secret",
 ]) {
  delete configForEditor[key];
 }
 const allowedUsers = interfacesModel.getAllowedUsers(interfaceId).join(", ");
 const allowedGuilds = Array.isArray(config.allowed_guilds)
  ? (config.allowed_guilds as string[]).join(", ")
  : "";
 const matrixRoomIds = Array.isArray(config.room_ids)
  ? (config.room_ids as string[]).join(", ")
  : "";

 return (
  <div>
   <div className="flex items-center justify-between mb-8">
    <div>
     <h1 className="text-xl text-foreground font-mono">Edit Interface</h1>
     <p className="text-muted-foreground mt-1">Update channel credentials and access controls.</p>
    </div>
    <Link
     href="/interfaces"
     className="px-3 py-2 text-sm rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
     Back
    </Link>
   </div>

   <div className="max-w-2xl bg-card border border-border rounded-lg p-6">
    <EditInterfaceForm
     iface={{
      id: iface.id,
      type: iface.type,
      name: iface.name,
      is_active: iface.is_active,
     }}
     allowedUsersCsv={allowedUsers}
     configJson={JSON.stringify(configForEditor, null, 2)}
     discord={{
      clientId: typeof config.client_id === "string" ? config.client_id : "",
      allowedGuildsCsv: allowedGuilds,
     }}
     matrix={{
      homeserver: typeof config.homeserver === "string" ? config.homeserver : "",
      accessToken: typeof config.access_token === "string" ? config.access_token : "",
      roomIdsCsv: matrixRoomIds,
     }}
     slack={{
      appToken: typeof config.app_token === "string" ? config.app_token : "",
      signingSecret: typeof config.signing_secret === "string" ? config.signing_secret : "",
     }}
     action={updateInterfaceAction}
    />
   </div>
  </div>
 );
}
