/**
 * Super Memory System
 * 
 * Long-term memory that persists across ALL conversations.
 * The agent automatically remembers important things about the user,
 * their preferences, projects, and context.
 * 
 * This is NOT the same as conversation context - this is persistent
 * knowledge that carries between separate conversations.
 */

import { db } from "../database/db";
import { createLogger } from "../lib/logger";
import { generateText, type LanguageModel } from "ai";
import { getDefaultModel } from "./providers";

const logger = createLogger("super-memory");

export interface MemoryEntry {
  id: number;
  key: string;
  value: string;
  category: "preference" | "fact" | "project" | "context" | "custom";
  importance: number;
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  relevance: number;
}

/**
 * Create a new memory entry
 */
export function createMemory(
  key: string,
  value: string,
  category: MemoryEntry["category"] = "custom",
  importance: number = 5,
  source?: string,
): MemoryEntry {
  const stmt = db.prepare(`
    INSERT INTO memory (key, value, category, importance, source)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(key, value, category, importance, source || null);

  logger.info("Memory created", { key, category, importance });

  return getMemoryById(result.lastInsertRowid as number)!;
}

/**
 * Get memory by ID
 */
export function getMemoryById(id: number): MemoryEntry | undefined {
  const stmt = db.prepare("SELECT * FROM memory WHERE id = ?");
  return stmt.get(id) as MemoryEntry | undefined;
}

/**
 * Get all memories, optionally filtered by category
 */
export function getAllMemories(category?: MemoryEntry["category"]): MemoryEntry[] {
  if (category) {
    const stmt = db.prepare(
      "SELECT * FROM memory WHERE category = ? ORDER BY importance DESC, updated_at DESC"
    );
    return stmt.all(category) as MemoryEntry[];
  }

  const stmt = db.prepare(
    "SELECT * FROM memory ORDER BY importance DESC, updated_at DESC"
  );
  return stmt.all() as MemoryEntry[];
}

/**
 * Search memories by keyword
 */
export function searchMemories(query: string): MemorySearchResult[] {
  const stmt = db.prepare(`
    SELECT * FROM memory 
    WHERE key LIKE ? OR value LIKE ?
    ORDER BY importance DESC
  `);

  const searchTerm = `%${query}%`;
  const results = stmt.all(searchTerm, searchTerm) as MemoryEntry[];

  return results.map((entry) => ({
    entry,
    relevance: calculateRelevance(entry, query),
  }));
}

/**
 * Calculate relevance score for a memory entry
 */
function calculateRelevance(entry: MemoryEntry, query: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerKey = entry.key.toLowerCase();
  const lowerValue = entry.value.toLowerCase();

  let score = 0;

  if (lowerKey.includes(lowerQuery)) score += 10;
  if (lowerValue.includes(lowerQuery)) score += 5;
  if (lowerKey === lowerQuery) score += 20;
  if (entry.importance > 7) score += 3;

  return score;
}

/**
 * Update a memory entry
 */
export function updateMemory(
  id: number,
  updates: {
    key?: string;
    value?: string;
    category?: MemoryEntry["category"];
    importance?: number;
  },
): MemoryEntry | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.key !== undefined) {
    fields.push("key = ?");
    values.push(updates.key);
  }
  if (updates.value !== undefined) {
    fields.push("value = ?");
    values.push(updates.value);
  }
  if (updates.category !== undefined) {
    fields.push("category = ?");
    values.push(updates.category);
  }
  if (updates.importance !== undefined) {
    fields.push("importance = ?");
    values.push(updates.importance);
  }

  if (fields.length === 0) {
    return getMemoryById(id);
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  db.prepare(`UPDATE memory SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  return getMemoryById(id);
}

/**
 * Delete a memory entry
 */
export function deleteMemory(id: number): boolean {
  const stmt = db.prepare("DELETE FROM memory WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Get memories formatted for the system prompt
 */
export function getMemoriesForPrompt(limit: number = 20): string {
  const memories = getAllMemories().slice(0, limit);

  if (memories.length === 0) {
    return "";
  }

  const sections: string[] = [];

  const grouped = memories.reduce(
    (acc, mem) => {
      if (!acc[mem.category]) acc[mem.category] = [];
      acc[mem.category].push(mem);
      return acc;
    },
    {} as Record<string, MemoryEntry[]>,
  );

  for (const [category, entries] of Object.entries(grouped)) {
    sections.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    for (const entry of entries) {
      sections.push(`- **${entry.key}**: ${entry.value}`);
    }
    sections.push("");
  }

  return `
---

## Long-Term Memory (Remember These)

${sections.join("\n")}
`;
}

/**
 * Auto-extract and save important information from conversation
 * This is called after conversations to learn new things
 */
export async function extractMemoriesFromConversation(
  conversationText: string,
  model?: LanguageModel,
): Promise<MemoryEntry[]> {
  const llm = model || getDefaultModel();
  if (!llm) {
    logger.warn("No model available for memory extraction");
    return [];
  }

  const prompt = `Analyze this conversation and extract important information that should be remembered long-term.

Extract:
- User preferences (how they like things done, communication style, etc.)
- Important facts about the user or their projects
- Project context and goals
- Any specific instructions or requirements they gave

Return as a JSON array with fields: key, value, category (preference/fact/project/context), importance (1-10)

Only return things worth remembering. Don't extract trivial stuff.

Conversation:
${conversationText.slice(-4000)}`;

  try {
    const result = await generateText({
      model: llm,
      prompt,
      maxOutputTokens: 2000,
    });

    const text = result.text.trim();

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }

    const items = JSON.parse(match[0]) as Array<{
      key: string;
      value: string;
      category: MemoryEntry["category"];
      importance: number;
    }>;

    const created: MemoryEntry[] = [];

    for (const item of items) {
      const existing = searchMemories(item.key);
      if (existing.length > 0 && existing[0].entry.key.toLowerCase() === item.key.toLowerCase()) {
        updateMemory(existing[0].entry.id, {
          value: item.value,
          importance: item.importance,
        });
      } else {
        const created_entry = createMemory(
          item.key,
          item.value,
          item.category,
          item.importance,
          "auto-extracted",
        );
        created.push(created_entry);
      }
    }

    if (created.length > 0) {
      logger.info("Auto-extracted memories", { count: created.length });
    }

    return created;
  } catch (error) {
    logger.error("Failed to extract memories", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get memory statistics
 */
export function getMemoryStats(): {
  total: number;
  byCategory: Record<string, number>;
  avgImportance: number;
} {
  const memories = getAllMemories();

  const byCategory: Record<string, number> = {};
  let totalImportance = 0;

  for (const mem of memories) {
    byCategory[mem.category] = (byCategory[mem.category] || 0) + 1;
    totalImportance += mem.importance;
  }

  return {
    total: memories.length,
    byCategory,
    avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
  };
}
