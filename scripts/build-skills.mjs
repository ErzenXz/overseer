#!/usr/bin/env node

import { build } from "esbuild";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const skillsDir = resolve(root, "skills");

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

if (!existsSync(skillsDir)) {
  console.error(`skills directory not found: ${skillsDir}`);
  process.exit(1);
}

const entries = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let built = 0;
for (const skillId of entries) {
  const dir = join(skillsDir, skillId);
  if (!isDir(dir)) continue;

  const inFile = join(dir, "index.ts");
  if (!existsSync(inFile)) continue;

  const outFile = join(dir, "index.mjs");

  await build({
    entryPoints: [inFile],
    outfile: outFile,
    bundle: false,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
    logLevel: "silent",
    tsconfig: join(root, "tsconfig.json"),
  });

  built++;
}

console.log(`✅ Built ${built} skill module(s)`);

