import { StatsCard } from "@/components/StatsCard";
import { UserCard } from "@/components/admin/UserCard";
import { QuotaUsageBar } from "@/components/admin/QuotaUsageBar";
import { usersModel } from "@/database";

export default function UsersPage() {
  const users = usersModel.findAll();
  const adminCount = users.filter(u => u.role === "admin").length;
  const userCount = users.filter(u => u.role === "user").length;
  const viewerCount = users.filter(u => u.role === "viewer").length;

  // Mock quota data - in production, this would come from database
  const quotaData = users.map(user => ({
    user,
    quotas: {
      messages: { used: Math.floor(Math.random() * 1000), limit: 1000 },
      tokens: { used: Math.floor(Math.random() * 100000), limit: 100000 },
      sessions: { used: Math.floor(Math.random() * 50), limit: 50 },
    }
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-zinc-400 mt-1">Manage user accounts, roles, and permissions</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export Users
          </button>
          <a
            href="/users/add"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add User
          </a>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Users"
          value={users.length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
          color="indigo"
        />
        <StatsCard
          title="Admins"
          value={adminCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
          color="red"
        />
        <StatsCard
          title="Users"
          value={userCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          }
          color="green"
        />
        <StatsCard
          title="Viewers"
          value={viewerCount}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          }
          color="blue"
        />
      </div>

      {/* Role Descriptions */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">Role Permissions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-zinc-800/50 rounded-lg border-l-4 border-red-500">
            <h3 className="font-medium text-white mb-2">Admin</h3>
            <ul className="text-xs text-zinc-400 space-y-1">
              <li>✓ Full system access</li>
              <li>✓ Manage users and roles</li>
              <li>✓ Configure providers and interfaces</li>
              <li>✓ Access all conversations</li>
              <li>✓ Modify system settings</li>
            </ul>
          </div>
          <div className="p-4 bg-zinc-800/50 rounded-lg border-l-4 border-green-500">
            <h3 className="font-medium text-white mb-2">User</h3>
            <ul className="text-xs text-zinc-400 space-y-1">
              <li>✓ Use the AI agent</li>
              <li>✓ View own conversations</li>
              <li>✓ Manage own sessions</li>
              <li>✓ View active skills</li>
              <li>✗ Cannot modify system config</li>
            </ul>
          </div>
          <div className="p-4 bg-zinc-800/50 rounded-lg border-l-4 border-blue-500">
            <h3 className="font-medium text-white mb-2">Viewer</h3>
            <ul className="text-xs text-zinc-400 space-y-1">
              <li>✓ Read-only dashboard access</li>
              <li>✓ View logs and stats</li>
              <li>✗ Cannot start conversations</li>
              <li>✗ Cannot modify anything</li>
              <li>✓ Monitoring and auditing</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Users Grid */}
      {users.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No users found</h3>
          <p className="text-zinc-400 mb-6">Create your first user account to get started</p>
          <a
            href="/users/add"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Your First User
          </a>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {quotaData.map(({ user, quotas }) => (
              <div key={user.id} className="space-y-4">
                <UserCard user={user} />
                
                {/* Quota Usage */}
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-sm font-semibold text-white mb-4">Quota Usage</h3>
                  <div className="space-y-4">
                    <QuotaUsageBar
                      used={quotas.messages.used}
                      limit={quotas.messages.limit}
                      label="Messages"
                      color="blue"
                    />
                    <QuotaUsageBar
                      used={quotas.tokens.used}
                      limit={quotas.tokens.limit}
                      label="Tokens"
                      color="purple"
                    />
                    <QuotaUsageBar
                      used={quotas.sessions.used}
                      limit={quotas.sessions.limit}
                      label="Sessions"
                      color="green"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
