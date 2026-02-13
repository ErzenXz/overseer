"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InterfaceType } from "@/types/database";

interface AddInterfaceButtonProps {
  variant?: "default" | "primary";
}

export function AddInterfaceButton({ variant = "default" }: AddInterfaceButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const interfaceOptions: Array<{
    value: InterfaceType;
    label: string;
    hint: string;
  }> = [
    { value: "telegram", label: "Telegram", hint: "Bot token from @BotFather (Telegraf)" },
    { value: "discord", label: "Discord", hint: "Bot token + Client ID (discord.js)" },
    { value: "slack", label: "Slack", hint: "Bolt Socket Mode tokens/secrets" },
    { value: "whatsapp", label: "WhatsApp", hint: "Baileys pairing-based login" },
    { value: "matrix", label: "Matrix", hint: "Matrix access token + homeserver" },
    { value: "web", label: "Web (Admin)", hint: "Built-in dashboard chat" },
  ];

  const defaultNames: Record<string, string> = {
    telegram: "My Telegram Bot",
    discord: "My Discord Bot",
    slack: "My Slack Bot",
    whatsapp: "My WhatsApp Bot",
    matrix: "My Matrix Bot",
    web: "Web Dashboard",
  };

  const requiresBotToken = (type: InterfaceType) =>
    type === "telegram" || type === "discord" || type === "slack";

  const [formData, setFormData] = useState({
    type: "telegram" as InterfaceType,
    name: "My Telegram Bot",
    bot_token: "",
    client_id: "",
    allowed_guilds: "",
    allowed_users: "",
    slack_app_token: "",
    slack_signing_secret: "",
    config_json: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let extraConfig: Record<string, unknown> = {};
      if (formData.config_json.trim()) {
        try {
          extraConfig = JSON.parse(formData.config_json) as Record<string, unknown>;
          if (!extraConfig || typeof extraConfig !== "object" || Array.isArray(extraConfig)) {
            throw new Error("Config JSON must be an object");
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Invalid Config JSON");
          return;
        }
      }

      if (requiresBotToken(formData.type) && !formData.bot_token.trim()) {
        setError("Bot token is required for this platform.");
        return;
      }

      const res = await fetch("/api/interfaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formData.type,
          name: formData.name,
          config: {
            ...(formData.bot_token ? { bot_token: formData.bot_token } : {}),
            ...(formData.type === "discord" && formData.client_id
              ? { client_id: formData.client_id }
              : {}),
            ...(formData.type === "discord" && formData.allowed_guilds
              ? {
                  allowed_guilds: formData.allowed_guilds
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }
              : {}),
            ...(formData.type === "slack" && formData.slack_app_token
              ? { app_token: formData.slack_app_token }
              : {}),
            ...(formData.type === "slack" && formData.slack_signing_secret
              ? { signing_secret: formData.slack_signing_secret }
              : {}),
            ...extraConfig,
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
                  onChange={(e) => {
                    const type = e.target.value as InterfaceType;
                    setFormData((prev) => ({
                      ...prev,
                      type,
                      name: defaultNames[type] || "My Bot",
                    }));
                  }}
                  className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  {interfaceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {interfaceOptions.find((o) => o.value === formData.type)?.hint}
                </p>
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
                  required={requiresBotToken(formData.type)}
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {formData.type === "telegram"
                    ? "Get this from @BotFather on Telegram"
                    : formData.type === "discord"
                      ? "Get this from the Discord Developer Portal → Bot → Token"
                      : formData.type === "slack"
                        ? "Slack bot token (xoxb-...). Required if you want to run the Slack interface."
                        : "Optional for this interface type"}
                </p>
              </div>

              {formData.type === "discord" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                    Discord Client ID
                  </label>
                  <input
                    type="text"
                    value={formData.client_id}
                    onChange={(e) => setFormData((prev) => ({ ...prev, client_id: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    placeholder="123456789012345678"
                  />
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Needed for slash command registration.
                  </p>
                </div>
              )}

              {formData.type === "discord" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                    Allowed Guild IDs (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.allowed_guilds}
                    onChange={(e) => setFormData((prev) => ({ ...prev, allowed_guilds: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                    placeholder="123456789012345678, 987654321098765432"
                  />
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Comma-separated Discord server IDs. Leave empty to allow all.
                  </p>
                </div>
              )}

              {formData.type === "slack" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                      Slack App Token (Optional)
                    </label>
                    <input
                      type="password"
                      value={formData.slack_app_token}
                      onChange={(e) => setFormData((prev) => ({ ...prev, slack_app_token: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      placeholder="xapp-..."
                    />
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      Needed for Socket Mode. If using Events API, leave empty.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                      Slack Signing Secret (Optional)
                    </label>
                    <input
                      type="password"
                      value={formData.slack_signing_secret}
                      onChange={(e) => setFormData((prev) => ({ ...prev, slack_signing_secret: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                      placeholder="..."
                    />
                  </div>
                </div>
              )}

              {formData.type !== "telegram" && formData.type !== "discord" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                    Config JSON (Optional)
                  </label>
                  <textarea
                    value={formData.config_json}
                    onChange={(e) => setFormData((prev) => ({ ...prev, config_json: e.target.value }))}
                    rows={5}
                    className="w-full px-4 py-2.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border)] rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] font-[var(--font-mono)] text-xs"
                    placeholder='{"webhook_url":"...","webhook_secret":"..."}'
                  />
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    For extension interfaces, store whatever config keys you need here. Secrets are encrypted when the key is known (e.g. bot_token/webhook_secret).
                  </p>
                </div>
              )}

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
                  Comma-separated user IDs. Leave empty to allow all.
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
