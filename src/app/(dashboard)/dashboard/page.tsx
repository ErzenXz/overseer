import { conversationsModel, messagesModel, providersModel, interfacesModel, toolExecutionsModel } from "@/database";
import { StatsCard } from "@/components/StatsCard";
import { RecentActivity } from "@/components/RecentActivity";

export default function DashboardPage() {
  // Get stats
  const conversationCount = conversationsModel.count();
  const messageCount = messagesModel.count();
  const totalTokens = messagesModel.getTotalTokens();
  const providerCount = providersModel.findActive().length;
  const interfaceCount = interfacesModel.findActive().length;
  const toolStats = toolExecutionsModel.getStats();
  const totalToolExecutions = toolStats.reduce((acc, s) => acc + s.count, 0);

  // Get recent conversations
  const recentConversations = conversationsModel.findAll(5);

  // Get recent tool executions
  const recentToolExecutions = toolExecutionsModel.findRecent(10);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 mt-1">Overview of your AI agent system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Conversations"
          value={conversationCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
          color="indigo"
        />
        <StatsCard
          title="Messages"
          value={messageCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          }
          color="green"
        />
        <StatsCard
          title="Tokens Used"
          value={totalTokens.toLocaleString()}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          }
          color="purple"
        />
        <StatsCard
          title="Tool Executions"
          value={totalToolExecutions}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            </svg>
          }
          color="orange"
        />
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">System Status</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${providerCount > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-zinc-300">LLM Providers</span>
              </div>
              <span className="text-zinc-400">{providerCount} active</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${interfaceCount > 0 ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-zinc-300">Chat Interfaces</span>
              </div>
              <span className="text-zinc-400">{interfaceCount} active</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-zinc-300">Agent Status</span>
              </div>
              <span className="text-green-400">Operational</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <a
              href="/providers"
              className="flex items-center gap-2 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Provider
            </a>
            <a
              href="/interfaces"
              className="flex items-center gap-2 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Interface
            </a>
            <a
              href="/soul"
              className="flex items-center gap-2 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Soul
            </a>
            <a
              href="/logs"
              className="flex items-center gap-2 px-4 py-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              View Logs
            </a>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Conversations</h2>
          {recentConversations.length > 0 ? (
            <div className="space-y-3">
              {recentConversations.map((conv) => (
                <a
                  key={conv.id}
                  href={`/conversations/${conv.id}`}
                  className="block p-3 bg-zinc-800/30 hover:bg-zinc-800/50 rounded-lg transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-white">
                      {conv.external_username || conv.external_user_id}
                    </span>
                    <span className="text-xs text-zinc-500">{conv.interface_type}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{conv.message_count} messages</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">No conversations yet</p>
          )}
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Tool Executions</h2>
          {recentToolExecutions.length > 0 ? (
            <div className="space-y-3">
              {recentToolExecutions.slice(0, 5).map((exec) => (
                <div
                  key={exec.id}
                  className="p-3 bg-zinc-800/30 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-white">{exec.tool_name}</span>
                    <span className={`text-xs ${exec.success ? 'text-green-400' : 'text-red-400'}`}>
                      {exec.success ? '✓ Success' : '✗ Failed'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">
                      {exec.execution_time_ms ? `${exec.execution_time_ms}ms` : '-'}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(exec.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">No tool executions yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
