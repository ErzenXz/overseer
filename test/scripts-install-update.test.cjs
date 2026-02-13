const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { resolve } = require("node:path");
const { mkdtemp, rm, mkdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");

const execFileAsync = promisify(execFile);

const repoRoot = resolve(process.cwd());
const installSh = resolve(repoRoot, "scripts", "install.sh");
const updateSh = resolve(repoRoot, "scripts", "update.sh");

async function run(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      ...opts,
      env: { ...process.env, ...(opts.env || {}) },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout: stdout ?? "", stderr: stderr ?? "" };
  } catch (e) {
    const err = e;
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout?.toString?.() ?? "",
      stderr: err.stderr?.toString?.() ?? String(err.message || err),
    };
  }
}

test("install.sh and update.sh parse in bash (bash -n)", async () => {
  {
    const res = await run("bash", ["-n", installSh]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
  }
  {
    const res = await run("bash", ["-n", updateSh]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
  }
});

test("install.sh supports --help and --dry-run", async () => {
  const help = await run("bash", [installSh, "--help"]);
  assert.equal(help.code, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Usage:/);

  const dry = await run("bash", [installSh, "--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr || dry.stdout);
  assert.match(dry.stdout, /DRY RUN/);
});

test("update.sh supports --help and --dry-run", async () => {
  const help = await run("bash", [updateSh, "--help"]);
  assert.equal(help.code, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Usage:/);

  const dry = await run("bash", [updateSh, "--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr || dry.stdout);
  assert.match(dry.stdout, /DRY RUN/);
});

test("scripts/postinstall.js works in a clean directory (creates data/ and .env)", async () => {
  const tmp = await mkdtemp(resolve(tmpdir(), "overseer-postinstall-"));
  try {
    await writeFile(resolve(tmp, ".env.example"), "PORT=3000\n", "utf8");
    await mkdir(resolve(tmp, "scripts"), { recursive: true });

    const postinstall = resolve(repoRoot, "scripts", "postinstall.js");
    const res = await run("node", [postinstall], { cwd: tmp });
    assert.equal(res.code, 0, res.stderr || res.stdout);

    const ok = await run(
      "bash",
      ["-lc", "test -d data && test -f .env && echo ok"],
      { cwd: tmp },
    );
    assert.equal(ok.code, 0, ok.stderr || ok.stdout);
    assert.match(ok.stdout, /ok/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

