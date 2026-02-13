import { db, type Conversation, type Message } from "../db";

export interface ConversationInput {
  owner_user_id?: number;
  interface_id?: number;
  interface_type: string;
  external_chat_id: string;
  external_user_id: string;
  external_username?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageInput {
  conversation_id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: unknown[];
  tool_results?: unknown[];
  model_used?: string;
  input_tokens?: number;
  output_tokens?: number;
  metadata?: Record<string, unknown>;
}

export const conversationsModel = {
  // Find conversation by ID
  findById(id: number): Conversation | undefined {
    return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
      | Conversation
      | undefined;
  },

  // Find or create conversation by external IDs
  findOrCreate(input: ConversationInput): Conversation {
    const ownerUserId = input.owner_user_id ?? 1;
    const existing = db
      .prepare(
        `SELECT * FROM conversations 
         WHERE owner_user_id = ? AND interface_type = ? AND external_chat_id = ? AND external_user_id = ?`
      )
      .get(ownerUserId, input.interface_type, input.external_chat_id, input.external_user_id) as
      | Conversation
      | undefined;

    if (existing) {
      // Update username if provided
      if (input.external_username && input.external_username !== existing.external_username) {
        db.prepare(
          "UPDATE conversations SET external_username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(input.external_username, existing.id);
      }
      return this.findById(existing.id)!;
    }

    const result = db
      .prepare(
        `INSERT INTO conversations (owner_user_id, interface_id, interface_type, external_chat_id, external_user_id, external_username, title, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ownerUserId,
        input.interface_id || null,
        input.interface_type,
        input.external_chat_id,
        input.external_user_id,
        input.external_username || null,
        input.title || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      );

    return this.findById(result.lastInsertRowid as number)!;
  },

  // Get all conversations
  findAll(limit = 100, offset = 0, ownerUserId?: number): Conversation[] {
    if (typeof ownerUserId === "number") {
      return db
        .prepare(
          "SELECT * FROM conversations WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )
        .all(ownerUserId, limit, offset) as Conversation[];
    }
    return db
      .prepare(
        "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as Conversation[];
  },

  // Get conversations by interface type
  findByInterfaceType(type: string, limit = 100, ownerUserId?: number): Conversation[] {
    if (typeof ownerUserId === "number") {
      return db
        .prepare(
          "SELECT * FROM conversations WHERE owner_user_id = ? AND interface_type = ? ORDER BY updated_at DESC LIMIT ?"
        )
        .all(ownerUserId, type, limit) as Conversation[];
    }
    return db
      .prepare(
        "SELECT * FROM conversations WHERE interface_type = ? ORDER BY updated_at DESC LIMIT ?"
      )
      .all(type, limit) as Conversation[];
  },

  // Update conversation
  update(id: number, updates: Partial<ConversationInput>): Conversation | undefined {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }
    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length > 0) {
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      db.prepare(
        `UPDATE conversations SET ${fields.join(", ")} WHERE id = ?`
      ).run(...values);
    }

    return this.findById(id);
  },

  // Increment message count and tokens
  incrementStats(id: number, inputTokens = 0, outputTokens = 0): void {
    db.prepare(
      `UPDATE conversations 
       SET message_count = message_count + 1, 
           total_tokens = total_tokens + ?,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`
    ).run(inputTokens + outputTokens, id);
  },

  // Delete conversation
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return result.changes > 0;
  },

  // Clear all messages in conversation
  clearMessages(id: number): void {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    db.prepare(
      "UPDATE conversations SET message_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(id);
  },

  // Get conversation count
  count(ownerUserId?: number): number {
    if (typeof ownerUserId === "number") {
      const result = db
        .prepare("SELECT COUNT(*) as count FROM conversations WHERE owner_user_id = ?")
        .get(ownerUserId) as { count: number };
      return result.count;
    }
    const result = db
      .prepare("SELECT COUNT(*) as count FROM conversations")
      .get() as { count: number };
    return result.count;
  },
};

export const messagesModel = {
  // Find message by ID
  findById(id: number): Message | undefined {
    return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | Message
      | undefined;
  },

  // Get messages for conversation
  findByConversation(conversationId: number, limit = 50): Message[] {
    return db
      .prepare(
        `SELECT * FROM messages 
         WHERE conversation_id = ? 
         ORDER BY created_at ASC 
         LIMIT ?`
      )
      .all(conversationId, limit) as Message[];
  },

  // Get recent messages for context
  getRecentForContext(conversationId: number, limit = 20): Message[] {
    return db
      .prepare(
        `SELECT * FROM messages 
         WHERE conversation_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`
      )
      .all(conversationId, limit)
      .reverse() as Message[];
  },

  // Create message
  create(input: MessageInput): Message {
    const result = db
      .prepare(
        `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results, model_used, input_tokens, output_tokens, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.conversation_id,
        input.role,
        input.content,
        input.tool_calls ? JSON.stringify(input.tool_calls) : null,
        input.tool_results ? JSON.stringify(input.tool_results) : null,
        input.model_used || null,
        input.input_tokens || null,
        input.output_tokens || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      );

    // Update conversation stats
    conversationsModel.incrementStats(
      input.conversation_id,
      input.input_tokens || 0,
      input.output_tokens || 0
    );

    return this.findById(result.lastInsertRowid as number)!;
  },

  // Delete message
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    return result.changes > 0;
  },

  // Get message count
  count(): number {
    const result = db
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as { count: number };
    return result.count;
  },

  // Get total tokens used
  getTotalTokens(): number {
    const result = db
      .prepare(
        "SELECT COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as total FROM messages"
      )
      .get() as { total: number };
    return result.total;
  },
};
