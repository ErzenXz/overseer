import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { providersModel } from "@/database";
import { ChatContainer } from "@/components/Chat";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const providers = providersModel.findAll();
  if (providers.length === 0) {
    redirect("/admin/onboarding");
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--color-surface)]">
      <ChatContainer />
    </div>
  );
}
