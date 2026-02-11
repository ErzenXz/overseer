import { settingsModel } from "@/database/models/system";
import SystemSettingsClient from "./SystemSettingsClient";

export default function SystemSettingsPage() {
  const allSettings = settingsModel.getAll();
  return <SystemSettingsClient settings={allSettings} />;
}
