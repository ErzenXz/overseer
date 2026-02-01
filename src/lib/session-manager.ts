/**
 * Session Manager
 * Core session management with in-memory caching, context building, and automatic summarization
 */

import {
  agentSessionsModel,
  type AgentSession,
  type SessionMessage,
  type SessionSummary,
  type SessionInput,
} from "../database/models/agent-sessions";
import { messagesModel } from "../database/models/conversations";
import { createLogger } from "./logger";

const logger = createLogger("session-manager");

// =====================================================
// Configuration
// =====================================================

const DEFAULT_TOKEN_LIMIT = 4000; // Default context window limit
const SUMMARIZE_THRESHOLD = 0.7; // Summarize when 70% of token limit reached
const SUMMARY_MAX_TOKENS = 500; // Max tokens for summary
const MIN_MESSAGES_TO_SUMMARIZE = 10; // Minimum messages before summarizing
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_SIZE = 1000; // Max sessions in memory cache

// =====================================================
// Token Estimation
// =====================================================

/**
 * Estimate tokens from text (roughly 4 characters per token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Simple estimation: ~4 characters per token
  // More accurate would use tiktoken, but this is sufficient
  return Math.ceil(text.length / 4);
}

/**
 * Calculate tokens for a message
 */
function calculateMessageTokens(message: SessionMessage): number {
  if (message.tokens) return message.tokens;
  
  let tokens = estimateTokens(message.content);
  
  // Add overhead for role and formatting
  tokens += 4; // ~4 tokens for role + formatting
  
  return tokens;
}

/**
 * Calculate total tokens for messages
 */
function calculateTotalTokens(messages: SessionMessage[]): number {
  return messages.reduce((sum, msg) => sum + calculateMessageTokens(msg), 0);
}

// =====================================================
// In-Memory Cache
// =====================================================

class SessionCache {
  private cache: Map<number, AgentSession>;
  private accessOrder: number[];

  constructor() {
    this.cache = new Map();
    this.accessOrder = [];
  }

  get(sessionId: number): AgentSession | undefined {
    const session = this.cache.get(sessionId);
    if (session) {
      // Update access order (LRU)
      this.accessOrder = this.accessOrder.filter(id => id !== sessionId);
      this.accessOrder.push(sessionId);
    }
    return session;
  }

  set(sessionId: number, session: AgentSession): void {
    this.cache.set(sessionId, session);
    this.accessOrder.push(sessionId);

    // Evict oldest if cache is full
    if (this.cache.size > CACHE_MAX_SIZE) {
      const oldestId = this.accessOrder.shift();
      if (oldestId !== undefined) {
        this.cache.delete(oldestId);
        logger.debug("Evicted session from cache", { sessionId: oldestId });
      }
    }
  }

  delete(sessionId: number): void {
    this.cache.delete(sessionId);
    this.accessOrder = this.accessOrder.filter(id => id !== sessionId);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  get size(): number {
    return this.cache.size;
  }
}

const sessionCache = new SessionCache();

// =====================================================
// Session Manager
// =====================================================

export class SessionManager {
  /**
   * Get or create a session
   */
  static getOrCreateSession(input: SessionInput): AgentSession {
    logger.debug("Getting or creating session", { 
      conversationId: input.conversation_id,
      interfaceType: input.interface_type 
    });

    // Set defaults
    const sessionInput: SessionInput = {
      ...input,
      token_limit: input.token_limit || DEFAULT_TOKEN_LIMIT,
      expires_in_ms: input.expires_in_ms || SESSION_EXPIRY_MS,
    };

    // Create or get from database
    const session = agentSessionsModel.findOrCreate(sessionInput);

    // Cache it
    sessionCache.set(session.id, session);

    return session;
  }

  /**
   * Get session by ID (checks cache first)
   */
  static getSession(sessionId: number): AgentSession | undefined {
    // Check cache first
    let session = sessionCache.get(sessionId);
    if (session) {
      logger.debug("Session found in cache", { sessionId });
      return session;
    }

    // Load from database
    session = agentSessionsModel.findById(sessionId);
    if (session) {
      sessionCache.set(sessionId, session);
    }

    return session;
  }

  /**
   * Add a message to the session
   */
  static addMessage(
    sessionId: number,
    role: SessionMessage["role"],
    content: string,
    metadata?: Record<string, unknown>
  ): AgentSession | undefined {
    const message: SessionMessage = {
      role,
      content,
      timestamp: Date.now(),
      tokens: estimateTokens(content),
      metadata,
    };

    logger.debug("Adding message to session", {
      sessionId,
      role,
      tokens: message.tokens,
      contentLength: content.length,
    });

    // Add to database
    const session = agentSessionsModel.addMessage(sessionId, message);
    if (!session) {
      logger.error("Failed to add message to session", { sessionId });
      return undefined;
    }

    // Update cache
    sessionCache.set(sessionId, session);

    // Check if we need to summarize
    this.checkAndSummarize(session);

    return session;
  }

  /**
   * Check if session needs summarization and do it
   */
  private static checkAndSummarize(session: AgentSession): void {
    const tokenUsage = session.total_tokens / session.token_limit;
    
    if (
      tokenUsage > SUMMARIZE_THRESHOLD &&
      session.messages.length >= MIN_MESSAGES_TO_SUMMARIZE
    ) {
      logger.info("Session approaching token limit, summarizing", {
        sessionId: session.id,
        totalTokens: session.total_tokens,
        tokenLimit: session.token_limit,
        messageCount: session.messages.length,
      });

      this.summarizeSession(session.id);
    }
  }

  /**
   * Summarize older messages in a session
   */
  static async summarizeSession(sessionId: number): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      logger.error("Session not found for summarization", { sessionId });
      return;
    }

    // Don't summarize if too few messages
    if (session.messages.length < MIN_MESSAGES_TO_SUMMARIZE) {
      logger.debug("Too few messages to summarize", { sessionId, count: session.messages.length });
      return;
    }

    // Keep the most recent ~30% of messages
    const keepCount = Math.ceil(session.messages.length * 0.3);
    const toSummarize = session.messages.slice(0, -keepCount);
    const toKeep = session.messages.slice(-keepCount);

    if (toSummarize.length === 0) {
      return;
    }

    // Build a simple summary
    const summaryText = this.buildSummary(toSummarize);
    const summaryTokens = estimateTokens(summaryText);

    const summary: SessionSummary = {
      text: summaryText,
      messages_summarized: toSummarize.length,
      created_at: Date.now(),
      tokens: summaryTokens,
    };

    logger.info("Created session summary", {
      sessionId,
      messagesSummarized: toSummarize.length,
      summaryTokens,
    });

    // Add summary to database
    agentSessionsModel.addSummary(sessionId, summary);

    // Clear old messages and keep only recent ones
    const updatedSession = agentSessionsModel.findById(sessionId);
    if (updatedSession) {
      updatedSession.messages = toKeep;
      
      // Recalculate tokens
      const newTotalTokens = 
        summary.tokens + 
        calculateTotalTokens(toKeep) +
        session.summaries.reduce((sum, s) => sum + s.tokens, 0);

      // Update session in database (would need a method for this)
      // For now, just update cache
      updatedSession.total_tokens = newTotalTokens;
      sessionCache.set(sessionId, updatedSession);
    }
  }

  /**
   * Build a simple text summary of messages
   */
  private static buildSummary(messages: SessionMessage[]): string {
    const lines: string[] = [];
    
    // Group messages by role
    let userMessages = 0;
    let assistantMessages = 0;
    const topics: string[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        userMessages++;
        // Extract potential topics (first few words)
        const words = msg.content.split(/\s+/).slice(0, 5).join(" ");
        if (words.length > 0) {
          topics.push(words);
        }
      } else if (msg.role === "assistant") {
        assistantMessages++;
      }
    }

    lines.push(`Previous conversation summary (${messages.length} messages):`);
    lines.push(`- User messages: ${userMessages}`);
    lines.push(`- Assistant messages: ${assistantMessages}`);
    
    if (topics.length > 0) {
      // Get unique topics (simple deduplication)
      const uniqueTopics = [...new Set(topics)].slice(0, 3);
      lines.push(`- Topics discussed: ${uniqueTopics.join(", ")}...`);
    }

    return lines.join("\n");
  }

  /**
   * Build context for AI (system prompt + summaries + recent messages)
   */
  static buildContext(sessionId: number, maxMessages = 20): {
    messages: Array<{ role: string; content: string }>;
    totalTokens: number;
    hasSummaries: boolean;
  } {
    const session = this.getSession(sessionId);
    if (!session) {
      return { messages: [], totalTokens: 0, hasSummaries: false };
    }

    const messages: Array<{ role: string; content: string }> = [];
    let totalTokens = 0;

    // Add summaries as system messages
    if (session.summaries.length > 0) {
      for (const summary of session.summaries) {
        messages.push({
          role: "system",
          content: summary.text,
        });
        totalTokens += summary.tokens;
      }
    }

    // Add recent messages (limited by maxMessages)
    const recentMessages = session.messages.slice(-maxMessages);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
      totalTokens += calculateMessageTokens(msg);
    }

    logger.debug("Built context", {
      sessionId,
      totalMessages: messages.length,
      summaries: session.summaries.length,
      totalTokens,
    });

    return {
      messages,
      totalTokens,
      hasSummaries: session.summaries.length > 0,
    };
  }

  /**
   * Clear session messages (keeps summaries and state)
   */
  static clearMessages(sessionId: number): AgentSession | undefined {
    logger.info("Clearing messages from session", { sessionId });
    
    const session = agentSessionsModel.clearMessages(sessionId);
    if (session) {
      sessionCache.set(sessionId, session);
    }
    
    return session;
  }

  /**
   * Update session state
   */
  static updateState(
    sessionId: number,
    state: Record<string, unknown>
  ): AgentSession | undefined {
    const session = agentSessionsModel.updateState(sessionId, state);
    if (session) {
      sessionCache.set(sessionId, session);
    }
    return session;
  }

  /**
   * Record a tool call
   */
  static recordToolCall(sessionId: number): void {
    agentSessionsModel.incrementToolCalls(sessionId);
    
    // Update cache if present
    const cached = sessionCache.get(sessionId);
    if (cached) {
      cached.tool_calls_count++;
      sessionCache.set(sessionId, cached);
    }
  }

  /**
   * Record an error
   */
  static recordError(sessionId: number): void {
    agentSessionsModel.incrementErrors(sessionId);
    
    // Update cache if present
    const cached = sessionCache.get(sessionId);
    if (cached) {
      cached.error_count++;
      sessionCache.set(sessionId, cached);
    }
  }

  /**
   * Deactivate a session
   */
  static deactivateSession(sessionId: number): boolean {
    logger.info("Deactivating session", { sessionId });
    
    const result = agentSessionsModel.deactivate(sessionId);
    sessionCache.delete(sessionId);
    
    return result;
  }

  /**
   * Get session statistics
   */
  static getStats() {
    return {
      ...agentSessionsModel.getStats(),
      cacheSize: sessionCache.size,
    };
  }

  /**
   * Cleanup expired and inactive sessions
   */
  static cleanup(): void {
    logger.debug("Running session cleanup");
    
    const expiredCount = agentSessionsModel.cleanupExpired();
    const inactiveCount = agentSessionsModel.cleanupInactive(SESSION_EXPIRY_MS);
    
    if (expiredCount > 0 || inactiveCount > 0) {
      logger.info("Session cleanup completed", {
        expiredCount,
        inactiveCount,
      });
    }

    // Clear cache for deactivated sessions
    sessionCache.clear();
  }
}

// =====================================================
// Automatic Cleanup
// =====================================================

// Run cleanup periodically
let cleanupInterval: NodeJS.Timeout | null = null;

export function startSessionCleanup(): void {
  if (cleanupInterval) {
    logger.warn("Session cleanup already running");
    return;
  }

  logger.info("Starting automatic session cleanup", {
    intervalMs: CLEANUP_INTERVAL_MS,
  });

  cleanupInterval = setInterval(() => {
    SessionManager.cleanup();
  }, CLEANUP_INTERVAL_MS);

  // Initial cleanup
  SessionManager.cleanup();
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Stopped automatic session cleanup");
  }
}

// Start cleanup on module load
startSessionCleanup();

// Cleanup on exit
process.on("exit", () => {
  stopSessionCleanup();
});
