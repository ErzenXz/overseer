"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { PlayIcon, StopCircleIcon, PlusIcon, XIcon, ClockIcon, ActivityIcon, CheckCircle2Icon, XCircleIcon, AlertCircleIcon, Settings2Icon, FileTextIcon, TerminalIcon, CpuIcon, Trash2Icon, DownloadIcon, Edit2Icon, CopyIcon, UploadIcon, FolderPlusIcon, FilePlusIcon, SearchIcon, SortAscIcon, SortDescIcon, FileIcon, ImageIcon, FileCodeIcon, LayoutGridIcon, LayoutListIcon, FolderOpenIcon } from "lucide-react";

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

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

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
 const [viewMode, setViewMode] = useState<"list" | "grid">("list");

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
   <Input
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

   <div className="mb-4 bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-border flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
     <div className="flex items-center gap-2 flex-wrap">
      <div className="text-xs text-muted-foreground font-mono">
       {breadcrumbs.map((c, idx) => (
        <span key={c.path}>
         <button
          onClick={() => loadDir(c.path)}
          className="hover:text-foreground text-muted-foreground transition-colors font-medium"
         >
          {c.label}
         </button>
         {idx < breadcrumbs.length - 1 ? <span className="text-muted-foreground/50 mx-1">/</span> : ""}
        </span>
       ))}
      </div>
      <div className="h-4 w-px bg-border mx-1 hidden md:block" />
      <div className="text-[10px] font-mono px-2 py-0.5 rounded border border-border/50 bg-muted/30 text-muted-foreground">
       {selectedArray.length > 0
        ? `${selectedArray.length} selected`
        : `${entries.length} items`}
      </div>
     </div>

     <div className="flex items-center gap-2">
      <div className="relative">
       <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
       <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search files..."
        className="w-[200px] md:w-[260px] h-8 pl-8 pr-3 text-xs rounded-md bg-background border border-input text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground"
       />
       {query && (
        <button 
         onClick={() => setQuery("")}
         className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
         <XIcon className="w-3.5 h-3.5" />
        </button>
       )}
      </div>
      <div className="h-4 w-px bg-border mx-1 hidden md:block" />
      <button
       onClick={newFolder}
       className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors"
       title="New folder"
      >
       <FolderPlusIcon className="w-3.5 h-3.5" />
       <span className="hidden lg:inline-block">New folder</span>
      </button>
      <button
       onClick={newTextFile}
       className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors"
       title="New file"
      >
       <FilePlusIcon className="w-3.5 h-3.5" />
       <span className="hidden lg:inline-block">New file</span>
      </button>
      <button
       onClick={() => fileInputRef.current?.click()}
       className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
      >
       <UploadIcon className="w-3.5 h-3.5" />
       Upload
      </button>
     </div>
    </div>

    {/* Toolbar */}
    <div className="px-4 py-2 border-b border-border/50 flex items-center gap-2 flex-wrap bg-muted/10">
     <div className="flex items-center gap-1 bg-muted/30 border border-border/50 rounded-md p-0.5">
      <button
       onClick={() => setViewMode("list")}
       className={`p-1.5 rounded-sm transition-colors ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
       title="List view"
      >
       <LayoutListIcon className="w-3.5 h-3.5" />
      </button>
      <button
       onClick={() => setViewMode("grid")}
       className={`p-1.5 rounded-sm transition-colors ${viewMode === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
       title="Grid view"
      >
       <LayoutGridIcon className="w-3.5 h-3.5" />
      </button>
     </div>

     <div className="h-4 w-px bg-border mx-1" />

     <button
      onClick={downloadSelected}
      disabled={!selectedPrimary}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-transparent hover:bg-primary hover:text-accent-foreground text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
      title="Download"
     >
      <DownloadIcon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline-block">Download</span>
     </button>
     <button
      onClick={renameSelected}
      disabled={!selectedPrimary}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-transparent hover:bg-primary hover:text-accent-foreground text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
      title="Rename"
     >
      <Edit2Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline-block">Rename</span>
     </button>
     <button
      onClick={copyPath}
      disabled={!selectedPrimary}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-transparent hover:bg-primary hover:text-accent-foreground text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
      title="Copy path"
     >
      <CopyIcon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline-block">Copy path</span>
     </button>
     <button
      onClick={deleteSelected}
      disabled={selectedArray.length === 0}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      title="Delete"
     >
      <Trash2Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline-block">Delete</span>
     </button>

     <div className="ml-auto flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
       Sort
      </span>
      <div className="flex items-center gap-1 bg-muted/30 border border-border/50 rounded-md p-0.5">
       <button
        onClick={() => toggleSort("name")}
        className={`px-2 py-1 text-[10px] font-medium rounded-sm transition-colors ${
         sortKey === "name"
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
        }`}
       >
        Name {sortKey === "name" && (sortDir === "asc" ? "↑" : "↓")}
       </button>
       <button
        onClick={() => toggleSort("modifiedAt")}
        className={`px-2 py-1 text-[10px] font-medium rounded-sm transition-colors ${
         sortKey === "modifiedAt"
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
        }`}
       >
        Date {sortKey === "modifiedAt" && (sortDir === "asc" ? "↑" : "↓")}
       </button>
       <button
        onClick={() => toggleSort("size")}
        className={`px-2 py-1 text-[10px] font-medium rounded-sm transition-colors ${
         sortKey === "size"
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
        }`}
       >
        Size {sortKey === "size" && (sortDir === "asc" ? "↑" : "↓")}
       </button>
      </div>
     </div>
    </div>

    {error ? (
     <div className="px-4 py-3 text-sm text-destructive bg-destructive/10 border-b border-destructive/20 flex items-center gap-2">
      <AlertCircleIcon className="w-4 h-4" />
      {error}
     </div>
    ) : null}
   </div>

   <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_420px] gap-6">
    <div
     className="relative bg-card border border-border rounded-xl shadow-sm overflow-hidden"
     {...dropOverlayHandlers}
    >
     {dragging ? (
      <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary/50 m-2 rounded-lg">
       <div className="flex flex-col items-center gap-2 text-primary">
        <UploadIcon className="w-8 h-8 animate-bounce" />
        <div className="font-medium">Drop files to upload into</div>
        <div className="font-mono text-xs bg-primary/10 px-2 py-1 rounded-md">{cwd}</div>
       </div>
      </div>
     ) : null}

     {viewMode === "list" ? (
      <div className="overflow-x-auto">
       <table className="w-full text-sm">
        <thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border/50">
         <tr>
          <th className="text-left px-4 py-3 font-medium">Name</th>
          <th className="text-left px-3 py-3 w-[120px] font-medium">Type</th>
          <th className="text-left px-3 py-3 w-[100px] font-medium">Size</th>
          <th className="text-left px-4 py-3 w-[180px] font-medium">Modified</th>
         </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
         {loading ? (
          <tr>
           <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
             <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
             <span className="text-sm font-medium">Loading files...</span>
            </div>
           </td>
          </tr>
         ) : filteredSorted.length === 0 ? (
          <tr>
           <td colSpan={4} className="px-4 py-16 text-center text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
             <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
              {query.trim() ? <SearchIcon className="w-5 h-5 opacity-50" /> : <FolderOpenIcon className="w-5 h-5 opacity-50" />}
             </div>
             <span className="text-sm font-medium text-foreground">{query.trim() ? "No matches found" : "Folder is empty"}</span>
             <span className="text-xs">{query.trim() ? "Try adjusting your search query." : "Upload files or create a new folder."}</span>
            </div>
           </td>
          </tr>
         ) : (
          filteredSorted.map((e) => {
           const isSelected = selected.has(e.path);
           return (
            <tr
             key={e.path}
             onClick={(evt) => onRowClick(evt, e)}
             className={cn(
              "cursor-pointer transition-colors group",
              isSelected 
               ? "bg-primary/5 hover:bg-primary/10" 
               : "hover:bg-muted/50"
             )}
            >
             <td className="px-4 py-3">
              <div className="flex items-center gap-3">
               <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
                e.type === "directory"
                 ? "bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/20"
                 : isImage(e.name) ? "bg-purple-500/10 text-purple-500 group-hover:bg-purple-500/20"
                 : isTextLike(e.name) ? "bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20"
                 : "bg-muted text-muted-foreground group-hover:bg-muted/80"
               )}>
                {e.type === "directory" ? <FolderOpenIcon className="w-4 h-4 fill-current/20" /> :
                 isImage(e.name) ? <ImageIcon className="w-4 h-4" /> :
                 isTextLike(e.name) ? <FileCodeIcon className="w-4 h-4" /> :
                 <FileIcon className="w-4 h-4" />}
               </div>
               <span className={cn(
                "font-medium truncate max-w-[200px] sm:max-w-[300px]",
                isSelected ? "text-primary" : "text-foreground"
               )}>{e.name}</span>
              </div>
             </td>
             <td className="px-3 py-3 text-xs text-muted-foreground capitalize">
              {e.type}
             </td>
             <td className="px-3 py-3 text-xs text-muted-foreground font-mono">
              {e.type === "file" ? formatBytes(e.size) : "—"}
             </td>
             <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(e.modifiedAt).toLocaleDateString()} {new Date(e.modifiedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
             </td>
            </tr>
           );
          })
         )}
        </tbody>
       </table>
      </div>
     ) : (
      <div className="p-4 min-h-[400px]">
       {loading ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-20">
         <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
         <span className="text-sm font-medium">Loading files...</span>
        </div>
       ) : filteredSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-20">
         <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
          {query.trim() ? <SearchIcon className="w-5 h-5 opacity-50" /> : <FolderOpenIcon className="w-5 h-5 opacity-50" />}
         </div>
         <span className="text-sm font-medium text-foreground">{query.trim() ? "No matches found" : "Folder is empty"}</span>
         <span className="text-xs">{query.trim() ? "Try adjusting your search query." : "Upload files or create a new folder."}</span>
        </div>
       ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
         {filteredSorted.map((e) => {
          const isSelected = selected.has(e.path);
          return (
           <div
            key={e.path}
            onClick={(evt) => onRowClick(evt, e)}
            className={cn(
             "cursor-pointer group flex flex-col items-center gap-3 p-3 rounded-xl border transition-colors duration-200",
             isSelected 
              ? "bg-primary/5 border-primary/30 shadow-sm ring-1 ring-primary/20" 
              : "bg-card border-border hover:border-primary/30 hover:shadow-sm"
            )}
           >
            <div className={cn(
             "flex items-center justify-center w-14 h-14 rounded-2xl transition-colors",
             e.type === "directory"
              ? "bg-blue-500/10 text-blue-500 group-hover:bg-blue-500/20"
              : isImage(e.name) ? "bg-purple-500/10 text-purple-500 group-hover:bg-purple-500/20"
              : isTextLike(e.name) ? "bg-amber-500/10 text-amber-500 group-hover:bg-amber-500/20"
              : "bg-muted text-muted-foreground group-hover:bg-muted/80"
            )}>
             {e.type === "directory" ? <FolderOpenIcon className="w-7 h-7 fill-current/20" /> :
              isImage(e.name) ? <ImageIcon className="w-7 h-7" /> :
              isTextLike(e.name) ? <FileCodeIcon className="w-7 h-7" /> :
              <FileIcon className="w-7 h-7" />}
            </div>
            <div className="w-full text-center space-y-0.5">
             <div className={cn(
              "text-sm font-medium truncate w-full px-1",
              isSelected ? "text-primary" : "text-foreground"
             )} title={e.name}>
              {e.name}
             </div>
             {e.type === "file" && (
              <div className="text-[10px] text-muted-foreground font-mono">
               {formatBytes(e.size)}
              </div>
             )}
            </div>
           </div>
          );
         })}
        </div>
       )}
      </div>
     )}
    </div>

    {/* Preview Panel */}
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col h-full lg:sticky lg:top-8 max-h-[calc(100vh-8rem)]">
     <div className="px-5 py-4 border-b border-border/50 bg-muted/20">
      <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
       Preview
      </h2>
      <div className="text-xs text-muted-foreground mt-1 truncate" title={previewName || (selectedPrimary ? selectedPrimary.split("/").pop() : "Select a file")}>
       {previewName || (selectedPrimary ? selectedPrimary.split("/").pop() : "Select a file to view details")}
      </div>
     </div>

     <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
      {previewPath && previewMeta?.type === "file" ? (
       <div className="space-y-6">
        <div className="text-[10px] text-muted-foreground font-mono bg-muted/30 p-2 rounded-md border border-border/50 break-all">
         {previewPath}
        </div>

        {isImage(previewName) ? (
         <div className="rounded-xl overflow-hidden border border-border bg-muted/30 flex items-center justify-center min-h-[200px] p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewDownloadUrl} alt={previewName} className="max-w-full max-h-[300px] object-contain rounded-lg" />
         </div>
        ) : isPdf(previewName) ? (
         <div className="rounded-xl overflow-hidden border border-border bg-muted/10">
          <iframe
           src={previewDownloadUrl}
           className="w-full h-[400px]"
           title={previewName}
          />
         </div>
        ) : isTextLike(previewName) ? (
         <div className="rounded-xl border border-border overflow-hidden bg-muted/10">
          <div className="px-3 py-1.5 bg-muted/30 border-b border-border flex justify-between items-center text-[10px] font-mono text-muted-foreground">
           <span>Source</span>
           {loading && <span className="animate-pulse">Loading...</span>}
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed p-4 font-mono max-h-[400px] overflow-auto custom-scrollbar text-foreground">
           {previewContent}
          </pre>
         </div>
        ) : (
         <div className="rounded-xl border border-border border-dashed p-8 flex flex-col items-center justify-center text-center gap-3 bg-muted/10">
          <FileIcon className="w-10 h-10 text-muted-foreground/50" />
          <div className="text-sm font-medium text-foreground">No preview available</div>
          <div className="text-xs text-muted-foreground max-w-[200px]">
           This file format cannot be previewed in the browser.
          </div>
         </div>
        )}

        <div className="grid grid-cols-2 gap-2">
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
          className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm w-full"
         >
          <DownloadIcon className="w-3.5 h-3.5" />
          Download File
         </button>
         <button
          onClick={() => setPreviewPath(null)}
          className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium rounded-md bg-background border border-input text-foreground hover:bg-primary hover:text-accent-foreground transition-colors w-full"
         >
          <XIcon className="w-3.5 h-3.5" />
          Close Preview
         </button>
        </div>

        <div className="pt-5 border-t border-border/50">
         <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">File Information</h3>
         <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
           <div className="text-xs text-muted-foreground">Type</div>
           <div className="font-medium text-foreground capitalize">{previewMeta.type}</div>
          </div>
          <div className="space-y-1">
           <div className="text-xs text-muted-foreground">Size</div>
           <div className="font-medium text-foreground font-mono">{formatBytes(previewMeta.size)}</div>
          </div>
          <div className="col-span-2 space-y-1">
           <div className="text-xs text-muted-foreground">Last Modified</div>
           <div className="font-medium text-foreground">
            {new Date(previewMeta.modifiedAt).toLocaleString(undefined, {
             weekday: 'short',
             year: 'numeric',
             month: 'short',
             day: 'numeric',
             hour: '2-digit',
             minute: '2-digit'
            })}
           </div>
          </div>
         </div>
        </div>
       </div>
      ) : (
       <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
         <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
        </div>
        <div className="space-y-1">
         <h3 className="text-sm font-medium text-foreground">No File Selected</h3>
         <p className="text-xs text-muted-foreground max-w-[200px] mx-auto">
          Select a file from the list to preview its contents and view details.
         </p>
        </div>
       </div>
      )}
     </div>
    </div>
   </div>
  </div>
 );
}
