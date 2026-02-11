import { providersModel } from "@/database";
import { OnboardingWizard } from "./OnboardingWizard";

export default function OnboardingPage() {
  const providers = providersModel.findAll();

  if (providers.length > 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-8 text-center">
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">Onboarding already completed</h1>
          <p className="text-[var(--color-text-secondary)] mt-2">You already have providers configured.</p>
          <a
            href="/dashboard"
            className="inline-flex mt-6 px-5 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded-lg transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <OnboardingWizard />;
}
