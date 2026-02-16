import { settingsModel } from "@/database/models/system";
import SystemSettingsClient from "./SystemSettingsClient";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function SystemSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, Permission.SYSTEM_SETTINGS_READ)) {
    redirect("/chat");
  }

  const allSettings = settingsModel.getAll();
  return <SystemSettingsClient settings={allSettings} />;
}
