"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

interface MemoryEntry {
 id: number;
 key: string;
 value: string;
 category: "preference" | "fact" | "project" | "context" | "custom";
 importance: number;
 source: string | null;
 created_at: string;
 updated_at: string;
}

interface MemoryStats {
 total: number;
 byCategory: Record<string, number>;
 avgImportance: number;
}

export default function MemoryPage() {
 const [memories, setMemories] = useState<MemoryEntry[]>([]);
 const [stats, setStats] = useState<MemoryStats | null>(null);
 const [loading, setLoading] = useState(true);
 const [showForm, setShowForm] = useState(false);
 const [editingId, setEditingId] = useState<number | null>(null);
 const [filter, setFilter] = useState<string>("all");
 const [search, setSearch] = useState("");

 const [form, setForm] = useState({
  key: "",
  value: "",
  category: "custom" as "preference" | "fact" | "project" | "context" | "custom",
  importance: 5,
 });

 useEffect(() => {
  fetchMemories();
  fetchStats();
 }, [filter]);

 async function fetchMemories() {
  setLoading(true);
  try {
   const url = filter === "all" 
    ? "/api/memory" 
    : `/api/memory?category=${filter}`;
   const res = await fetch(url);
   const data = await res.json();
   setMemories(data);
  } catch (error) {
   console.error("Failed to fetch memories:", error);
  }
  setLoading(false);
 }

 async function fetchStats() {
  try {
   const res = await fetch("/api/memory?action=stats");
   const data = await res.json();
   setStats(data);
  } catch (error) {
   console.error("Failed to fetch stats:", error);
  }
 }

 async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  
  try {
   if (editingId) {
    await fetch(`/api/memory`, {
     method: "PUT",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ id: editingId, ...form }),
    });
   } else {
    await fetch("/api/memory", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify(form),
    });
   }
   
   setForm({ key: "", value: "", category: "custom", importance: 5 });
   setShowForm(false);
   setEditingId(null);
   fetchMemories();
   fetchStats();
  } catch (error) {
   console.error("Failed to save memory:", error);
  }
 }

 async function handleDelete(id: number) {
  if (!confirm("Delete this memory?")) return;
  
  try {
   await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
   fetchMemories();
   fetchStats();
  } catch (error) {
   console.error("Failed to delete memory:", error);
  }
 }

 function handleEdit(memory: MemoryEntry) {
  setForm({
   key: memory.key,
   value: memory.value,
   category: memory.category,
   importance: memory.importance,
  });
  setEditingId(memory.id);
  setShowForm(true);
 }

 const filteredMemories = search
  ? memories.filter(
    m =>
     m.key.toLowerCase().includes(search.toLowerCase()) ||
     m.value.toLowerCase().includes(search.toLowerCase())
   )
  : memories;

 const categoryColors: Record<string, string> = {
  preference: "bg-blue-500/20 text-blue-400",
  fact: "bg-green-500/20 text-green-400",
  project: "bg-purple-500/20 text-purple-400",
  context: "bg-yellow-500/20 text-yellow-400",
  custom: "bg-gray-500/20 text-gray-400",
 };

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <h1 className="text-2xl font-bold tracking-tight text-foreground">Super Memory</h1>
     <p className="text-sm text-muted-foreground">
      Long-term memory that persists across all conversations
     </p>
    </div>
    <button
     onClick={() => {
      setShowForm(true);
      setEditingId(null);
      setForm({ key: "", value: "", category: "custom", importance: 5 });
     }}
     className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 shadow-sm"
    >
     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
     </svg>
     Add Memory
    </button>
   </div>

   {stats && stats.total > 0 && (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
     <div className="rounded-xl border border-border bg-card p-5 shadow-sm hover:border-primary/50 transition-colors">
      <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{stats.total}</div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">Total Memories</div>
     </div>
     {Object.entries(stats.byCategory).map(([cat, count]) => (
      <div key={cat} className="rounded-xl border border-border bg-card p-5 shadow-sm hover:border-primary/50 transition-colors">
       <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{count}</div>
       <div className={cn("text-xs font-semibold uppercase tracking-wider mt-1", categoryColors[cat]?.replace("bg-", "text-").replace("/20", "").replace("border-", "text-").replace("/30", ""))}>
        {cat}
       </div>
      </div>
     ))}
    </div>
   )}

   <div className="rounded-xl border border-border bg-card shadow-sm p-4 flex flex-col sm:flex-row gap-4">
    <div className="relative flex-1">
     <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
     </svg>
     <Input
      type="text"
      placeholder="Search memories..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200"
     />
    </div>
    <NativeSelect
     value={filter}
     onChange={(e) => setFilter(e.target.value)}
     className="w-full sm:w-48 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 appearance-none cursor-pointer"
    >
     <option value="all">All Categories</option>
     <option value="preference">Preferences</option>
     <option value="fact">Facts</option>
     <option value="project">Projects</option>
     <option value="context">Context</option>
     <option value="custom">Custom</option>
    </NativeSelect>
   </div>

   {showForm && (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
     <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg shadow-lg animate-in zoom-in-95 duration-200">
      <h2 className="text-xl font-semibold tracking-tight text-foreground mb-5">
       {editingId ? "Edit Memory" : "Add New Memory"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-5">
       <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground tracking-tight">Key</label>
        <Input
         type="text"
         value={form.key}
         onChange={(e) => setForm({ ...form, key: e.target.value })}
         className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
         placeholder="e.g., user_prefers_dark_mode"
         required
        />
       </div>
       <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground tracking-tight">Value</label>
        <Textarea
         value={form.value}
         onChange={(e) => setForm({ ...form, value: e.target.value })}
         className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground h-28 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm resize-none"
         placeholder="The value to remember..."
         required
        />
       </div>
       <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
         <label className="text-sm font-medium text-foreground tracking-tight">Category</label>
         <NativeSelect
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value as any })}
          className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm appearance-none"
         >
          <option value="custom">Custom</option>
          <option value="preference">Preference</option>
          <option value="fact">Fact</option>
          <option value="project">Project</option>
          <option value="context">Context</option>
         </NativeSelect>
        </div>
        <div className="space-y-1.5">
         <label className="text-sm font-medium text-foreground tracking-tight">Importance (1-10)</label>
         <Input
          type="number"
          min={1}
          max={10}
          value={form.importance}
          onChange={(e) => setForm({ ...form, importance: parseInt(e.target.value) })}
          className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm"
         />
        </div>
       </div>
       <div className="flex gap-3 pt-5 mt-5 border-t border-border">
        <button
         type="submit"
         className="flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 shadow-sm"
        >
         {editingId ? "Update" : "Add"} Memory
        </button>
        <button
         type="button"
         onClick={() => {
          setShowForm(false);
          setEditingId(null);
         }}
         className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground h-9 px-4 py-2 shadow-sm"
        >
         Cancel
        </button>
       </div>
      </form>
     </div>
    </div>
   )}

   <div className="space-y-4">
    {loading ? (
     <div className="text-center py-12">
      <svg className="animate-spin h-8 w-8 text-primary mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
       <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
       <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p className="text-sm text-muted-foreground">Loading memories...</p>
     </div>
    ) : filteredMemories.length === 0 ? (
     <div className="text-center py-12 rounded-xl border border-border bg-card shadow-sm">
      <svg className="w-12 h-12 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      </svg>
      <h3 className="text-base font-semibold tracking-tight text-foreground mb-1">
       {search ? "No memories match your search" : "No memories yet"}
      </h3>
      <p className="text-sm text-muted-foreground">
       {search ? "Try adjusting your search terms" : "Click 'Add Memory' to create your first one."}
      </p>
     </div>
    ) : (
     filteredMemories.map((memory) => (
      <div
       key={memory.id}
       className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors duration-200 hover:border-primary/50 hover:shadow-md"
      >
       <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
         <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={cn(
           "px-2 py-0.5 rounded font-semibold text-[10px] uppercase tracking-wider",
           categoryColors[memory.category] || "bg-muted text-muted-foreground"
          )}>
           {memory.category}
          </span>
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded border border-border/50">
           <svg className="w-3 h-3 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
           </svg>
           {memory.importance}/10
          </span>
          {memory.source && (
           <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {memory.source}
           </span>
          )}
         </div>
         <h3 className="text-base font-semibold tracking-tight text-foreground font-mono">{memory.key}</h3>
         <div className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed bg-muted/30 p-3 rounded-md border border-border/50">
          {memory.value}
         </div>
        </div>
        <div className="flex sm:flex-col gap-2 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
         <button
          onClick={() => handleEdit(memory)}
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground h-8 px-3 shadow-sm"
         >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
         </button>
         <button
          onClick={() => handleDelete(memory.id)}
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-destructive/10 text-destructive hover:bg-destructive/20 h-8 px-3 shadow-sm"
         >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
         </button>
        </div>
       </div>
      </div>
     ))
    )}
   </div>
  </div>
 );
}
