import { conversationsModel } from "@/database";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import Link from "next/link";
import { MessageSquareIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
 const user = await getCurrentUser();
 if (!user) {
  return (
   <div className="flex h-[50vh] items-center justify-center">
    <div className="text-sm font-medium text-muted-foreground bg-muted/50 px-4 py-2 rounded-full border border-border/50">
     Unauthorized
    </div>
   </div>
  );
 }

 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
 const conversations = conversationsModel.findAll(
  100,
  0,
  canViewAll ? undefined : user.id,
 );

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">
      Conversations
     </h1>
     <p className="text-sm text-muted-foreground">
      View all conversations with your AI agent
     </p>
    </div>
    <div className="flex items-center gap-3">
     <div className="relative">
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input 
       type="text" 
       placeholder="Search conversations..." 
       className="w-full sm:w-64 pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
      />
     </div>
    </div>
   </div>

   {conversations.length === 0 ? (
    <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
     <div className="w-16 h-16 mb-6 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
      <MessageSquareIcon className="w-8 h-8 text-primary" />
     </div>
     <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">
      No conversations yet
     </h3>
     <p className="text-sm text-muted-foreground max-w-sm">
      Conversations will appear here once users start chatting with your bot.
     </p>
    </div>
   ) : (
    <div className="card-hover rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-sm text-left">
       <thead>
        <tr className="border-b border-border/50 bg-muted/20">
         <th className="px-6 py-4 font-semibold text-foreground tracking-tight">
          User
         </th>
         <th className="px-6 py-4 font-semibold text-foreground tracking-tight">
          Interface
         </th>
         <th className="px-6 py-4 font-semibold text-foreground tracking-tight">
          Messages
         </th>
         <th className="px-6 py-4 font-semibold text-foreground tracking-tight">
          Tokens
         </th>
         <th className="px-6 py-4 font-semibold text-foreground tracking-tight">
          Last Active
         </th>
         <th className="px-6 py-4 font-semibold text-foreground tracking-tight text-right">
          Actions
         </th>
        </tr>
       </thead>
       <tbody className="divide-y divide-border/50">
        {conversations.map((conv) => (
         <tr
          key={conv.id}
          className="table-row-hover transition-colors group"
         >
          <td className="px-6 py-4">
           <div className="flex flex-col">
            <span className="font-medium text-foreground">
             {conv.external_username || `User ${conv.external_user_id}`}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground mt-0.5">
             {conv.external_user_id}
            </span>
           </div>
          </td>
          <td className="px-6 py-4">
           <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground uppercase tracking-wider border border-border/50">
            {conv.interface_type}
           </span>
          </td>
          <td className="px-6 py-4">
           <span className="text-foreground font-medium tabular-nums">{conv.message_count}</span>
          </td>
          <td className="px-6 py-4">
           <span className="text-foreground font-medium tabular-nums">{conv.total_tokens.toLocaleString()}</span>
          </td>
          <td className="px-6 py-4">
           <span className="text-muted-foreground text-xs tabular-nums">
            {new Date(conv.updated_at).toLocaleString(undefined, { 
             month: 'short', 
             day: 'numeric', 
             hour: '2-digit', 
             minute: '2-digit' 
            })}
           </span>
          </td>
          <td className="px-6 py-4 text-right">
           <Link
            href={`/admin/conversations/${conv.id}`}
            className="inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-primary hover:text-accent-foreground h-8 px-3 opacity-0 group-hover:opacity-100 border border-transparent group-hover:border-border"
           >
            View Details
           </Link>
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    </div>
   )}
  </div>
 );
}
