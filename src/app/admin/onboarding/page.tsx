import { providersModel } from "@/database";
import { OnboardingWizard } from "./OnboardingWizard";

export default function OnboardingPage() {
 const providers = providersModel.findAll();

 if (providers.length > 0) {
  return (
   <div className="max-w-3xl mx-auto">
    <div className="bg-card border border-border rounded-lg p-8 text-center">
     <h1 className="text-xl font-semibold text-foreground font-mono">Onboarding already completed</h1>
     <p className="text-muted-foreground mt-2">You already have providers configured.</p>
     <a
      href="/admin/dashboard"
      className="inline-flex mt-6 px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
     >
      Go to Dashboard
     </a>
    </div>
   </div>
  );
 }

 return <OnboardingWizard />;
}
