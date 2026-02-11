import { providersModel } from "@/database";
import { PROVIDER_INFO } from "@/agent";
import { ProvidersList } from "./ProvidersList";
import { AddProviderButton } from "./AddProviderButton";

export default function ProvidersPage() {
  const providers = providersModel.findAll();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">LLM Providers</h1>
          <p className="text-[var(--color-text-secondary)] mt-1">Manage your AI model providers and API keys</p>
        </div>
        <AddProviderButton />
      </div>

      {providers.length === 0 ? (
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface-overlay)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No providers configured</h3>
          <p className="text-[var(--color-text-secondary)] mb-6">Add your first LLM provider to start using the AI agent</p>
          <AddProviderButton variant="primary" />
        </div>
      ) : (
        <ProvidersList providers={providers} />
      )}

      {/* Available Providers Info */}
      <div className="mt-8">
        <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-4">Supported Providers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(PROVIDER_INFO).map(([key, info]) => (
            <div key={key} className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="font-medium text-white mb-2">{info.displayName}</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                {info.requiresKey ? "Requires API key" : "Local installation"}
              </p>
              <div className="flex flex-wrap gap-1">
                {info.models.slice(0, 3).map((model) => (
                  <span
                    key={model.id}
                    className="text-xs px-2 py-0.5 bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] rounded"
                  >
                    {model.name}
                  </span>
                ))}
                {info.models.length > 3 && (
                  <span className="text-xs text-[var(--color-text-muted)]">+{info.models.length - 3} more</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
