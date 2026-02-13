/**
 * Agent Sessions Model
 * Enhanced session management with context tracking, token counting, and summarization
 */

import { db } from "../db";
import { createLogger } from "../../lib/logger";

const logger = createLogger("agent-sessions");

// =====================================================
// Types & Interfaces
// =====================================================

export interface SessionMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  text: string;
  messages_summarized: number;
  created_at: number;
  tokens: number;
}

export interface SessionState {
  preferences?: Record<string, unknown>;
  context?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}

export interface AgentSession {
  id: number;
  session_id: string;
  owner_user_id: number;
  conversation_id: number;
  interface_type: string;
  interface_id: number | null;
  external_user_id: string;
  external_chat_id: string;

  // Session data
  messages: SessionMessage[];
  summaries: SessionSummary[];
  state: SessionState;

  // Token tracking
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  token_limit: number;

  // Metadata
  last_active_at: number;
  created_at: number;
  expires_at: number | null;
  is_active: boolean;

  // Statistics
  message_count: number;
  tool_calls_count: number;
  error_count: number;

  metadata?: Record<string, unknown>;
}

export interface SessionInput {
  session_id?: string;
  owner_user_id?: number;
  conversation_id: number;
  interface_type: string;
  interface_id?: number;
  external_user_id: string;
  external_chat_id: string;
  token_limit?: number;
  expires_in_ms?: number;
  state?: SessionState;
  metadata?: Record<string, unknown>;
}

export interface SessionStats {
  total_sessions: number;
  active_sessions: number;
  total_messages: number;
  total_tokens: number;
  average_session_length: number;
  sessions_by_interface: Record<string, number>;
  // Additional properties expected by the UI
  active: number;
  busy: number;
  idle: number;
  error: number;
  total: number;
  total_cost: number;
}

// =====================================================
// Database Setup
// =====================================================

/**
 * Initialize agent_sessions table if it doesn't exist.
 *
 * NOTE: The canonical schema/migrations are owned by `src/database/db.ts` and
 * `src/database/schema-agents.sql`. This function is intentionally a no-op to
 * avoid runtime schema drift between multiple initializers.
 */
export function initializeAgentSessionsTable(): void {
  logger.debug("initializeAgentSessionsTable: schema is managed by db.ts");
}

// =====================================================
// Helper Functions
// =====================================================

/**
 * Parse JSON field safely
 */
function parseJSON<T>(value: string | null, defaultValue: T): T {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Map database row to AgentSession
 */
function mapRowToSession(row: Record<string, unknown>): AgentSession {
  return {
    id: row.id as number,
    session_id: row.session_id as string,
    owner_user_id: row.owner_user_id as number,
    conversation_id: row.conversation_id as number,
    interface_type: row.interface_type as string,
    interface_id:
      typeof row.interface_id === "number" ? (row.interface_id as number) : null,
    external_user_id: row.external_user_id as string,
    external_chat_id: row.external_chat_id as string,
    messages: parseJSON<SessionMessage[]>(row.messages as string | null, []),
    summaries: parseJSON<SessionSummary[]>(row.summaries as string | null, []),
    state: parseJSON<SessionState>(row.state as string | null, {}),
    total_tokens: row.total_tokens as number,
    input_tokens: row.input_tokens as number,
    output_tokens: row.output_tokens as number,
    token_limit: row.token_limit as number,
    last_active_at: row.last_active_at as number,
    created_at: row.created_at as number,
    expires_at: row.expires_at as number | null,
    is_active: Boolean(row.is_active),
    message_count: row.message_count as number,
    tool_calls_count: row.tool_calls_count as number,
    error_count: row.error_count as number,
    metadata: parseJSON<Record<string, unknown>>(
      row.metadata as string | null,
      {},
    ),
  };
}

// =====================================================
// Model Functions
// =====================================================

export const agentSessionsModel = {
  /**
   * Find session by ID
   */
  findById(id: number): AgentSession | undefined {
    try {
      const row = db
        .prepare("SELECT * FROM agent_sessions WHERE id = ?")
        .get(id);

      return row ? mapRowToSession(row as Record<string, unknown>) : undefined;
    } catch (error) {
      logger.error("Failed to find session by ID", { id, error });
      return undefined;
    }
  },

  /**
   * Find session by canonical session_id.
   */
  findBySessionId(sessionId: string): AgentSession | undefined {
    try {
      const row = db
        .prepare("SELECT * FROM agent_sessions WHERE session_id = ?")
        .get(sessionId);
      return row ? mapRowToSession(row as Record<string, unknown>) : undefined;
    } catch (error) {
      logger.error("Failed to find session by session_id", { sessionId, error });
      return undefined;
    }
  },

  /**
   * Find session by conversation ID
   */
  findByConversation(conversationId: number): AgentSession | undefined {
    try {
      const row = db
        .prepare(
          `
          SELECT * FROM agent_sessions 
          WHERE conversation_id = ? AND is_active = 1
          ORDER BY last_active_at DESC
          LIMIT 1
        `,
        )
        .get(conversationId);

      return row ? mapRowToSession(row as Record<string, unknown>) : undefined;
    } catch (error) {
      logger.error("Failed to find session by conversation", {
        conversationId,
        error,
      });
      return undefined;
    }
  },

  /**
   * Find or create session
   */
  findOrCreate(input: SessionInput): AgentSession {
    try {
      const now = Date.now();
      const expiresAt = input.expires_in_ms ? now + input.expires_in_ms : null;

      const sessionId =
        input.session_id || `conversation:${input.conversation_id}`;

      // Determine ownership/interface from input or the conversation row.
      const conv = db
        .prepare("SELECT owner_user_id, interface_id FROM conversations WHERE id = ?")
        .get(input.conversation_id) as
        | { owner_user_id: number; interface_id: number | null }
        | undefined;
      const ownerUserId = input.owner_user_id ?? conv?.owner_user_id ?? 1;
      const interfaceId =
        typeof input.interface_id === "number"
          ? input.interface_id
          : conv?.interface_id ?? null;

      const existing = this.findBySessionId(sessionId);
      if (existing) {
        // If expired, reset the session state/messages instead of creating a new row (session_id is UNIQUE).
        if (existing.expires_at && Date.now() > existing.expires_at) {
          db.prepare(
            `
            UPDATE agent_sessions
            SET owner_user_id = ?,
                conversation_id = ?,
                interface_type = ?,
                interface_id = ?,
                external_user_id = ?,
                external_chat_id = ?,
                messages = '[]',
                summaries = '[]',
                state = ?,
                total_tokens = 0,
                input_tokens = 0,
                output_tokens = 0,
                token_limit = ?,
                last_active_at = ?,
                created_at = ?,
                expires_at = ?,
                is_active = 1,
                message_count = 0,
                tool_calls_count = 0,
                error_count = 0,
                metadata = ?
            WHERE session_id = ?
          `,
          ).run(
            ownerUserId,
            input.conversation_id,
            input.interface_type,
            interfaceId,
            input.external_user_id,
            input.external_chat_id,
            JSON.stringify(input.state || {}),
            input.token_limit || 4000,
            now,
            now,
            expiresAt,
            JSON.stringify(input.metadata || {}),
            sessionId,
          );
          return this.findBySessionId(sessionId)!;
        }

        db.prepare(
          `
          UPDATE agent_sessions
          SET owner_user_id = ?,
              interface_id = ?,
              last_active_at = ?,
              expires_at = COALESCE(?, expires_at),
              metadata = ?
          WHERE session_id = ?
        `,
        ).run(
          ownerUserId,
          interfaceId,
          now,
          expiresAt,
          JSON.stringify(input.metadata || existing.metadata || {}),
          sessionId,
        );

        return this.findBySessionId(sessionId)!;
      }

      const result = db
        .prepare(
          `
          INSERT INTO agent_sessions (
            session_id,
            owner_user_id,
            conversation_id,
            interface_type,
            interface_id,
            external_user_id,
            external_chat_id,
            messages,
            summaries,
            state,
            token_limit,
            last_active_at,
            created_at,
            expires_at,
            metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          sessionId,
          ownerUserId,
          input.conversation_id,
          input.interface_type,
          interfaceId,
          input.external_user_id,
          input.external_chat_id,
          JSON.stringify(input.state || {}),
          input.token_limit || 4000,
          now,
          now,
          expiresAt,
          JSON.stringify(input.metadata || {}),
        );

      return this.findById(result.lastInsertRowid as number)!;
    } catch (error) {
      logger.error("Failed to find or create session", { input, error });
      throw error;
    }
  },

  /**
   * Add message to session
   */
  addMessage(
    sessionId: number,
    message: SessionMessage,
  ): AgentSession | undefined {
    try {
      const session = this.findById(sessionId);
      if (!session) return undefined;

      // Add message
      const messages = [...session.messages, message];

      // Update tokens
      const messageTokens = message.tokens || 0;
      const totalTokens = session.total_tokens + messageTokens;

      const isUserMessage = message.role === "user";
      const inputTokens =
        session.input_tokens + (isUserMessage ? messageTokens : 0);
      const outputTokens =
        session.output_tokens + (isUserMessage ? 0 : messageTokens);

      // Update session
      db.prepare(
        `
        UPDATE agent_sessions 
        SET messages = ?,
            total_tokens = ?,
            input_tokens = ?,
            output_tokens = ?,
            message_count = message_count + 1,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(
        JSON.stringify(messages),
        totalTokens,
        inputTokens,
        outputTokens,
        Date.now(),
        sessionId,
      );

      return this.findById(sessionId);
    } catch (error) {
      logger.error("Failed to add message to session", { sessionId, error });
      return undefined;
    }
  },

  /**
   * Add summary to session
   */
  addSummary(
    sessionId: number,
    summary: SessionSummary,
  ): AgentSession | undefined {
    try {
      const session = this.findById(sessionId);
      if (!session) return undefined;

      const summaries = [...session.summaries, summary];

      db.prepare(
        `
        UPDATE agent_sessions 
        SET summaries = ?,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(JSON.stringify(summaries), Date.now(), sessionId);

      return this.findById(sessionId);
    } catch (error) {
      logger.error("Failed to add summary to session", { sessionId, error });
      return undefined;
    }
  },

  /**
   * Update session state
   */
  updateState(
    sessionId: number,
    state: Partial<SessionState>,
  ): AgentSession | undefined {
    try {
      const session = this.findById(sessionId);
      if (!session) return undefined;

      const newState = { ...session.state, ...state };

      db.prepare(
        `
        UPDATE agent_sessions 
        SET state = ?,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(JSON.stringify(newState), Date.now(), sessionId);

      return this.findById(sessionId);
    } catch (error) {
      logger.error("Failed to update session state", { sessionId, error });
      return undefined;
    }
  },

  /**
   * Clear messages from session (keeps summaries)
   */
  clearMessages(sessionId: number): AgentSession | undefined {
    try {
      db.prepare(
        `
        UPDATE agent_sessions 
        SET messages = '[]',
            total_tokens = 0,
            input_tokens = 0,
            output_tokens = 0,
            message_count = 0,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(Date.now(), sessionId);

      return this.findById(sessionId);
    } catch (error) {
      logger.error("Failed to clear messages from session", {
        sessionId,
        error,
      });
      return undefined;
    }
  },

  /**
   * Replace in-memory message window and token counters (used after summarization/compaction)
   */
  replaceMessagesAndTotals(
    sessionId: number,
    messages: SessionMessage[],
    totals: {
      total_tokens: number;
      input_tokens: number;
      output_tokens: number;
      message_count: number;
    },
  ): AgentSession | undefined {
    try {
      db.prepare(
        `
        UPDATE agent_sessions
        SET messages = ?,
            total_tokens = ?,
            input_tokens = ?,
            output_tokens = ?,
            message_count = ?,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(
        JSON.stringify(messages),
        totals.total_tokens,
        totals.input_tokens,
        totals.output_tokens,
        totals.message_count,
        Date.now(),
        sessionId,
      );

      return this.findById(sessionId);
    } catch (error) {
      logger.error("Failed to replace messages/totals", { sessionId, error });
      return undefined;
    }
  },

  /**
   * Increment tool calls counter
   */
  incrementToolCalls(sessionId: number): void {
    try {
      db.prepare(
        `
        UPDATE agent_sessions 
        SET tool_calls_count = tool_calls_count + 1,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(Date.now(), sessionId);
    } catch (error) {
      logger.error("Failed to increment tool calls", { sessionId, error });
    }
  },

  /**
   * Increment error counter
   */
  incrementErrors(sessionId: number): void {
    try {
      db.prepare(
        `
        UPDATE agent_sessions 
        SET error_count = error_count + 1,
            last_active_at = ?
        WHERE id = ?
      `,
      ).run(Date.now(), sessionId);
    } catch (error) {
      logger.error("Failed to increment errors", { sessionId, error });
    }
  },

  /**
   * Touch session (update last active time)
   */
  touch(sessionId: number): void {
    try {
      db.prepare(
        `
        UPDATE agent_sessions 
        SET last_active_at = ?
        WHERE id = ?
      `,
      ).run(Date.now(), sessionId);
    } catch (error) {
      logger.error("Failed to touch session", { sessionId, error });
    }
  },

  /**
   * Deactivate session
   */
  deactivate(sessionId: number): boolean {
    try {
      const result = db
        .prepare(
          `
        UPDATE agent_sessions 
        SET is_active = 0,
            last_active_at = ?
        WHERE id = ?
      `,
        )
        .run(Date.now(), sessionId);

      return result.changes > 0;
    } catch (error) {
      logger.error("Failed to deactivate session", { sessionId, error });
      return false;
    }
  },

  /**
   * Delete session
   */
  delete(sessionId: number): boolean {
    try {
      const result = db
        .prepare("DELETE FROM agent_sessions WHERE id = ?")
        .run(sessionId);
      return result.changes > 0;
    } catch (error) {
      logger.error("Failed to delete session", { sessionId, error });
      return false;
    }
  },

  /**
   * Get all active sessions
   */
  findAllActive(limit = 100): AgentSession[] {
    try {
      const rows = db
        .prepare(
          `
          SELECT * FROM agent_sessions 
          WHERE is_active = 1
          ORDER BY last_active_at DESC
          LIMIT ?
        `,
        )
        .all(limit);

      return rows.map((row) => mapRowToSession(row as Record<string, unknown>));
    } catch (error) {
      logger.error("Failed to find active sessions", { error });
      return [];
    }
  },

  /**
   * Cleanup expired sessions
   */
  cleanupExpired(): number {
    try {
      const now = Date.now();
      const result = db
        .prepare(
          `
        UPDATE agent_sessions 
        SET is_active = 0
        WHERE is_active = 1 
          AND expires_at IS NOT NULL 
          AND expires_at < ?
      `,
        )
        .run(now);

      if (result.changes > 0) {
        logger.info("Cleaned up expired sessions", { count: result.changes });
      }

      return result.changes;
    } catch (error) {
      logger.error("Failed to cleanup expired sessions", { error });
      return 0;
    }
  },

  /**
   * Cleanup inactive sessions (haven't been active for a long time)
   */
  cleanupInactive(inactiveThresholdMs: number = 24 * 60 * 60 * 1000): number {
    try {
      const cutoff = Date.now() - inactiveThresholdMs;
      const result = db
        .prepare(
          `
        UPDATE agent_sessions 
        SET is_active = 0
        WHERE is_active = 1 
          AND last_active_at < ?
      `,
        )
        .run(cutoff);

      if (result.changes > 0) {
        logger.info("Cleaned up inactive sessions", { count: result.changes });
      }

      return result.changes;
    } catch (error) {
      logger.error("Failed to cleanup inactive sessions", { error });
      return 0;
    }
  },

  /**
   * Find all active sessions (alias for findAllActive)
   */
  findActive(limit = 100): AgentSession[] {
    return this.findAllActive(limit);
  },

  /**
   * Get session statistics
   */
  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    try {
      const totalResult = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM agent_sessions
      `,
        )
        .get() as { count: number };

      const activeResult = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM agent_sessions WHERE is_active = 1
      `,
        )
        .get() as { count: number };

      const messagesResult = db
        .prepare(
          `
        SELECT SUM(message_count) as total FROM agent_sessions
      `,
        )
        .get() as { total: number | null };

      const tokensResult = db
        .prepare(
          `
        SELECT SUM(total_tokens) as total FROM agent_sessions
      `,
        )
        .get() as { total: number | null };

      const avgResult = db
        .prepare(
          `
        SELECT AVG(message_count) as avg FROM agent_sessions WHERE is_active = 1
      `,
        )
        .get() as { avg: number | null };

      const byInterfaceRows = db
        .prepare(
          `
        SELECT interface_type, COUNT(*) as count 
        FROM agent_sessions 
        WHERE is_active = 1 
        GROUP BY interface_type
      `,
        )
        .all() as { interface_type: string; count: number }[];

      const sessions_by_interface: Record<string, number> = {};
      for (const row of byInterfaceRows) {
        sessions_by_interface[row.interface_type] = row.count;
      }

      // Calculate derived stats for UI compatibility
      const active = activeResult.count;
      const total = totalResult.count;

      return {
        total_sessions: total,
        active_sessions: active,
        total_messages: messagesResult.total || 0,
        total_tokens: tokensResult.total || 0,
        average_session_length: avgResult.avg || 0,
        sessions_by_interface,
        // UI-compatible properties
        active,
        busy: 0, // Could be calculated from sessions with processing state
        idle: Math.max(0, active - 0), // For now, all active are considered idle
        error: 0, // Could be calculated from sessions with errors
        total,
        total_cost: 0, // TODO: Calculate based on token usage and provider pricing
      };
    } catch (error) {
      logger.error("Failed to get session stats", { error });
      return {
        total_sessions: 0,
        active_sessions: 0,
        total_messages: 0,
        total_tokens: 0,
        average_session_length: 0,
        sessions_by_interface: {},
        active: 0,
        busy: 0,
        idle: 0,
        error: 0,
        total: 0,
        total_cost: 0,
      };
    }
  },
};
