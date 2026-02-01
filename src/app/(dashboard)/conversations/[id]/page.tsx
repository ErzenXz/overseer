import { conversationsModel, messagesModel } from "@/database";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conversation = conversationsModel.findById(parseInt(id));

  if (!conversation) {
    notFound();
  }

  const messages = messagesModel.findByConversation(conversation.id, 100);

  return (
    <div>
      <div className="mb-8">
        <Link href="/conversations" className="text-sm text-zinc-400 hover:text-white mb-4 inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Conversations
        </Link>
        <h1 className="text-2xl font-bold text-white mt-2">
          {conversation.external_username || `User ${conversation.external_user_id}`}
        </h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-zinc-400">
          <span className="capitalize">{conversation.interface_type}</span>
          <span>•</span>
          <span>{conversation.message_count} messages</span>
          <span>•</span>
          <span>{conversation.total_tokens.toLocaleString()} tokens</span>
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="font-semibold text-white">Messages</h2>
        </div>
        <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-zinc-500 text-center py-8">No messages in this conversation</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 ${
                    message.role === "user"
                      ? "bg-indigo-500/20 text-indigo-100"
                      : message.role === "assistant"
                      ? "bg-zinc-800 text-zinc-200"
                      : "bg-zinc-800/50 text-zinc-400 text-sm"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium capitalize opacity-70">{message.role}</span>
                    <span className="text-xs opacity-50">
                      {new Date(message.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  {message.tool_calls && (
                    <div className="mt-2 text-xs opacity-70">
                      Tools called: {JSON.parse(message.tool_calls).length}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
