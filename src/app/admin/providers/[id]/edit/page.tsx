import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { providersModel } from "@/database";
import { EditProviderForm } from "./EditProviderForm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";

type PageProps = {
 params: Promise<{ id: string }>;
};

export default async function EditProviderPage({ params }: PageProps) {
 const user = await getCurrentUser();
 if (!user) redirect("/login");
 if (!hasPermission(user, Permission.PROVIDERS_VIEW)) {
  redirect("/");
 }

 const { id } = await params;
 const providerId = Number.parseInt(id, 10);

 if (!Number.isFinite(providerId)) {
  notFound();
 }

 const provider = providersModel.findById(providerId);
 if (!provider) {
  notFound();
 }

 return (
  <div className="max-w-3xl">
   <div className="flex items-center justify-between mb-6">
    <div>
     <h1 className="text-xl text-foreground font-mono">Edit Provider</h1>
     <p className="text-muted-foreground mt-1">
      Update provider settings, model selection, and reasoning options.
     </p>
    </div>
    <Link
     href="/providers"
     className="px-3 py-2 rounded border border-border text-muted-foreground hover:text-foreground"
    >
     Back
    </Link>
   </div>

   <EditProviderForm provider={provider} />
  </div>
 );
}
