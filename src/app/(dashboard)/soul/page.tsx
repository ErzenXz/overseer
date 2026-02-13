import {
  loadSoul,
  loadBaseSoul,
  loadUserSoulSupplement,
  isUsingUserSoulSupplement,
} from "@/agent";
import { getCurrentUser } from "@/lib/auth";
import { SoulEditor } from "./SoulEditor";

export default async function SoulPage() {
  const user = await getCurrentUser();
  if (!user) {
    // Dashboard routes are typically protected by middleware; keep a safe fallback.
    return null;
  }

  const baseSoul = loadBaseSoul();
  const supplement = loadUserSoulSupplement(user.id);
  const effectiveSoul = loadSoul(user.id);
  const isCustom = isUsingUserSoulSupplement(user.id);

  // For per-user supplements, "reset" means: remove supplement (empty).
  const defaultSupplement = "";

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">
          Soul Document
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-1">
          Personalize how your assistant behaves. This is per-user (tenant-scoped).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SoulEditor
            initialContent={supplement}
            isCustom={isCustom}
            defaultSoul={defaultSupplement}
          />
        </div>

        <div className="space-y-6">
          {/* Info Card */}
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
            <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">
              How It Works
            </h2>
            <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
              <p>
                The agent uses a base SOUL.md plus an optional per-user supplement.
              </p>
              <p>
                Use this editor to override style, preferences, and personality for your own
                tenant without affecting other users.
              </p>
            </div>
          </div>

          {/* Base Soul Preview */}
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
            <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">
              Base Soul (Read-Only)
            </h2>
            <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap max-h-64 overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-3">
              {baseSoul}
            </pre>
          </div>

          {/* Status */}
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
            <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">
              Status
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-secondary)]">Supplement</span>
                <span className={isCustom ? "text-green-400" : "text-[var(--color-text-primary)]"}>
                  {isCustom ? "Enabled" : "None"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-secondary)]">Effective chars</span>
                <span className="text-[var(--color-text-primary)]">
                  {effectiveSoul.length.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-text-secondary)]">Effective lines</span>
                <span className="text-[var(--color-text-primary)]">
                  {effectiveSoul.split("\n").length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

