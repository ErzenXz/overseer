/**
 * Infinite Context (Persisted)
 *
 * Goal:
 * - Keep conversations "infinite" without deleting history.
 * - Persist an incremental summary in SQLite so restarts don't lose context.
 * - Keep the most recent messages as raw context; summarize older messages.
 */

import { generateText, type LanguageModel } from "ai";
import { getDefaultModel } from "./providers";
import { createLogger } from "../lib/logger";
import { db } from "../database/db";
import { conversationSummariesModel, conversationsModel, messagesModel } from "../database";

const logger = createLogger("infinite-context");

// Tuning knobs
const RECENT_WINDOW_MESSAGES = 12; // do not summarize the newest N messages
const MIN_MESSAGES_TO_SUMMARIZE = 20; // require at least this many older messages before summarizing
const MAX_MESSAGES_PER_RUN = 40; // cap cost per summarization run
const SUMMARY_MAX_OUTPUT_TOKENS = 1200;

export type SummaryGenerator = (input: {
  previousSummary: string;
  messages: Array<{ role: string; content: string }>;
}) => Promise<string>;

function defaultSummaryGenerator(model: LanguageModel): SummaryGenerator {
  return async ({ previousSummary, messages }) => {
    const chunkText = messages
      .map((m) => `${m.role}: ${String(m.content).slice(0, 800)}`)
      .join("\n\n");

    const prompt = `You are maintaining a running, factual summary of a conversation. Do not invent facts.

You will be given:
1) The previous running summary (may be empty)
2) A new chunk of older conversation messages to fold into the summary

Update the summary to include ONLY information present in the messages. Keep it compact, structured, and actionable.

Use this structure (omit sections that are empty):
- Who the user is / preferences
- Current goal
- Decisions made
- Open tasks
- Key technical facts (commands run, files changed, services, ports, tokens, ids)

Constraints:
- Max ~350 words.
- Prefer bullets.
- If messages conflict, note the conflict briefly.

Previous summary:
${previousSummary || "(empty)"}

New messages to incorporate:
${chunkText}`;

    const result = await generateText({
      model,
      prompt,
      maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
      maxRetries: 1,
    });

    return result.text.trim();
  };
}

function getOwnerUserId(conversationId: number, ownerUserId?: number): number | null {
  if (typeof ownerUserId === "number" && Number.isFinite(ownerUserId)) return ownerUserId;
  const conv = conversationsModel.findById(conversationId);
  if (!conv) return null;
  return conv.owner_user_id ?? null;
}

export function getContextSummaryForPrompt(conversationId: number): string {
  const row = conversationSummariesModel.get(conversationId);
  if (!row || !row.summary.trim()) return "";

  return `
---

## Previous Conversation Summary (Persisted)

${row.summary.trim()}
`;
}

export async function ensureContextIsSummarized(
  conversationId: number,
  ownerUserId?: number,
  model?: LanguageModel,
  generator?: SummaryGenerator,
): Promise<void> {
  const actualOwner = getOwnerUserId(conversationId, ownerUserId);
  if (!actualOwner) return;

  // If a generator is provided (tests), we can run without a real LLM provider.
  let gen: SummaryGenerator | undefined = generator;
  if (!gen) {
    const llm = model || getDefaultModel();
    if (!llm) {
      // No model configured; skip silently.
      return;
    }
    gen = defaultSummaryGenerator(llm);
  }

  const existing = conversationSummariesModel.get(conversationId);
  const lastMessageId = existing?.last_message_id ?? 0;
  const previousSummary = existing?.summary ?? "";

  // Fetch messages since last summarized.
  // We never delete messages. Instead, we only summarize older messages, leaving a recent window raw.
  const allSince = messagesModel
    .findByConversation(conversationId, 2000)
    .filter((m) => m.id > lastMessageId);

  if (allSince.length <= RECENT_WINDOW_MESSAGES + MIN_MESSAGES_TO_SUMMARIZE) {
    return;
  }

  const older = allSince.slice(0, Math.max(0, allSince.length - RECENT_WINDOW_MESSAGES));
  if (older.length < MIN_MESSAGES_TO_SUMMARIZE) return;

  const chunk = older.slice(0, Math.min(MAX_MESSAGES_PER_RUN, older.length));
  const newLastMessageId = chunk[chunk.length - 1]?.id;
  if (!newLastMessageId) return;

  const messagesForSummary = chunk
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  try {
    logger.info("Updating persisted conversation summary", {
      conversationId,
      ownerUserId: actualOwner,
      previousSummaryLen: previousSummary.length,
      chunkCount: messagesForSummary.length,
      fromMessageId: lastMessageId,
      toMessageId: newLastMessageId,
    });

    const nextSummary = await gen({
      previousSummary,
      messages: messagesForSummary,
    });

    if (!nextSummary.trim()) return;

    conversationSummariesModel.upsert({
      conversation_id: conversationId,
      owner_user_id: actualOwner,
      summary: nextSummary,
      last_message_id: newLastMessageId,
    });
  } catch (error) {
    logger.warn("Failed to update conversation summary", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearContextSummary(conversationId: number): void {
  conversationSummariesModel.clear(conversationId);
}

export function getContextStats(ownerUserId?: number): {
  totalSummaries: number;
  conversations: Array<{
    conversationId: number;
    ownerUserId: number;
    lastMessageId: number;
    updatedAt: string;
    summaryLength: number;
  }>;
} {
  try {
    const totalSummaries =
      typeof ownerUserId === "number"
        ? (db
            .prepare(
              "SELECT COUNT(*) as count FROM conversation_summaries WHERE owner_user_id = ?",
            )
            .get(ownerUserId) as { count: number }).count
        : (db
            .prepare("SELECT COUNT(*) as count FROM conversation_summaries")
            .get() as { count: number }).count;

    const rows =
      typeof ownerUserId === "number"
        ? (db
            .prepare(
              `SELECT conversation_id, owner_user_id, last_message_id, updated_at, LENGTH(summary) as summary_length
               FROM conversation_summaries
               WHERE owner_user_id = ?
               ORDER BY updated_at DESC
               LIMIT 50`,
            )
            .all(ownerUserId) as any[])
        : (db
            .prepare(
              `SELECT conversation_id, owner_user_id, last_message_id, updated_at, LENGTH(summary) as summary_length
               FROM conversation_summaries
               ORDER BY updated_at DESC
               LIMIT 50`,
            )
            .all() as any[]);

    return {
      totalSummaries,
      conversations: rows.map((r) => ({
        conversationId: Number(r.conversation_id),
        ownerUserId: Number(r.owner_user_id),
        lastMessageId: Number(r.last_message_id),
        updatedAt: String(r.updated_at),
        summaryLength: Number(r.summary_length ?? 0),
      })),
    };
  } catch {
    return { totalSummaries: 0, conversations: [] };
  }
}
