import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { providersModel } from "@/database";
import ChatPage from "@/components/ChatPage";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const providers = providersModel.findAll();
  if (providers.length === 0) {
    redirect("/admin/onboarding");
  }

  return <ChatPage />;
}
