"use client";

import { useEffect, useMemo, useState } from "react";

type Entry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  modifiedAt: string;
};

export function FilesClient() {
  const [cwd, setCwd] = useState<string>(".");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const breadcrumbs = useMemo(() => {
    const parts = cwd === "." ? [] : cwd.split("/").filter(Boolean);
    const crumbs: Array<{ label: string; path: string }> = [{ label: "root", path: "." }];
    let acc = ".";
    for (const p of parts) {
      acc = acc === "." ? p : `${acc}/${p}`;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  }, [cwd]);

  const loadDir = async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        method: "GET",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      setEntries(data.entries || []);
      setCwd(path);
      setSelectedFile(null);
      setFileContent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  };

  const loadFile = async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/files?action=read&path=${encodeURIComponent(path)}`,
        { method: "GET" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      setSelectedFile(path);
      setFileContent(String(data.content || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load file");
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path: selectedFile, content: fileContent }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to save");
      await loadDir(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const newFolder = async () => {
    const name = prompt("Folder name");
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      const path = cwd === "." ? name : `${cwd}/${name}`;
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mkdir", path }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      await loadDir(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "mkdir failed");
    } finally {
      setLoading(false);
    }
  };

  const newFile = async () => {
    const name = prompt("File name");
    if (!name) return;
    const path = cwd === "." ? name : `${cwd}/${name}`;
    setSelectedFile(path);
    setFileContent("");
  };

  useEffect(() => {
    void loadDir(".");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
            {breadcrumbs.map((c, idx) => (
              <span key={c.path}>
                <button
                  onClick={() => loadDir(c.path)}
                  className="hover:text-white transition-colors"
                >
                  {c.label}
                </button>
                {idx < breadcrumbs.length - 1 ? " / " : ""}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={newFolder}
              className="px-2 py-1 text-xs rounded bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors"
            >
              New folder
            </button>
            <button
              onClick={newFile}
              className="px-2 py-1 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black transition-colors"
            >
              New file
            </button>
          </div>
        </div>

        {error ? (
          <div className="p-3 text-xs text-red-300 bg-red-500/10 border-b border-red-500/20">
            {error}
          </div>
        ) : null}

        <div className="divide-y divide-[var(--color-border)]">
          {loading ? (
            <div className="p-3 text-sm text-[var(--color-text-muted)]">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-3 text-sm text-[var(--color-text-muted)]">Empty</div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                onClick={() => (e.type === "directory" ? loadDir(e.path) : loadFile(e.path))}
                className={`w-full text-left p-3 hover:bg-[var(--color-surface-overlay)] transition-colors flex items-center justify-between ${
                  selectedFile === e.path ? "bg-[var(--color-surface-overlay)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)]">
                    {e.type}
                  </span>
                  <span className="text-sm text-white">{e.name}</span>
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {e.type === "file" && typeof e.size === "number" ? `${e.size}b` : ""}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="lg:col-span-2 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
            {selectedFile ? selectedFile : "Select a file"}
          </div>
          <button
            onClick={saveFile}
            disabled={!selectedFile || saving}
            className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {selectedFile ? (
          <textarea
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            className="w-full h-[540px] p-3 bg-[var(--color-surface-overlay)] text-white font-[var(--font-mono)] text-xs outline-none"
            spellCheck={false}
          />
        ) : (
          <div className="p-6 text-sm text-[var(--color-text-muted)]">
            Pick a file on the left, or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}

