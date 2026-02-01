import { conversationsModel, messagesModel } from "@/database";
import Link from "next/link";

export default function ConversationsPage() {
  const conversations = conversationsModel.findAll(100);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Conversations</h1>
        <p className="text-zinc-400 mt-1">View all conversations with your AI agent</p>
      </div>

      {conversations.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No conversations yet</h3>
          <p className="text-zinc-400">Conversations will appear here once users start chatting with your bot</p>
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-4 text-sm font-medium text-zinc-400">User</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-zinc-400">Interface</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-zinc-400">Messages</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-zinc-400">Tokens</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-zinc-400">Last Active</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((conv) => (
                <tr key={conv.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {conv.external_username || `User ${conv.external_user_id}`}
                      </p>
                      <p className="text-xs text-zinc-500">ID: {conv.external_user_id}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs px-2 py-1 bg-zinc-800 text-zinc-400 rounded capitalize">
                      {conv.interface_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-300">{conv.message_count}</td>
                  <td className="px-6 py-4 text-sm text-zinc-300">{conv.total_tokens.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">
                    {new Date(conv.updated_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/conversations/${conv.id}`}
                      className="text-sm text-indigo-400 hover:text-indigo-300"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
