"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@/types/database";

interface UsersListProps {
  users: User[];
}

const roleColors: Record<string, string> = {
  admin: "bg-red-500/10 text-red-400",
  developer: "bg-amber-500/10 text-amber-400",
  operator: "bg-emerald-500/10 text-emerald-400",
  viewer: "bg-blue-500/10 text-blue-400",
};

const roleBorderColors: Record<string, string> = {
  admin: "border-red-500/30",
  developer: "border-amber-500/30",
  operator: "border-emerald-500/30",
  viewer: "border-blue-500/30",
};

export function UsersList({ users }: UsersListProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filteredUsers = users.filter(user => {
    const matchesFilter = filter === "all" || user.role === filter;
    const matchesSearch = search === "" || 
      user.username.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleDelete = async (id: number, username: string) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Failed to delete: ${data.error}`);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleRoleChange = async (id: number, newRole: string) => {
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    router.refresh();
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl">
      {/* Search and Filter */}
      <div className="p-4 border-b border-zinc-800 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex gap-2">
          {["all", "admin", "developer", "operator", "viewer"].map((role) => (
            <button
              key={role}
              onClick={() => setFilter(role)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === role
                  ? "bg-indigo-500/10 text-indigo-400"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
            >
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-zinc-400 border-b border-zinc-800">
              <th className="px-6 py-4 font-medium">User</th>
              <th className="px-6 py-4 font-medium">Role</th>
              <th className="px-6 py-4 font-medium">Created</th>
              <th className="px-6 py-4 font-medium">Last Login</th>
              <th className="px-6 py-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      user.role === "admin" 
                        ? "bg-gradient-to-br from-red-500 to-orange-600"
                        : user.role === "developer"
                        ? "bg-gradient-to-br from-amber-500 to-yellow-600"
                        : user.role === "operator"
                        ? "bg-gradient-to-br from-emerald-500 to-teal-600"
                        : "bg-gradient-to-br from-blue-500 to-cyan-600"
                    }`}>
                      <span className="text-sm font-bold text-white">
                        {user.username.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-white">{user.username}</p>
                      <p className="text-xs text-zinc-500">ID: {user.id}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${roleColors[user.role]} ${roleBorderColors[user.role]} bg-transparent cursor-pointer focus:outline-none`}
                  >
                      <option value="admin" className="bg-zinc-900">Admin</option>
                      <option value="developer" className="bg-zinc-900">Developer</option>
                      <option value="operator" className="bg-zinc-900">Operator</option>
                      <option value="viewer" className="bg-zinc-900">Viewer</option>
                  </select>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-sm text-zinc-400">
                  {user.last_login_at 
                    ? new Date(user.last_login_at).toLocaleString()
                    : "Never"
                  }
                </td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <a
                      href={`/users/${user.id}/edit`}
                      className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                      Edit
                    </a>
                    <button
                      onClick={() => handleDelete(user.id, user.username)}
                      disabled={deletingId === user.id}
                      className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deletingId === user.id ? "..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredUsers.length === 0 && (
        <div className="p-8 text-center text-zinc-500">
          No users match the current filter
        </div>
      )}
    </div>
  );
}
