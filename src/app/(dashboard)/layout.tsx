import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { getUserPermissions, ROLE_PERMISSIONS } from "@/lib/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  let permissions: string[] = [];
  try {
    permissions = getUserPermissions(user).map((p) => String(p));
  } catch {
    // If the permissions tables are not initialized yet, fall back to the
    // role defaults so the UI still renders.
    permissions = (ROLE_PERMISSIONS[user.role] || []).map((p) => String(p));
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--color-surface)]">
      <Sidebar user={user} permissions={permissions} />
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-6 lg:p-8 max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
