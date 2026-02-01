"use client";

import { useState } from "react";
import type { User } from "@/database";

interface UserCardProps {
  user: User;
  onEdit?: (user: User) => void;
  onDelete?: (user: User) => void;
  onResetPassword?: (user: User) => void;
  onToggleStatus?: (user: User) => void;
}

const roleColors: Record<string, string> = {
  admin: "bg-red-500/10 text-red-400 border-red-500/30",
  user: "bg-green-500/10 text-green-400 border-green-500/30",
  viewer: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

const roleIcons: Record<string, React.ReactNode> = {
  admin: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  user: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  viewer: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
};

export function UserCard({ user, onEdit, onDelete, onResetPassword, onToggleStatus }: UserCardProps) {
  const [showMenu, setShowMenu] = useState(false);

  const getAvatarColor = () => {
    if (user.role === "admin") return "bg-gradient-to-br from-red-500 to-orange-600";
    if (user.role === "user") return "bg-gradient-to-br from-green-500 to-emerald-600";
    return "bg-gradient-to-br from-blue-500 to-cyan-600";
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${getAvatarColor()}`}>
            <span className="text-lg font-bold text-white">
              {user.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="font-semibold text-white">{user.username}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${roleColors[user.role]}`}>
                {roleIcons[user.role]}
                {user.role}
              </span>
              <span className="text-xs text-zinc-500">ID: {user.id}</span>
            </div>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            aria-label="User actions"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-10">
              {onEdit && (
                <button
                  onClick={() => {
                    onEdit(user);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit User
                </button>
              )}
              {onResetPassword && (
                <button
                  onClick={() => {
                    onResetPassword(user);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  Reset Password
                </button>
              )}
              {onToggleStatus && (
                <button
                  onClick={() => {
                    onToggleStatus(user);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left text-yellow-400 hover:text-yellow-300 hover:bg-zinc-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Disable Account
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => {
                    onDelete(user);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-sm text-left text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 border-t border-zinc-800"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete User
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
        <div>
          <p className="text-xs text-zinc-500">Created</p>
          <p className="text-sm text-zinc-300 mt-1">
            {new Date(user.created_at).toLocaleDateString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Last Login</p>
          <p className="text-sm text-zinc-300 mt-1">
            {user.last_login_at 
              ? new Date(user.last_login_at).toLocaleString()
              : "Never"
            }
          </p>
        </div>
      </div>
    </div>
  );
}
