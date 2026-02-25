import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { usersModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { Permission, requirePermission } from "@/lib/permissions";
import { ArrowLeftIcon, UserPlusIcon, KeyIcon, ShieldIcon, AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const validRoles = new Set(["admin", "developer", "operator", "viewer"]);

async function createUserAction(formData: FormData) {
 "use server";
 const user = await getCurrentUser();
 requirePermission(user, Permission.USERS_CREATE, {
  resource: "users",
  metadata: { action: "create_user" },
 });

 const username = String(formData.get("username") ?? "").trim();
 const password = String(formData.get("password") ?? "");
 const role = String(formData.get("role") ?? "viewer").trim().toLowerCase();

 if (username.length < 3) {
  redirect("/admin/users/add?error=Username%20must%20be%20at%20least%203%20characters");
 }

 if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
  redirect("/admin/users/add?error=Username%20can%20only%20contain%20letters%2C%20numbers%2C%20dot%2C%20underscore%2C%20or%20dash");
 }

 if (password.length < 8) {
  redirect("/admin/users/add?error=Password%20must%20be%20at%20least%208%20characters");
 }

 if (!validRoles.has(role)) {
  redirect("/admin/users/add?error=Invalid%20role%20selected");
 }

 const existing = usersModel.findByUsername(username);
 if (existing) {
  redirect("/admin/users/add?error=Username%20already%20exists");
 }

 await usersModel.create(
  username,
  password,
  role as "admin" | "developer" | "operator" | "viewer"
 );

 revalidatePath("/admin/users");
 redirect("/admin/users/add?success=User%20created%20successfully");
}

export default async function AddUserPage({
 searchParams,
}: {
 searchParams: SearchParams;
}) {
 const user = await getCurrentUser();
 if (!user) redirect("/login");
 requirePermission(user, Permission.USERS_CREATE, {
  resource: "users",
  metadata: { action: "view_add_user" },
 });

 const params = await searchParams;
 const error = params.error as string | undefined;
 const success = params.success as string | undefined;

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
   <div className="flex flex-col gap-4">
    <Link 
     href="/admin/users" 
     className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-fit group"
    >
     <div className="w-6 h-6 rounded-md bg-muted/50 border border-border/50 flex items-center justify-center group-hover:bg-background group-hover:border-border transition-colors">
      <ArrowLeftIcon className="w-3.5 h-3.5" />
     </div>
     Back to Users
    </Link>
    
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">Add User</h1>
     <p className="text-sm text-muted-foreground">
      Create a new dashboard account with role-based access.
     </p>
    </div>
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
     <h2 className="text-sm font-semibold tracking-tight text-foreground">Account Details</h2>
    </div>
    
    <div className="p-5">
     <form action={createUserAction} className="space-y-6">
      <div className="space-y-4">
       <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium text-foreground tracking-tight flex items-center gap-2">
         <UserPlusIcon className="w-4 h-4 text-muted-foreground" />
         Username
        </label>
        <Input
         id="username"
         name="username"
         required
         minLength={3}
         placeholder="e.g. erzen.admin"
         className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
        />
       </div>

       <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground tracking-tight flex items-center gap-2">
         <KeyIcon className="w-4 h-4 text-muted-foreground" />
         Temporary password
        </label>
        <Input
         id="password"
         name="password"
         required
         minLength={8}
         type="password"
         placeholder="At least 8 characters"
         className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
        />
       </div>

       <div className="space-y-1.5">
        <label htmlFor="role" className="text-sm font-medium text-foreground tracking-tight flex items-center gap-2">
         <ShieldIcon className="w-4 h-4 text-muted-foreground" />
         Role
        </label>
        <NativeSelect
         id="role"
         name="role"
         defaultValue="viewer"
         className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors"
        >
         <option value="admin">Admin</option>
         <option value="developer">Developer</option>
         <option value="operator">Operator</option>
         <option value="viewer">Viewer</option>
        </NativeSelect>
       </div>
      </div>

      {error && (
       <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
        <AlertCircleIcon className="w-4 h-4" />
        {error}
       </div>
      )}
      
      {success && (
       <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm rounded-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
        <CheckCircle2Icon className="w-4 h-4" />
        {success}
       </div>
      )}

      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-border/50">
       <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
        User can change password after first sign-in.
       </p>
       <button
        type="submit"
        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-9 px-4 w-full sm:w-auto"
       >
        Create user
       </button>
      </div>
     </form>
    </div>
   </div>
  </div>
 );
}
