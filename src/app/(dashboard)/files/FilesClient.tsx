"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

type Entry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  modifiedAt: string;
};

type SortKey = "name" | "modifiedAt" | "size" | "type";
type SortDir = "asc" | "desc";

function formatBytes(n: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function isImage(name: string): boolean {
  const s = name.toLowerCase();
  return (
    s.endsWith(".png") ||
    s.endsWith(".jpg") ||
    s.endsWith(".jpeg") ||
    s.endsWith(".gif") ||
    s.endsWith(".webp") ||
    s.endsWith(".svg")
  );
}

function isTextLike(name: string): boolean {
  const s = name.toLowerCase();
  return (
    s.endsWith(".txt") ||
    s.endsWith(".md") ||
    s.endsWith(".log") ||
    s.endsWith(".json") ||
    s.endsWith(".yml") ||
    s.endsWith(".yaml") ||
    s.endsWith(".ts") ||
    s.endsWith(".tsx") ||
    s.endsWith(".js") ||
    s.endsWith(".jsx") ||
    s.endsWith(".css") ||
    s.endsWith(".html")
  );
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

export function FilesClient() {
  const [cwd, setCwd] = useState<string>(".");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedArray = useMemo(() => Array.from(selected.values()), [selected]);
  const selectedPrimary = selectedArray.length === 1 ? selectedArray[0] : null;

  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewMeta, setPreviewMeta] = useState<Entry | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const breadcrumbs = useMemo(() => {
    const parts = cwd === "." ? [] : cwd.split("/").filter(Boolean);
    const crumbs: Array<{ label: string; path: string }> = [
      { label: "root", path: "." },
    ];
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
      setSelected(new Set());
      setPreviewPath(null);
      setPreviewName("");
      setPreviewContent("");
      setPreviewMeta(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  };

  const openFilePreview = async (entry: Entry) => {
    setPreviewPath(entry.path);
    setPreviewName(entry.name);
    setPreviewMeta(entry);
    setPreviewContent("");

    if (!isTextLike(entry.name)) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/files?action=read&path=${encodeURIComponent(entry.path)}`,
        { method: "GET" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      setPreviewContent(String(data.content || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file");
    } finally {
      setLoading(false);
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

  const newTextFile = async () => {
    const name = prompt("File name", "notes.txt");
    if (!name) return;
    const path = cwd === "." ? name : `${cwd}/${name}`;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", path, content: "" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Create failed");
      await loadDir(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setLoading(true);
    setError("");
    try {
      for (const f of files) {
        const form = new FormData();
        form.set("action", "upload");
        form.set("path", cwd);
        form.set("file", f);
        const res = await fetch("/api/files", { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Upload failed: ${f.name}`);
        }
      }
      await loadDir(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteSelected = async () => {
    if (selectedArray.length === 0) return;
    const ok = confirm(`Delete ${selectedArray.length} item(s)?`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      for (const p of selectedArray) {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", path: p }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Delete failed");
      }
      await loadDir(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  const renameSelected = async () => {
    if (!selectedPrimary) return;
    const entry = entries.find((e) => e.path === selectedPrimary);
    const currentName = entry?.name || selectedPrimary.split("/").pop() || selectedPrimary;
    const nextName = prompt("Rename to", currentName);
    if (!nextName || nextName === currentName) return;
    const baseDir =
      selectedPrimary.includes("/") ? selectedPrimary.split("/").slice(0, -1).join("/") : ".";
    const to = baseDir === "." ? nextName : `${baseDir}/${nextName}`;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", from: selectedPrimary, to }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Rename failed");
      await loadDir(cwd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadSelected = () => {
    if (!selectedPrimary) return;
    const url = `/api/files?action=download&disposition=attachment&path=${encodeURIComponent(
      selectedPrimary,
    )}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyPath = async () => {
    if (!selectedPrimary) return;
    try {
      await navigator.clipboard.writeText(selectedPrimary);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadDir(".");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => e.name.toLowerCase().includes(q))
      : entries;

    const dirFirst = (a: Entry, b: Entry) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return 0;
    };

    const cmp = (a: Entry, b: Entry) => {
      const df = dirFirst(a, b);
      if (df !== 0) return df;

      let v = 0;
      switch (sortKey) {
        case "name":
          v = a.name.localeCompare(b.name);
          break;
        case "type":
          v = a.type.localeCompare(b.type);
          break;
        case "modifiedAt":
          v = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
          break;
        case "size":
          v = (a.size ?? -1) - (b.size ?? -1);
          break;
        default:
          v = a.name.localeCompare(b.name);
      }
      return sortDir === "asc" ? v : -v;
    };

    return [...filtered].sort(cmp);
  }, [entries, query, sortKey, sortDir]);

  const onRowClick = (e: MouseEvent, entry: Entry) => {
    const multi = e.metaKey || e.ctrlKey;
    setSelected((prev) => {
      const next = new Set(prev);
      if (!multi) next.clear();
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });

    if (entry.type === "file") void openFilePreview(entry);
    if (entry.type === "directory" && !multi) void loadDir(entry.path);
  };

  const toggleSort = (k: SortKey) => {
    setSortKey((prev) => {
      if (prev !== k) {
        setSortDir("asc");
        return k;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prev;
    });
  };

  const dropOverlayHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) setDragging(false);
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files || []);
      void uploadFiles(files);
    },
  };

  const previewDownloadUrl = previewPath
    ? `/api/files?action=download&disposition=inline&path=${encodeURIComponent(previewPath)}`
    : "";

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.currentTarget.value = "";
          void uploadFiles(files);
        }}
      />

      <div className="mb-4 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
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
            <div className="h-4 w-px bg-[var(--color-border)] mx-1 hidden md:block" />
            <div className="text-[10px] font-[var(--font-mono)] px-2 py-1 rounded-full bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)]">
              {selectedArray.length > 0
                ? `${selectedArray.length} selected`
                : `${entries.length} items`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-[220px] md:w-[320px] px-3 py-2 text-sm rounded-lg bg-[var(--color-surface-overlay)] border border-[var(--color-border)] text-white outline-none focus:border-[var(--color-accent)]"
              />
              <div className="pointer-events-none absolute right-3 top-2.5 text-[10px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
                /
              </div>
            </div>
            <button
              onClick={newFolder}
              className="px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors"
            >
              New folder
            </button>
            <button
              onClick={newTextFile}
              className="px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors"
            >
              New file
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 text-xs rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black transition-colors"
            >
              Upload
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 flex-wrap">
          <button
            onClick={downloadSelected}
            disabled={!selectedPrimary}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors disabled:opacity-50"
          >
            Download
          </button>
          <button
            onClick={renameSelected}
            disabled={!selectedPrimary}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors disabled:opacity-50"
          >
            Rename
          </button>
          <button
            onClick={deleteSelected}
            disabled={selectedArray.length === 0}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 transition-colors disabled:opacity-50"
          >
            Delete
          </button>
          <button
            onClick={copyPath}
            disabled={!selectedPrimary}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors disabled:opacity-50"
          >
            Copy path
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
              Sort:
            </span>
            <button
              onClick={() => toggleSort("name")}
              className={`px-2 py-1 text-[10px] rounded-md border font-[var(--font-mono)] ${
                sortKey === "name"
                  ? "bg-[var(--color-accent)] text-black border-transparent"
                  : "bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-white"
              }`}
            >
              name
            </button>
            <button
              onClick={() => toggleSort("modifiedAt")}
              className={`px-2 py-1 text-[10px] rounded-md border font-[var(--font-mono)] ${
                sortKey === "modifiedAt"
                  ? "bg-[var(--color-accent)] text-black border-transparent"
                  : "bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-white"
              }`}
            >
              modified
            </button>
            <button
              onClick={() => toggleSort("size")}
              className={`px-2 py-1 text-[10px] rounded-md border font-[var(--font-mono)] ${
                sortKey === "size"
                  ? "bg-[var(--color-accent)] text-black border-transparent"
                  : "bg-[var(--color-surface-overlay)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-white"
              }`}
            >
              size
            </button>
          </div>
        </div>

        {error ? (
          <div className="px-4 py-3 text-xs text-red-300 bg-red-500/10 border-b border-red-500/20">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div
          className="relative bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-xl overflow-hidden"
          {...dropOverlayHandlers}
        >
          {dragging ? (
            <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <div className="px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-overlay)] text-white">
                Drop files to upload into <span className="font-[var(--font-mono)]">{cwd}</span>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-[var(--font-mono)] bg-[var(--color-surface-overlay)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-3 py-3 w-[140px]">Type</th>
                  <th className="text-left px-3 py-3 w-[140px]">Size</th>
                  <th className="text-left px-4 py-3 w-[220px]">Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-[var(--color-text-muted)]">
                      Loading...
                    </td>
                  </tr>
                ) : filteredSorted.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-[var(--color-text-muted)]">
                      {query.trim() ? "No matches." : "Empty folder."}
                    </td>
                  </tr>
                ) : (
                  filteredSorted.map((e) => {
                    const isSelected = selected.has(e.path);
                    return (
                      <tr
                        key={e.path}
                        onClick={(evt) => onRowClick(evt, e)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-[var(--color-surface-overlay)]" : "hover:bg-[var(--color-surface-overlay)]"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-[10px] font-[var(--font-mono)] px-2 py-1 rounded-full border ${
                                e.type === "directory"
                                  ? "bg-white/5 border-white/10 text-white"
                                  : "bg-[var(--color-surface-overlay)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                              }`}
                            >
                              {e.type === "directory" ? "folder" : "file"}
                            </span>
                            <div className="text-white">{e.name}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[var(--color-text-secondary)]">
                          {e.type}
                        </td>
                        <td className="px-3 py-3 text-[var(--color-text-secondary)]">
                          {e.type === "file" ? formatBytes(e.size) : ""}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                          {new Date(e.modifiedAt).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-text-muted)] font-[var(--font-mono)]">
              Preview
            </div>
            <div className="text-sm text-white mt-1">
              {previewName || (selectedPrimary ? selectedPrimary.split("/").pop() : "Select a file")}
            </div>
          </div>

          <div className="p-4">
            {previewPath && previewMeta?.type === "file" ? (
              <div className="space-y-3">
                <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
                  {previewPath}
                </div>

                {isImage(previewName) ? (
                  <div className="rounded-lg overflow-hidden border border-[var(--color-border)] bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewDownloadUrl} alt={previewName} className="w-full h-auto" />
                  </div>
                ) : isPdf(previewName) ? (
                  <div className="rounded-lg overflow-hidden border border-[var(--color-border)] bg-black/30">
                    <iframe
                      src={previewDownloadUrl}
                      className="w-full h-[420px]"
                      title={previewName}
                    />
                  </div>
                ) : isTextLike(previewName) ? (
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-overlay)] text-white font-[var(--font-mono)] max-h-[420px] overflow-auto">
                    {previewContent || (loading ? "Loading..." : "")}
                  </pre>
                ) : (
                  <div className="text-sm text-[var(--color-text-secondary)]">
                    No preview available for this file type.
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!previewPath) return;
                      window.open(
                        `/api/files?action=download&disposition=attachment&path=${encodeURIComponent(
                          previewPath,
                        )}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    className="px-3 py-2 text-xs rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-light)] text-black transition-colors"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setPreviewPath(null)}
                    className="px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-overlay)] hover:bg-[var(--color-border)] text-white transition-colors"
                  >
                    Clear
                  </button>
                </div>

                <div className="pt-3 border-t border-[var(--color-border)]">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-[var(--font-mono)]">
                        Type
                      </div>
                      <div className="text-white mt-1">{previewMeta.type}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-[var(--font-mono)]">
                        Size
                      </div>
                      <div className="text-white mt-1">{formatBytes(previewMeta.size)}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-[var(--font-mono)]">
                        Modified
                      </div>
                      <div className="text-white mt-1">
                        {new Date(previewMeta.modifiedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-[var(--color-text-muted)]">
                Select a file to preview it. You can also drag and drop files anywhere in the list to upload.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
