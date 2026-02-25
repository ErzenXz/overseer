import { conversationsModel, messagesModel } from "@/database";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { ArrowLeftIcon, MessageSquareIcon, HashIcon, ClockIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({
 params,
}: {
 params: Promise<{ id: string }>;
}) {
 const user = await getCurrentUser();
 if (!user) {
  notFound();
 }

 const { id } = await params;
 const conversation = conversationsModel.findById(parseInt(id));

 if (!conversation) {
  notFound();
 }

 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
 if (!canViewAll && (conversation as any).owner_user_id !== user.id) {
  notFound();
 }

 const messages = messagesModel.findByConversation(conversation.id, 100);

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
   <div className="flex flex-col gap-4">
    <Link 
     href="/admin/conversations" 
     className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-fit group"
    >
     <div className="w-6 h-6 rounded-md bg-muted/50 border border-border/50 flex items-center justify-center group-hover:bg-background group-hover:border-border transition-colors">
      <ArrowLeftIcon className="w-3.5 h-3.5" />
     </div>
     Back to Conversations
    </Link>
    
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
     <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
       {conversation.external_username || `User ${conversation.external_user_id}`}
      </h1>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
       <span className="inline-flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md border border-border/50 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span className="capitalize">{conversation.interface_type}</span>
       </span>
       <span className="flex items-center gap-1.5">
        <MessageSquareIcon className="w-3.5 h-3.5" />
        {conversation.message_count} messages
       </span>
       <span className="flex items-center gap-1.5">
        <HashIcon className="w-3.5 h-3.5" />
        {conversation.total_tokens.toLocaleString()} tokens
       </span>
      </div>
     </div>
    </div>
   </div>

   <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[calc(100vh-16rem)]">
    <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between shrink-0">
     <h2 className="text-sm font-semibold tracking-tight text-foreground">Message History</h2>
     <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded uppercase tracking-wider border border-border/50">
      {messages.length} messages loaded
     </span>
    </div>
    
    <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-6 bg-muted/5">
     {messages.length === 0 ? (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
       <MessageSquareIcon className="w-8 h-8 opacity-20" />
       <p className="text-sm font-medium">No messages in this conversation</p>
      </div>
     ) : (
      messages.map((message) => {
       const isUser = message.role === "user";
       const isAssistant = message.role === "assistant";
       
       return (
        <div
         key={message.id}
         className={cn(
          "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300",
          isUser ? "justify-end" : "justify-start"
         )}
        >
         <div
          className={cn(
           "max-w-[85%] rounded-2xl px-5 py-3.5 shadow-sm border",
           isUser
            ? "bg-primary text-primary-foreground border-primary rounded-tr-sm"
            : isAssistant 
            ? "bg-background text-foreground border-border rounded-tl-sm"
            : "bg-muted text-muted-foreground border-border/50 rounded-tl-sm"
          )}
         >
          <div className="flex items-center gap-2 mb-2">
           <span className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            isUser ? "text-primary-foreground/80" : "text-muted-foreground"
           )}>
            {message.role}
           </span>
           <span className={cn(
            "w-1 h-1 rounded-full",
            isUser ? "bg-primary-foreground/30" : "bg-border"
           )} />
           <span className={cn(
            "text-[10px] font-medium flex items-center gap-1",
            isUser ? "text-primary-foreground/60" : "text-muted-foreground"
           )}>
            <ClockIcon className="w-3 h-3" />
            {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
           </span>
          </div>
          
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
           {message.content.split('\n').map((line, i) => (
            <span key={i}>
             {line}
             {i !== message.content.split('\n').length - 1 && <br />}
            </span>
           ))}
          </div>
          
          {message.tool_calls && (
           <div className={cn(
            "mt-3 pt-3 border-t flex items-center gap-2",
            isUser ? "border-primary-foreground/20" : "border-border/50"
           )}>
            <span className={cn(
             "text-[10px] font-mono px-1.5 py-0.5 rounded",
             isUser ? "bg-primary-foreground/10 text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
             {JSON.parse(message.tool_calls).length} tool calls
            </span>
           </div>
          )}
         </div>
        </div>
       );
      })
     )}
    </div>
   </div>
  </div>
 );
}
