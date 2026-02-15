const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("spawnSubAgent uses tool-context agentSessionId as parent_session_id (FK-safe)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "overseer-db-"));
  const dbPath = join(tmp, "overseer.db");
  process.env.DATABASE_PATH = dbPath;

  const { db, closeDatabase } = await import("../src/database/db.ts");
  const { withToolContext } = await import("../src/lib/tool-context.ts");
  const { spawnSubAgent } = await import("../src/agent/tools/subagent-tool.ts");

  try {
    // Minimal seed: an agent_sessions row must exist for FK to pass.
    const userRes = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("testuser", "x", "admin");
    const ownerUserId = Number(userRes.lastInsertRowid);

    const ifaceRes = db
      .prepare(
        "INSERT INTO interfaces (owner_user_id, type, name, config, is_active) VALUES (?, ?, ?, ?, 1)",
      )
      .run(ownerUserId, "web", "web", "{}");
    const interfaceId = Number(ifaceRes.lastInsertRowid);

    const convRes = db
      .prepare(
        "INSERT INTO conversations (owner_user_id, interface_id, interface_type, external_chat_id, external_user_id, external_username, title) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(ownerUserId, interfaceId, "web", "web-test", String(ownerUserId), "testuser", "Test");
    const conversationId = Number(convRes.lastInsertRowid);

    const sessionId = `conversation:${conversationId}`;
    db.prepare(
      `INSERT INTO agent_sessions (
        session_id, owner_user_id, conversation_id, interface_type, interface_id, external_user_id, external_chat_id,
        messages, summaries, state, total_tokens, input_tokens, output_tokens, token_limit,
        last_active_at, created_at, is_active, message_count, tool_calls_count, error_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', 0, 0, 0, 4000, ?, ?, 1, 0, 0, 0, '{}')`,
    ).run(
      sessionId,
      ownerUserId,
      conversationId,
      "web",
      interfaceId,
      String(ownerUserId),
      "web-test",
      Date.now(),
      Date.now(),
    );

    const result = await withToolContext(
      {
        sandboxRoot: join(tmp, "userfs"),
        allowSystem: false,
        actor: { kind: "web", id: String(ownerUserId) },
        conversationId,
        agentSessionId: sessionId,
        interface: { type: "web", id: interfaceId, externalChatId: "web-test", externalUserId: String(ownerUserId) },
      },
      () =>
        spawnSubAgent.execute({
          task: "Just create a subagent record",
          mode: "background",
        }),
    );

    assert.ok(result.sub_agent_id, "spawnSubAgent should return sub_agent_id even if it cannot execute");

    const row = db
      .prepare("SELECT parent_session_id FROM sub_agents WHERE sub_agent_id = ?")
      .get(result.sub_agent_id);
    assert.equal(row.parent_session_id, sessionId);
  } finally {
    try {
      closeDatabase();
    } catch {}
    await rm(tmp, { recursive: true, force: true });
  }
});
