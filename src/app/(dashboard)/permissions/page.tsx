"use client";

import { useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { PermissionBadge } from "@/components/admin/PermissionBadge";

// Define permission categories and permissions
const PERMISSION_CATEGORIES = {
  system: {
    name: "System Management",
    permissions: [
      "system.manage_settings",
      "system.view_logs",
      "system.export_data",
      "system.manage_backups",
    ],
  },
  users: {
    name: "User Management",
    permissions: [
      "users.create",
      "users.read",
      "users.update",
      "users.delete",
      "users.manage_roles",
      "users.reset_passwords",
    ],
  },
  content: {
    name: "Content Access",
    permissions: [
      "conversations.read_all",
      "conversations.read_own",
      "conversations.delete",
      "messages.read",
      "messages.create",
    ],
  },
  providers: {
    name: "Provider Configuration",
    permissions: [
      "providers.create",
      "providers.read",
      "providers.update",
      "providers.delete",
      "providers.manage_keys",
    ],
  },
  tools: {
    name: "Tool Management",
    permissions: [
      "tools.execute",
      "tools.configure",
      "tools.view_logs",
      "tools.approve_dangerous",
    ],
  },
};

// Role-based default permissions
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: Object.values(PERMISSION_CATEGORIES).flatMap(cat => cat.permissions),
  user: [
    "conversations.read_own",
    "messages.read",
    "messages.create",
    "tools.execute",
  ],
  viewer: [
    "conversations.read_all",
    "messages.read",
    "system.view_logs",
    "tools.view_logs",
  ],
};

export default function PermissionsPage() {
  const [selectedRole, setSelectedRole] = useState<string>("admin");
  const [searchQuery, setSearchQuery] = useState("");

  const rolePermissions = ROLE_PERMISSIONS[selectedRole] || [];
  
  // Filter permissions based on search
  const filteredCategories = Object.entries(PERMISSION_CATEGORIES).map(([key, category]) => ({
    key,
    ...category,
    permissions: category.permissions.filter(perm =>
      perm.toLowerCase().includes(searchQuery.toLowerCase()) ||
      category.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(cat => cat.permissions.length > 0);

  const totalPermissions = Object.values(PERMISSION_CATEGORIES).reduce(
    (acc, cat) => acc + cat.permissions.length,
    0
  );
  const grantedPermissions = rolePermissions.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Permissions Management</h1>
          <p className="text-zinc-400 mt-1">Manage role-based access control and custom permissions</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Create Custom Role
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Permissions"
          value={totalPermissions}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
          color="indigo"
        />
        <StatsCard
          title="Permission Categories"
          value={Object.keys(PERMISSION_CATEGORIES).length}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
          color="purple"
        />
        <StatsCard
          title="Default Roles"
          value={3}
          subtitle="Admin, User, Viewer"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
          color="green"
        />
        <StatsCard
          title="Granted to Role"
          value={grantedPermissions}
          subtitle={`${selectedRole} permissions`}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          }
          color="blue"
        />
      </div>

      {/* Role Selector and Search */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">Select Role to View Permissions</h2>
            <div className="flex gap-2">
              {["admin", "user", "viewer"].map((role) => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                    selectedRole === role
                      ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent"
                  }`}
                >
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full md:w-64">
            <input
              type="text"
              placeholder="Search permissions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Permission Categories */}
      <div className="space-y-6">
        {filteredCategories.map((category) => (
          <div key={category.key} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                <p className="text-sm text-zinc-400 mt-1">
                  {category.permissions.filter(p => rolePermissions.includes(p)).length} of {category.permissions.length} granted
                </p>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-xs text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors">
                  Grant All
                </button>
                <button className="px-3 py-1.5 text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors">
                  Revoke All
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {category.permissions.map((permission) => (
                <PermissionBadge
                  key={permission}
                  permission={permission}
                  category={category.key}
                  granted={rolePermissions.includes(permission)}
                />
              ))}
            </div>
          </div>
        ))}

        {filteredCategories.length === 0 && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No permissions found</h3>
            <p className="text-zinc-400">Try adjusting your search query</p>
          </div>
        )}
      </div>

      {/* Permission Matrix */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mt-8">
        <h2 className="text-lg font-semibold text-white mb-4">Permission Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-zinc-800">
                <th className="px-4 py-3 font-medium text-zinc-400">Permission</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-center">Admin</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-center">User</th>
                <th className="px-4 py-3 font-medium text-zinc-400 text-center">Viewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {Object.entries(PERMISSION_CATEGORIES).flatMap(([_, category]) =>
                category.permissions.map((permission) => (
                  <tr key={permission} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-3 text-zinc-300">{permission}</td>
                    <td className="px-4 py-3 text-center">
                      {ROLE_PERMISSIONS.admin.includes(permission) ? (
                        <span className="text-green-400">✓</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ROLE_PERMISSIONS.user.includes(permission) ? (
                        <span className="text-green-400">✓</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ROLE_PERMISSIONS.viewer.includes(permission) ? (
                        <span className="text-green-400">✓</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
