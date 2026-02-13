import { db } from "../db";

export interface ConversationSummary {
  conversation_id: number;
  owner_user_id: number;
  summary: string;
  last_message_id: number;
  updated_at: string;
}

export const conversationSummariesModel = {
  get(conversationId: number): ConversationSummary | undefined {
    return db
      .prepare("SELECT * FROM conversation_summaries WHERE conversation_id = ?")
      .get(conversationId) as ConversationSummary | undefined;
  },

  upsert(input: {
    conversation_id: number;
    owner_user_id: number;
    summary: string;
    last_message_id: number;
  }): void {
    db.prepare(
      `
      INSERT INTO conversation_summaries (conversation_id, owner_user_id, summary, last_message_id, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(conversation_id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        summary = excluded.summary,
        last_message_id = excluded.last_message_id,
        updated_at = CURRENT_TIMESTAMP
    `,
    ).run(
      input.conversation_id,
      input.owner_user_id,
      input.summary,
      input.last_message_id,
    );
  },

  clear(conversationId: number): void {
    db.prepare("DELETE FROM conversation_summaries WHERE conversation_id = ?").run(
      conversationId,
    );
  },
};

