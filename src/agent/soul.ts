import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ensureDir, getUserSandboxRoot } from "../lib/userfs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Base soul (global): default is src/agent/soul.md, optional override is data/soul.md
const BASE_SOUL_PATH = join(__dirname, "soul.md");
const CUSTOM_BASE_SOUL_PATH = join(process.cwd(), "data", "soul.md");

function getUserSoulSupplementPath(ownerUserId: number): string {
  const root = getUserSandboxRoot({ kind: "web", id: String(ownerUserId) });
  return join(root, "agent", "soul.md");
}

export function loadBaseSoul(): string {
  if (existsSync(CUSTOM_BASE_SOUL_PATH)) {
    return readFileSync(CUSTOM_BASE_SOUL_PATH, "utf-8");
  }

  if (existsSync(BASE_SOUL_PATH)) {
    return readFileSync(BASE_SOUL_PATH, "utf-8");
  }

  return `# Overseer
I am Overseer, a personal AI assistant that helps a human user get real work done using this computer.

## Core Principles
- Be genuinely helpful, honest, and non-deceptive
- Prefer safe, reversible actions; confirm before destructive changes
- Protect secrets and user trust
- Execute thoroughly and verify results
`;
}

export function loadUserSoulSupplement(ownerUserId: number): string {
  const path = getUserSoulSupplementPath(ownerUserId);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

/**
 * Load the effective SOUL.md (base + optional per-user supplement).
 */
export function loadSoul(ownerUserId?: number): string {
  const base = loadBaseSoul();
  if (typeof ownerUserId !== "number") return base;

  const supplement = loadUserSoulSupplement(ownerUserId).trim();
  if (!supplement) return base;

  return `${base}\n\n---\n\n${supplement}\n`;
}

/**
 * Save a custom BASE soul override (global).
 * Note: per-user customization is handled via saveUserSoulSupplement().
 */
export function saveSoul(content: string): void {
  const dataDir = dirname(CUSTOM_BASE_SOUL_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(CUSTOM_BASE_SOUL_PATH, content, "utf-8");
}

export function saveUserSoulSupplement(ownerUserId: number, content: string): void {
  const path = getUserSoulSupplementPath(ownerUserId);
  ensureDir(dirname(path));
  writeFileSync(path, content, "utf-8");
}

export function resetUserSoulSupplement(ownerUserId: number): void {
  const path = getUserSoulSupplementPath(ownerUserId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function isUsingUserSoulSupplement(ownerUserId: number): boolean {
  const path = getUserSoulSupplementPath(ownerUserId);
  return existsSync(path);
}

/**
 * Get the path to the current BASE soul file.
 */
export function getSoulPath(): string {
  return existsSync(CUSTOM_BASE_SOUL_PATH) ? CUSTOM_BASE_SOUL_PATH : BASE_SOUL_PATH;
}

export function isUsingCustomSoul(): boolean {
  return existsSync(CUSTOM_BASE_SOUL_PATH);
}

export function resetToDefaultSoul(): void {
  if (existsSync(CUSTOM_BASE_SOUL_PATH)) {
    unlinkSync(CUSTOM_BASE_SOUL_PATH);
  }
}

export function getDefaultSoul(): string {
  return existsSync(BASE_SOUL_PATH) ? readFileSync(BASE_SOUL_PATH, "utf-8") : "";
}

