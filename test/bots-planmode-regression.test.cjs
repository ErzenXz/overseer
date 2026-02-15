const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

const root = join(__dirname, "..");

async function fileContains(rel, needle) {
  const p = join(root, rel);
  const s = await readFile(p, "utf8");
  return s.includes(needle);
}

test("bots do not force planMode true", async () => {
  const files = [
    "src/bot/index.ts",
    "src/bot/discord.ts",
    "src/bot/slack.ts",
    "src/bot/whatsapp.ts",
    "src/bot/matrix.ts",
  ];

  for (const f of files) {
    const has = await fileContains(f, "planMode: true");
    assert.equal(has, false, `${f} should not contain planMode: true`);
  }
});

test("telegram bot does not send placeholder ellipsis message", async () => {
  const has = await fileContains("src/bot/index.ts", 'ctx.reply("…")');
  assert.equal(has, false, "telegram should not send ctx.reply(\"…\")");
});

