const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("syncBuiltinSkills loads built-in skills including document-reader", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "overseer-db-"));
  const dbPath = join(tmp, "overseer.db");
  process.env.DATABASE_PATH = dbPath;

  const { db, closeDatabase } = await import("../src/database/db.ts");
  const { withToolContext } = await import("../src/lib/tool-context.ts");
  const { syncBuiltinSkills, findBySkillId } = await import(
    "../src/agent/skills/registry.ts",
  );

  try {
    const userRes = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("testuser", "x", "admin");
    const ownerUserId = Number(userRes.lastInsertRowid);

    await withToolContext(
      { actor: { kind: "web", id: String(ownerUserId) } },
      async () => {
        syncBuiltinSkills();
      },
    );

    const doc = findBySkillId("document-reader");
    assert.ok(doc, "document-reader should be synced");
    assert.equal(doc.is_builtin, 1);
    assert.equal(doc.is_active, 1);
  } finally {
    try {
      closeDatabase();
    } catch {}
    await rm(tmp, { recursive: true, force: true });
  }
});

