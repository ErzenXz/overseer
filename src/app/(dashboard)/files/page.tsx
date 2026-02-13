import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FilesClient } from "./FilesClient";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">
            Files
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-1">
            Your private sandbox filesystem.
          </p>
        </div>
      </div>

      <FilesClient />
    </div>
  );
}
