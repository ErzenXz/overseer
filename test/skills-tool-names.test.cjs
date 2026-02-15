const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("skill tools expose bare names (and namespaced aliases) for model ergonomics", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "overseer-db-"));
  const dbPath = join(tmp, "overseer.db");
  process.env.DATABASE_PATH = dbPath;

  const { db, closeDatabase } = await import("../src/database/db.ts");
  const { withToolContext } = await import("../src/lib/tool-context.ts");
  const { syncBuiltinSkills, getAllActiveSkillTools } = await import(
    "../src/agent/skills/registry.ts",
  );

  try {
    const userRes = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run("testuser", "x", "admin");
    const ownerUserId = Number(userRes.lastInsertRowid);

    const tools = await withToolContext(
      { actor: { kind: "web", id: String(ownerUserId) } },
      async () => {
        syncBuiltinSkills();
        return getAllActiveSkillTools();
      },
    );

    assert.ok(tools.extract_pdf_text, "bare tool name should exist");
    assert.ok(
      tools["document-reader_extract_pdf_text"],
      "namespaced alias should exist",
    );
  } finally {
    try {
      closeDatabase();
    } catch {}
    await rm(tmp, { recursive: true, force: true });
  }
});

