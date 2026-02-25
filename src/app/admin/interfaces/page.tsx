import { interfacesModel } from "@/database";
import { InterfacesList } from "./InterfacesList";
import { AddInterfaceButton } from "./AddInterfaceButton";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function InterfacesPage() {
 const user = await getCurrentUser();
 if (!user) redirect("/login");
 if (!hasPermission(user, Permission.INTERFACES_VIEW)) {
  redirect("/");
 }
 const canViewAll = user ? hasPermission(user, Permission.TENANT_VIEW_ALL) : false;
 const interfaces = user
  ? canViewAll
   ? interfacesModel.findAll()
   : interfacesModel.findAllByOwner(user.id)
  : [];

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">Chat Interfaces</h1>
     <p className="text-sm text-muted-foreground">Configure Telegram, Discord, and other chat connections</p>
    </div>
    <AddInterfaceButton />
   </div>

   {interfaces.length === 0 ? (
    <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
     <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-muted/50 mb-6 ring-1 ring-border">
      <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
     </div>
     <h3 className="text-xl font-semibold tracking-tight text-foreground mb-2">No interfaces configured</h3>
     <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">Add a chat interface to start talking to your AI agent from your favorite messaging apps</p>
     <AddInterfaceButton variant="primary" />
    </div>
   ) : (
    <InterfacesList interfaces={interfaces} />
   )}

   {/* Setup Instructions */}
   <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
      <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
       <span className="w-2 h-2 rounded-full bg-sky-500"></span>
       Telegram Setup
      </h2>
     </div>
     <div className="p-6">
      <ol className="space-y-4 text-sm text-muted-foreground">
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">1</span>
        <span className="pt-0.5">Open Telegram and search for <strong className="text-foreground">@BotFather</strong></span>
       </li>
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">2</span>
        <span className="pt-0.5">Send <code className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-foreground font-mono text-[11px]">/newbot</code> and follow the prompts</span>
       </li>
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">3</span>
        <span className="pt-0.5">Copy the bot token and paste it here</span>
       </li>
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">4</span>
        <span className="pt-0.5 leading-relaxed">Start the worker process (<code className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-foreground font-mono text-[11px]">npm run bot</code>) and use the Test button above to verify</span>
       </li>
      </ol>
     </div>
    </div>

    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
      <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
       <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
       Discord Setup
      </h2>
     </div>
     <div className="p-6">
      <ol className="space-y-4 text-sm text-muted-foreground">
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">1</span>
        <span className="pt-0.5">Create an application in Discord Developer Portal and add a Bot user</span>
       </li>
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">2</span>
        <span className="pt-0.5">Copy Bot Token and Client ID into the interface form</span>
       </li>
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">3</span>
        <span className="pt-0.5 leading-relaxed">Invite the bot to your server with required scopes and permissions</span>
       </li>
       <li className="flex gap-4">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold ring-1 ring-primary/20">4</span>
        <span className="pt-0.5 leading-relaxed">Run <code className="px-1.5 py-0.5 bg-muted/50 border border-border rounded text-foreground font-mono text-[11px]">npm run discord</code> and test connectivity</span>
       </li>
      </ol>
     </div>
    </div>
   </div>
  </div>
 );
}
