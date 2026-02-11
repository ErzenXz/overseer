import { providersModel } from "@/database";
import { OnboardingWizard } from "./OnboardingWizard";

export default function OnboardingPage() {
  const providers = providersModel.findAll();

  if (providers.length > 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 text-center">
          <h1 className="text-2xl font-semibold text-white">Onboarding already completed</h1>
          <p className="text-zinc-400 mt-2">You already have providers configured.</p>
          <a
            href="/dashboard"
            className="inline-flex mt-6 px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return <OnboardingWizard />;
}
