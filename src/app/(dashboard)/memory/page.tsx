"use client";

import { useState, useEffect } from "react";

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
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white font-[var(--font-mono)]">
            Super Memory
          </h1>
          <p className="text-[var(--color-text-secondary)] mt-1">
            Long-term memory that persists across all conversations
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
            setForm({ key: "", value: "", category: "custom", importance: 5 });
          }}
          className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          Add Memory
        </button>
      </div>

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="text-2xl font-bold text-white">{stats.total}</div>
            <div className="text-sm text-[var(--color-text-secondary)]">Total Memories</div>
          </div>
          {Object.entries(stats.byCategory).map(([cat, count]) => (
            <div key={cat} className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-2xl font-bold text-white">{count}</div>
              <div className={`text-sm ${categoryColors[cat]?.replace("bg-", "text-")}`}>
                {cat}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search memories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-white placeholder:text-[var(--color-text-secondary)]"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-white"
        >
          <option value="all">All Categories</option>
          <option value="preference">Preferences</option>
          <option value="fact">Facts</option>
          <option value="project">Projects</option>
          <option value="context">Context</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-lg font-semibold text-white mb-4">
              {editingId ? "Edit Memory" : "Add New Memory"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Key</label>
                <input
                  type="text"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-white"
                  placeholder="e.g., user_prefers_dark_mode"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Value</label>
                <textarea
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-white h-24"
                  placeholder="The value to remember..."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as any })}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-white"
                  >
                    <option value="custom">Custom</option>
                    <option value="preference">Preference</option>
                    <option value="fact">Fact</option>
                    <option value="project">Project</option>
                    <option value="context">Context</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[var(--color-text-secondary)] mb-1">Importance (1-10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.importance}
                    onChange={(e) => setForm({ ...form, importance: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90"
                >
                  {editingId ? "Update" : "Add"} Memory
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 bg-[var(--color-surface)] text-white rounded-lg hover:bg-[var(--color-border)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-8 text-[var(--color-text-secondary)]">Loading...</div>
        ) : filteredMemories.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-text-secondary)]">
            {search ? "No memories match your search" : "No memories yet. Add one!"}
          </div>
        ) : (
          filteredMemories.map((memory) => (
            <div
              key={memory.id}
              className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${categoryColors[memory.category]}`}>
                      {memory.category}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      Importance: {memory.importance}
                    </span>
                    {memory.source && (
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        ({memory.source})
                      </span>
                    )}
                  </div>
                  <div className="text-white font-medium">{memory.key}</div>
                  <div className="text-[var(--color-text-secondary)] text-sm mt-1 whitespace-pre-wrap">
                    {memory.value}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleEdit(memory)}
                    className="px-3 py-1 text-sm text-[var(--color-text-secondary)] hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(memory.id)}
                    className="px-3 py-1 text-sm text-red-400 hover:text-red-300"
                  >
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
