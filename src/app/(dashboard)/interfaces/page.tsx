import { interfacesModel } from "@/database";
import { InterfacesList } from "./InterfacesList";
import { AddInterfaceButton } from "./AddInterfaceButton";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function InterfacesPage() {
  const user = await getCurrentUser();
  const canViewAll = user ? hasPermission(user, Permission.TENANT_VIEW_ALL) : false;
  const interfaces = user
    ? canViewAll
      ? interfacesModel.findAll()
      : interfacesModel.findAllByOwner(user.id)
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Chat Interfaces</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Configure Telegram, Discord, and other chat connections</p>
        </div>
        <AddInterfaceButton />
      </div>

      {interfaces.length === 0 ? (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface-overlay)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No interfaces configured</h3>
          <p className="text-[var(--color-text-secondary)] mb-6">Add a chat interface to start talking to your AI agent</p>
          <AddInterfaceButton variant="primary" />
        </div>
      ) : (
        <InterfacesList interfaces={interfaces} />
      )}

      {/* Setup Instructions */}
      <div className="mt-8 space-y-6">
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">Telegram Setup</h2>
          <ol className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">1</span>
              <span>Open Telegram and search for <strong className="text-[var(--color-text-primary)]">@BotFather</strong></span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">2</span>
              <span>Send <code className="px-1.5 py-0.5 bg-[var(--color-surface-overlay)] rounded text-[var(--color-text-primary)]">/newbot</code> and follow the prompts</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">3</span>
              <span>Copy the bot token and paste it here</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">4</span>
              <span>Start the worker process (`npm run bot` for Telegram, `npm run discord` for Discord) and use the Test button above to verify credentials</span>
            </li>
          </ol>
        </div>

        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">Discord Setup</h2>
          <ol className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">1</span>
              <span>Create an application in Discord Developer Portal and add a Bot user</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">2</span>
              <span>Copy Bot Token and Client ID into the interface form</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">3</span>
              <span>Invite the bot to your server with required scopes and permissions</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] flex items-center justify-center text-xs">4</span>
              <span>Run `npm run discord` and test connectivity from the Interfaces list</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
