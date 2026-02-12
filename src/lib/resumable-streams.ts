import { db } from "@/database";
import { createLogger } from "@/lib/logger";

const logger = createLogger("resumable-streams");

type StreamStatus = "active" | "completed" | "error";

interface StreamRow {
  stream_id: string;
  conversation_id: number | null;
  status: StreamStatus;
  created_at: number;
  updated_at: number;
}

interface StreamEventRow {
  stream_id: string;
  seq: number;
  event: string;
  created_at: number;
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_streams (
      stream_id TEXT PRIMARY KEY,
      conversation_id INTEGER,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_stream_events (
      stream_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (stream_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_stream_events_stream
      ON agent_stream_events(stream_id, seq);
  `);
}

ensureSchema();

function nowMs() {
  return Date.now();
}

export const resumableStreams = {
  create(streamId: string, conversationId?: number) {
    const now = nowMs();
    db.prepare(
      `INSERT INTO agent_streams (stream_id, conversation_id, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)
       ON CONFLICT(stream_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         status = 'active',
         updated_at = excluded.updated_at`,
    ).run(streamId, conversationId ?? null, now, now);
  },

  appendEvent(streamId: string, event: unknown) {
    const next = this.getLastSeq(streamId) + 1;
    db.prepare(
      `INSERT INTO agent_stream_events (stream_id, seq, event, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(streamId, next, JSON.stringify(event), nowMs());

    db.prepare(
      "UPDATE agent_streams SET updated_at = ? WHERE stream_id = ?",
    ).run(nowMs(), streamId);
    return next;
  },

  getLastSeq(streamId: string) {
    const row = db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM agent_stream_events WHERE stream_id = ?",
      )
      .get(streamId) as { maxSeq: number };
    return row.maxSeq || 0;
  },

  getFrom(streamId: string, fromSeq: number) {
    const rows = db
      .prepare(
        `SELECT stream_id, seq, event, created_at
         FROM agent_stream_events
         WHERE stream_id = ? AND seq > ?
         ORDER BY seq ASC`,
      )
      .all(streamId, fromSeq) as StreamEventRow[];

    return rows.map((row) => {
      try {
        return {
          seq: row.seq,
          event: JSON.parse(row.event) as unknown,
          createdAt: row.created_at,
        };
      } catch {
        return {
          seq: row.seq,
          event: { type: "error", error: "Failed to parse stream event" },
          createdAt: row.created_at,
        };
      }
    });
  },

  complete(streamId: string, status: StreamStatus = "completed") {
    db.prepare(
      "UPDATE agent_streams SET status = ?, updated_at = ? WHERE stream_id = ?",
    ).run(status, nowMs(), streamId);
  },

  getStatus(streamId: string) {
    const row = db
      .prepare(
        `SELECT stream_id, conversation_id, status, created_at, updated_at
         FROM agent_streams
         WHERE stream_id = ?`,
      )
      .get(streamId) as StreamRow | undefined;
    return row ?? null;
  },

  cleanupOlderThan(ms: number) {
    const cutoff = nowMs() - ms;
    const stale = db
      .prepare("SELECT stream_id FROM agent_streams WHERE updated_at < ?")
      .all(cutoff) as Array<{ stream_id: string }>;

    for (const row of stale) {
      db.prepare("DELETE FROM agent_stream_events WHERE stream_id = ?").run(
        row.stream_id,
      );
      db.prepare("DELETE FROM agent_streams WHERE stream_id = ?").run(
        row.stream_id,
      );
    }

    if (stale.length > 0) {
      logger.info("Cleaned stale resumable streams", { deleted: stale.length });
    }

    return stale.length;
  },
};
