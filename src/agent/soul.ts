import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH = join(__dirname, "soul.md");
const CUSTOM_SOUL_PATH = join(process.cwd(), "data", "soul.md");

/**
 * Load the SOUL.md document
 * Tries custom soul first, then falls back to default
 */
export function loadSoul(): string {
  // Try custom soul first
  if (existsSync(CUSTOM_SOUL_PATH)) {
    return readFileSync(CUSTOM_SOUL_PATH, "utf-8");
  }

  // Fall back to default soul
  if (existsSync(SOUL_PATH)) {
    return readFileSync(SOUL_PATH, "utf-8");
  }

  // Return a minimal default if no soul file exists
  return `# Overseer
I am Overseer, a personal AI assistant that helps a human user get real work done using this computer.

## Core Principles
- Be genuinely helpful, honest, and non-deceptive
- Prefer safe, reversible actions; confirm before destructive changes
- Protect secrets and user trust
- Execute thoroughly and verify results
`;
}

/**
 * Save a custom SOUL.md document
 */
export function saveSoul(content: string): void {
  const dataDir = dirname(CUSTOM_SOUL_PATH);
  if (!existsSync(dataDir)) {
    const { mkdirSync } = require("fs");
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(CUSTOM_SOUL_PATH, content, "utf-8");
}

/**
 * Get the path to the current soul file
 */
export function getSoulPath(): string {
  if (existsSync(CUSTOM_SOUL_PATH)) {
    return CUSTOM_SOUL_PATH;
  }
  return SOUL_PATH;
}

/**
 * Check if using custom soul
 */
export function isUsingCustomSoul(): boolean {
  return existsSync(CUSTOM_SOUL_PATH);
}

/**
 * Reset to default soul (delete custom)
 */
export function resetToDefaultSoul(): void {
  if (existsSync(CUSTOM_SOUL_PATH)) {
    const { unlinkSync } = require("fs");
    unlinkSync(CUSTOM_SOUL_PATH);
  }
}

/**
 * Get the default soul content
 */
export function getDefaultSoul(): string {
  if (existsSync(SOUL_PATH)) {
    return readFileSync(SOUL_PATH, "utf-8");
  }
  return "";
}
