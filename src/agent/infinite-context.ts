/**
 * Infinite Context Manager
 * 
 * Automatically summarizes old conversation history to enable
 * infinitely long chats without hitting context limits.
 * 
 * How it works:
 * 1. Track conversation messages and their importance
 * 2. When context grows too large, summarize the oldest messages
 * 3. Store summaries as special "context marker" messages
 * 4. The agent receives summary + recent messages
 */

import { generateText, type LanguageModel } from "ai";
import { getDefaultModel } from "./providers";
import { messagesModel } from "../database/index";
import { createLogger } from "../lib/logger";

const logger = createLogger("infinite-context");

// Configuration
const MAX_MESSAGES_BEFORE_SUMMARY = 20;
const MIN_MESSAGES_TO_SUMMARY = 10;
const SUMMARY_MAX_TOKENS = 2000;

// Store context summaries in memory (could be moved to DB for persistence)
interface ContextSummary {
  conversationId: number;
  summary: string;
  messageCount: number;
  createdAt: Date;
  lastUsedAt: Date;
}

const contextSummaries = new Map<number, ContextSummary>();

/**
 * Check if a conversation needs summarization
 */
export function needsSummarization(conversationId: number): boolean {
  const count = messagesModel.count();
  if (count < MIN_MESSAGES_TO_SUMMARY) return false;
  
  // Get message count for this conversation
  const messages = messagesModel.findByConversation(conversationId, 1000);
  return messages.length >= MAX_MESSAGES_BEFORE_SUMMARY;
}

/**
 * Generate a summary of old messages
 */
export async function summarizeOldMessages(
  conversationId: number,
  model?: LanguageModel
): Promise<string | null> {
  const llm = model || getDefaultModel();
  if (!llm) {
    logger.warn("No model available for summarization");
    return null;
  }

  // Get all messages for this conversation
  const allMessages = messagesModel.findByConversation(conversationId, 1000);
  
  if (allMessages.length < MIN_MESSAGES_TO_SUMMARY) {
    return null;
  }

  // Keep the most recent messages, summarize the rest
  const recentCount = 10;
  const toSummarize = allMessages.slice(0, allMessages.length - recentCount);
  const recentMessages = allMessages.slice(allMessages.length - recentCount);

  if (toSummarize.length < 5) {
    return null;
  }

  // Build conversation for summarization
  const conversationText = toSummarize
    .map((m: { role: string; content: string }) => `${m.role}: ${m.content.substring(0, 500)}`)
    .join("\n\n");

  logger.info("Generating context summary", {
    conversationId,
    messagesSummarized: toSummarize.length,
    messagesKept: recentMessages.length,
  });

  try {
    const summaryPrompt = `Summarize this conversation concisely but completely. Include:
- Key topics discussed
- Important decisions made
- Tasks completed or in progress
- Any constraints or preferences mentioned

Keep the summary under 500 words. Use bullet points for clarity.

Conversation to summarize:
${conversationText}`;

    const result = await generateText({
      model: llm,
      prompt: summaryPrompt,
      maxOutputTokens: SUMMARY_MAX_TOKENS,
    });

    const summary = result.text.trim();

    // Store the summary
    const contextSummary: ContextSummary = {
      conversationId,
      summary,
      messageCount: toSummarize.length,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };

    contextSummaries.set(conversationId, contextSummary);

    // Delete the old messages that were summarized
    for (const msg of toSummarize) {
      messagesModel.delete(msg.id);
    }

    // Add a context marker message
    messagesModel.create({
      conversation_id: conversationId,
      role: "system",
      content: `[Context Summary - ${toSummarize.length} messages summarized]\n\n${summary}`,
      metadata: {
        is_summary: true,
        messages_count: toSummarize.length,
      },
    });

    logger.info("Context summarized successfully", {
      conversationId,
      summaryLength: summary.length,
    });

    return summary;
  } catch (error) {
    logger.error("Failed to generate summary", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get context summary for a conversation
 */
export function getContextSummary(conversationId: number): ContextSummary | null {
  const summary = contextSummaries.get(conversationId);
  if (summary) {
    summary.lastUsedAt = new Date();
  }
  return summary || null;
}

/**
 * Get formatted context summary for the system prompt
 */
export function getContextSummaryForPrompt(conversationId: number): string {
  const summary = getContextSummary(conversationId);
  
  if (!summary) {
    return "";
  }

  return `
---

## Previous Conversation Summary

This is a summary of earlier messages in this conversation:

${summary.summary}

---

*This summary covers ${summary.messageCount} messages from earlier in the conversation.
The recent messages follow below.*
`;
}

/**
 * Check if summarization is needed and trigger it
 */
export async function ensureContextIsSummarized(
  conversationId: number,
  model?: LanguageModel
): Promise<void> {
  if (needsSummarization(conversationId)) {
    await summarizeOldMessages(conversationId, model);
  }
}

/**
 * Clear context summary for a conversation
 */
export function clearContextSummary(conversationId: number): void {
  contextSummaries.delete(conversationId);
}

/**
 * Get stats about context summaries
 */
export function getContextStats(): {
  totalSummaries: number;
  conversations: Array<{
    conversationId: number;
    messageCount: number;
    createdAt: Date;
    lastUsedAt: Date;
  }>;
} {
  const conversations: Array<{
    conversationId: number;
    messageCount: number;
    createdAt: Date;
    lastUsedAt: Date;
  }> = [];

  for (const [id, summary] of contextSummaries) {
    conversations.push({
      conversationId: id,
      messageCount: summary.messageCount,
      createdAt: summary.createdAt,
      lastUsedAt: summary.lastUsedAt,
    });
  }

  return {
    totalSummaries: contextSummaries.size,
    conversations,
  };
}
