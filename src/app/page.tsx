import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { providersModel } from "@/database";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    const providers = providersModel.findAll();
    if (providers.length === 0) {
      redirect("/onboarding");
    }
    redirect("/dashboard");
  } else {
    redirect("/login");
  }
}
