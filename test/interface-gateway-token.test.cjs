const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

test("interfacesModel.create generates gateway_token and decrypts it", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "overseer-db-"));
  process.env.DATABASE_PATH = join(tmp, "overseer.db");
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key";

  const { initializeSchema } = await import("../src/database/db");
  initializeSchema();

  const { db } = await import("../src/database/db");
  // Seed a user so interfaces foreign keys pass.
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(
    1,
    "admin",
    "x",
    "admin",
  );

  const { interfacesModel } = await import("../src/database/models/interfaces");

  const created = interfacesModel.create({
    type: "telegram",
    name: "Test Telegram",
    owner_user_id: 1,
    config: { bot_token: "123:abc" },
    allowed_users: [],
    is_active: true,
  });

  const cfg = interfacesModel.getDecryptedConfig(created.id);
  assert.ok(cfg, "should have config");
  assert.equal(typeof cfg.gateway_token, "string");
  assert.ok(cfg.gateway_token.length >= 24, "gateway_token should be present");
});
