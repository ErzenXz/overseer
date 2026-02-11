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
        <Link href="/conversations" className="text-sm text-[var(--color-text-secondary)] hover:text-white mb-4 inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Conversations
        </Link>
        <h1 className="text-xl font-semibold text-white font-[var(--font-mono)] mt-2">
          {conversation.external_username || `User ${conversation.external_user_id}`}
        </h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-[var(--color-text-secondary)]">
          <span className="capitalize">{conversation.interface_type}</span>
          <span>•</span>
          <span>{conversation.message_count} messages</span>
          <span>•</span>
          <span>{conversation.total_tokens.toLocaleString()} tokens</span>
        </div>
      </div>

      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h2 className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">Messages</h2>
        </div>
        <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-[var(--color-text-muted)] text-center py-8">No messages in this conversation</p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    message.role === "user"
                      ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : message.role === "assistant"
                      ? "bg-[var(--color-surface-overlay)] text-[var(--color-text-primary)]"
                      : "bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] text-sm"
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
