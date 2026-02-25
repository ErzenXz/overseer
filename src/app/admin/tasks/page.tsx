import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
 const user = await getCurrentUser();
 if (!user) {
  return (
   <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    Unauthorized
   </div>
  );
 }

 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col gap-1.5">
    <h1 className="text-2xl font-bold tracking-tight text-foreground">
     Tasks
    </h1>
    <p className="text-sm text-muted-foreground">
     Work queue and orchestration runs
     {canViewAll && <span className="inline-flex items-center ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary uppercase tracking-wider">Admin View</span>}
    </p>
   </div>

   <TasksClient />
  </div>
 );
}
