const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("infinite context: persisted summary updates without deleting history", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "overseer-db-"));
  const dbPath = join(tmp, "overseer.db");

  // IMPORTANT: db.ts reads DATABASE_PATH at import time.
  process.env.DATABASE_PATH = dbPath;

  const { db, closeDatabase } = await import("../src/database/db.ts");
  const {
    conversationsModel,
    messagesModel,
    conversationSummariesModel,
  } = await import("../src/database/index.ts");
  const { ensureContextIsSummarized } = await import(
    "../src/agent/infinite-context.ts",
  );

  try {
    const userRes = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("testuser", "x", "admin");
    const ownerUserId = Number(userRes.lastInsertRowid);
    assert.ok(Number.isFinite(ownerUserId) && ownerUserId > 0);

    const conv = conversationsModel.findOrCreate({
      owner_user_id: ownerUserId,
      interface_type: "web",
      external_chat_id: "web-test",
      external_user_id: "1",
      external_username: "testuser",
      title: "Test",
    });

    for (let i = 0; i < 60; i++) {
      messagesModel.create({
        conversation_id: conv.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `m${i}`,
      });
    }

    const before = messagesModel.findByConversation(conv.id, 5000).length;
    assert.equal(before, 60);

    await ensureContextIsSummarized(
      conv.id,
      ownerUserId,
      undefined,
      async ({ previousSummary, messages }) =>
        `prevLen=${previousSummary.length};chunk=${messages.length}`,
    );

    const after = messagesModel.findByConversation(conv.id, 5000).length;
    assert.equal(after, before, "messages must not be deleted");

    const summary = conversationSummariesModel.get(conv.id);
    assert.ok(summary, "conversation_summaries row should be created");
    assert.ok(summary.last_message_id > 0, "last_message_id should advance");
    assert.match(summary.summary, /chunk=/);
  } finally {
    try {
      closeDatabase();
    } catch {}
    await rm(tmp, { recursive: true, force: true });
  }
});

