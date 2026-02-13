import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="text-sm text-[var(--color-text-secondary)]">
        Unauthorized
      </div>
    );
  }

  const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">
          Tasks
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-1">
          Work queue and orchestration runs
          {canViewAll ? " (admin view)" : ""}
        </p>
      </div>

      <TasksClient />
    </div>
  );
}
