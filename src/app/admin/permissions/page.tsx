"use client";

import { useState } from "react";
import { StatsCard } from "@/components/StatsCard";
import { PermissionBadge } from "@/components/admin/PermissionBadge";
import { ShieldCheckIcon, UsersIcon, KeyIcon, LockIcon, PlusIcon, SearchIcon, CheckIcon, ShieldIcon, DatabaseIcon, MessageSquareIcon, WrenchIcon, LayersIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Permissions</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 uppercase tracking-wider">
              Access Control
            </span>
          </div>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <ShieldCheckIcon className="w-4 h-4" />
            Manage role-based access control and custom permissions
          </p>
        </div>
        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 w-full sm:w-auto">
          <PlusIcon className="w-4 h-4" />
          Create Custom Role
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatsCard
          title="Total Permissions"
          value={totalPermissions}
          icon={<KeyIcon className="w-5 h-5" />}
          color="accent"
        />
        <StatsCard
          title="Categories"
          value={Object.keys(PERMISSION_CATEGORIES).length}
          icon={<LayersIcon className="w-5 h-5" />}
          color="info"
        />
        <StatsCard
          title="Default Roles"
          value={3}
          subtitle="Admin, User, Viewer"
          icon={<UsersIcon className="w-5 h-5" />}
          color="success"
        />
        <StatsCard
          title="Granted to Role"
          value={grantedPermissions}
          subtitle={`${selectedRole} permissions`}
          icon={<ShieldCheckIcon className="w-5 h-5" />}
          color="warning"
        />
      </div>

      {/* Role Selector and Search */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-5 md:p-6 bg-gradient-to-br from-card to-muted/20">
        <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
          <div className="w-full md:w-auto">
            <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-3 uppercase">
              <UsersIcon className="w-4 h-4 text-primary" />
              Select Role
            </h2>
            <div className="flex gap-2 p-1 rounded-lg bg-muted/50 border border-border/50 inline-flex w-full sm:w-auto overflow-x-auto custom-scrollbar">
              {["admin", "user", "viewer"].map((role) => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={cn(
                    "px-4 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap flex-1 sm:flex-none",
                    selectedRole === role
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/80"
                  )}
                >
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full md:w-72 relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search permissions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-9 pr-4 bg-background border border-input rounded-md text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* Permission Categories */}
      <div className="space-y-6">
        {filteredCategories.map((category) => (
          <div key={category.key} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border/50 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                  {category.key === "system" ? <DatabaseIcon className="w-4 h-4 text-primary" /> :
                   category.key === "users" ? <UsersIcon className="w-4 h-4 text-primary" /> :
                   category.key === "content" ? <MessageSquareIcon className="w-4 h-4 text-primary" /> :
                   category.key === "tools" ? <WrenchIcon className="w-4 h-4 text-primary" /> :
                   <ShieldIcon className="w-4 h-4 text-primary" />}
                  {category.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">{category.permissions.filter(p => rolePermissions.includes(p)).length}</span> of {category.permissions.length} granted
                </p>
              </div>
              <div className="flex gap-2">
                <button className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-success hover:text-success-foreground bg-success/10 hover:bg-success rounded-md transition-colors border border-success/20">
                  <CheckIcon className="w-3.5 h-3.5" />
                  Grant All
                </button>
                <button className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-destructive hover:text-destructive-foreground bg-destructive/10 hover:bg-destructive rounded-md transition-colors border border-destructive/20">
                  <XIcon className="w-3.5 h-3.5" />
                  Revoke All
                </button>
              </div>
            </div>

            <div className="p-5">
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
          </div>
        ))}

        {filteredCategories.length === 0 && (
          <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-16 h-16 mb-6 rounded-2xl bg-muted flex items-center justify-center ring-1 ring-border/50">
              <SearchIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">No permissions found</h3>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search query "{searchQuery}"
            </p>
          </div>
        )}
      </div>

      {/* Permission Matrix */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mt-8">
        <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
          <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 uppercase">
            <LockIcon className="w-4 h-4 text-primary" />
            Permission Matrix
          </h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/10 border-b border-border/50">
              <tr>
                <th className="px-5 py-3 font-semibold text-left">Permission</th>
                <th className="px-5 py-3 font-semibold text-center w-24">Admin</th>
                <th className="px-5 py-3 font-semibold text-center w-24">User</th>
                <th className="px-5 py-3 font-semibold text-center w-24">Viewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 font-mono text-xs">
              {Object.entries(PERMISSION_CATEGORIES).flatMap(([_, category]) =>
                category.permissions.map((permission) => (
                  <tr key={permission} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 text-foreground">{permission}</td>
                    <td className="px-5 py-3 text-center">
                      {ROLE_PERMISSIONS.admin.includes(permission) ? (
                        <div className="flex justify-center"><CheckIcon className="w-4 h-4 text-success" /></div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {ROLE_PERMISSIONS.user.includes(permission) ? (
                        <div className="flex justify-center"><CheckIcon className="w-4 h-4 text-success" /></div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {ROLE_PERMISSIONS.viewer.includes(permission) ? (
                        <div className="flex justify-center"><CheckIcon className="w-4 h-4 text-success" /></div>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
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
