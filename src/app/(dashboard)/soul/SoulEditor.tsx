"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SoulEditorProps {
  initialContent: string;
  isCustom: boolean;
  defaultSoul: string;
}

export function SoulEditor({ initialContent, isCustom, defaultSoul }: SoulEditorProps) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const hasChanges = content !== initialContent;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Are you sure you want to reset to the default SOUL.md? Your custom changes will be lost.")) {
      return;
    }

    try {
      const res = await fetch("/api/soul", { method: "DELETE" });
      if (res.ok) {
        setContent(defaultSoul);
        router.refresh();
      }
    } catch {
      setError("Failed to reset");
    }
  };

  return (
    <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-white">SOUL.md</h2>
          {hasChanges && (
            <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
              Unsaved changes
            </span>
          )}
          {saved && (
            <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
              Saved!
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isCustom && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
            >
              Reset to Default
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-4 py-1.5 text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full h-[600px] p-4 bg-transparent text-[var(--color-text-primary)] font-mono text-sm resize-none focus:outline-none"
        placeholder="# Overseer Soul Document

## Identity
..."
        spellCheck={false}
      />
    </div>
  );
}
