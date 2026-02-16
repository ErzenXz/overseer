import { settingsModel } from "@/database";
import { SettingsForm } from "./SettingsForm";
import { SystemUpdatePanel } from "@/components/SystemUpdatePanel";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, Permission.SYSTEM_SETTINGS_READ)) {
    redirect("/chat");
  }

  const settings = settingsModel.getAll();
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Settings</h1>
        <p className="text-[var(--color-text-secondary)] mt-1">Configure system settings and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SettingsForm settings={settingsMap} />

        <div className="space-y-6">
          {/* System Info */}
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white font-[var(--font-mono)] mb-4">System Information</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Version</span>
                <span className="text-[var(--color-text-primary)]">1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Node.js</span>
                <span className="text-[var(--color-text-primary)]">{process.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Platform</span>
                <span className="text-[var(--color-text-primary)]">{process.platform}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Environment</span>
                <span className="text-[var(--color-text-primary)]">{process.env.NODE_ENV || "development"}</span>
              </div>
            </div>
          </div>

          <SystemUpdatePanel title="Updates" showAutoUpdate />

          {/* Danger Zone */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-400 font-[var(--font-mono)] mb-4">Danger Zone</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">Clear all conversations and messages</p>
                <button className="px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors">
                  Clear All Data
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
