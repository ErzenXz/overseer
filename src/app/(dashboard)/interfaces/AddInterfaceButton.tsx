"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AddInterfaceButtonProps {
  variant?: "default" | "primary";
}

export function AddInterfaceButton({ variant = "default" }: AddInterfaceButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    type: "telegram" as "telegram" | "discord",
    name: "My Telegram Bot",
    bot_token: "",
    allowed_users: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/interfaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          name: formData.name,
          config: {
            bot_token: formData.bot_token,
          },
          allowed_users: formData.allowed_users
            ? formData.allowed_users.split(",").map((s) => s.trim())
            : [],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to add interface");
        return;
      }

      setIsOpen(false);
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const buttonClass =
    variant === "primary"
      ? "px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded transition-all"
      : "flex items-center gap-2 px-4 py-2 bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent-dim)] rounded-lg transition-colors";

  return (
    <>
      <button onClick={() => setIsOpen(true)} className={buttonClass}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Interface
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
              <h2 className="text-xl font-semibold text-white font-[var(--font-mono)]">Add Chat Interface</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-[var(--color-text-secondary)] hover:text-white rounded-lg hover:bg-[var(--color-surface-overlay)] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Platform</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value as "telegram" | "discord" }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="telegram">Telegram</option>
                  <option value="discord" disabled>Discord (Coming Soon)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="My Bot"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Bot Token</label>
                <input
                  type="password"
                  value={formData.bot_token}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bot_token: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  required
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">Get this from @BotFather on Telegram</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                  Allowed Users (Optional)
                </label>
                <input
                  type="text"
                  value={formData.allowed_users}
                  onChange={(e) => setFormData((prev) => ({ ...prev, allowed_users: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  placeholder="123456789, 987654321"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Comma-separated Telegram user IDs. Leave empty to allow all.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-[var(--color-text-secondary)] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded transition-colors disabled:opacity-50"
                >
                  {loading ? "Adding..." : "Add Interface"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
