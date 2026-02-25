import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FilesClient } from "./FilesClient";
import { FolderOpenIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
 const user = await getCurrentUser();
 if (!user) redirect("/login");

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
   {/* Header */}
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Files</h1>
      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 uppercase tracking-wider">
       System
      </span>
     </div>
     <p className="text-sm text-muted-foreground flex items-center gap-1.5">
      <FolderOpenIcon className="w-4 h-4" />
      Your private sandbox filesystem and persistent storage
     </p>
    </div>
   </div>

   <FilesClient />
  </div>
 );
}
