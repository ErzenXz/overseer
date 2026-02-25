"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@/types/database";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

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

const roleAvatarColors: Record<string, string> = {
 admin: "bg-red-600",
 developer: "bg-amber-600",
 operator: "bg-emerald-600",
 viewer: "bg-blue-600",
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
  <div className="bg-card border border-border rounded-lg">
   {/* Search and Filter */}
   <div className="p-4 border-b border-border flex flex-col md:flex-row gap-4">
    <div className="flex-1">
     <Input
      type="text"
      placeholder="Search users..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="w-full px-4 py-2 bg-muted border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
     />
    </div>
    <div className="flex gap-2">
     {["all", "admin", "developer", "operator", "viewer"].map((role) => (
      <button
       key={role}
       onClick={() => setFilter(role)}
       className={`px-3 py-1.5 text-sm rounded transition-colors ${
        filter === role
         ? "bg-primary/10 text-primary"
         : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
      <tr className="text-left text-sm text-muted-foreground border-b border-border">
       <th className="px-6 py-4 font-medium">User</th>
       <th className="px-6 py-4 font-medium">Role</th>
       <th className="px-6 py-4 font-medium">Created</th>
       <th className="px-6 py-4 font-medium">Last Login</th>
       <th className="px-6 py-4 font-medium">Actions</th>
      </tr>
     </thead>
     <tbody className="divide-y divide-border">
      {filteredUsers.map((user) => (
       <tr key={user.id} className="hover:bg-muted transition-colors">
        <td className="px-6 py-4">
         <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${roleAvatarColors[user.role] || "bg-primary"}`}>
           <span className="text-sm font-bold text-foreground">
            {user.username.charAt(0).toUpperCase()}
           </span>
          </div>
          <div>
           <p className="font-medium text-foreground">{user.username}</p>
           <p className="text-xs text-muted-foreground">ID: {user.id}</p>
          </div>
         </div>
        </td>
        <td className="px-6 py-4">
         <NativeSelect
          value={user.role}
          onChange={(e) => handleRoleChange(user.id, e.target.value)}
          className={`text-xs px-3 py-1.5 rounded border ${roleColors[user.role]} ${roleBorderColors[user.role]} bg-transparent cursor-pointer focus:outline-none`}
         >
           <option value="admin" className="bg-background">Admin</option>
           <option value="developer" className="bg-background">Developer</option>
           <option value="operator" className="bg-background">Operator</option>
           <option value="viewer" className="bg-background">Viewer</option>
         </NativeSelect>
        </td>
        <td className="px-6 py-4 text-sm text-muted-foreground">
         {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td className="px-6 py-4 text-sm text-muted-foreground">
         {user.last_login_at 
          ? new Date(user.last_login_at).toLocaleString()
          : "Never"
         }
        </td>
        <td className="px-6 py-4">
         <div className="flex gap-2">
          <a
           href={`/users/${user.id}/edit`}
           className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground bg-muted hover:bg-border rounded transition-colors"
          >
           Edit
          </a>
          <button
           onClick={() => handleDelete(user.id, user.username)}
           disabled={deletingId === user.id}
           className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded transition-colors disabled:opacity-50"
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
    <div className="p-8 text-center text-muted-foreground">
     No users match the current filter
    </div>
   )}
  </div>
 );
}
