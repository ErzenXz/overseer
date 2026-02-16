/**
 * Shared utilities between bot implementations (Telegram, Discord, etc.)
 */

import { interfacesModel, logsModel } from "../database/index";

// Rate limiting
const userCooldowns = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 2000;

export interface RateLimitConfig {
  cooldownMs?: number;
}

export interface BotLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Create a logger for a specific bot type
 */
export function createBotLogger(botType: string, ownerUserId?: number): BotLogger {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      console.log(`[INFO] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.create("info", botType, msg, meta, ownerUserId ?? null);
      } catch {}
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      console.error(`[ERROR] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.create("error", botType, msg, meta, ownerUserId ?? null);
      } catch {}
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      console.warn(`[WARN] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.create("warn", botType, msg, meta, ownerUserId ?? null);
      } catch {}
    },
    debug: (msg: string, meta?: Record<string, unknown>) => {
      console.debug(`[DEBUG] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.create("debug", botType, msg, meta, ownerUserId ?? null);
      } catch {}
    },
  };
}

/**
 * Check if user is rate limited
 * Returns true if user should be blocked, false if they can proceed
 */
export function isRateLimited(
  userId: string,
  config: RateLimitConfig = {},
): boolean {
  const cooldownMs = config.cooldownMs || DEFAULT_COOLDOWN_MS;
  const now = Date.now();
  const lastMessage = userCooldowns.get(userId) || 0;

  if (now - lastMessage < cooldownMs) {
    return true;
  }

  userCooldowns.set(userId, now);
  return false;
}

/**
 * Get remaining cooldown time in milliseconds
 */
export function getRemainingCooldown(
  userId: string,
  config: RateLimitConfig = {},
): number {
  const cooldownMs = config.cooldownMs || DEFAULT_COOLDOWN_MS;
  const now = Date.now();
  const lastMessage = userCooldowns.get(userId) || 0;
  const remaining = cooldownMs - (now - lastMessage);
  return remaining > 0 ? remaining : 0;
}

/**
 * Clear rate limit for a user (e.g., after an error)
 */
export function clearRateLimit(userId: string): void {
  userCooldowns.delete(userId);
}

/**
 * Get bot token from database or environment
 */
export function getBotToken(
  interfaceType: string,
  envVarName: string,
): string | null {
  // First try database
  const botInterface = interfacesModel.findByType(interfaceType);
  if (botInterface && botInterface.is_active) {
    const config = interfacesModel.getDecryptedConfig(botInterface.id);
    if (config?.bot_token) {
      return config.bot_token;
    }
  }

  // Fall back to environment
  return process.env[envVarName] || null;
}

/**
 * Get allowed users from database or environment
 */
export function getAllowedUsers(
  interfaceType: string,
  envVarName: string,
): string[] {
  const botInterface = interfacesModel.findByType(interfaceType);
  if (botInterface) {
    const users = interfacesModel.getAllowedUsers(botInterface.id);
    if (users.length > 0) return users;
  }

  // Fall back to environment
  const envUsers = process.env[envVarName];
  if (envUsers) {
    return envUsers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * Check if a user is allowed
 */
export function isUserAllowed(
  userId: string,
  interfaceType: string,
  envVarName: string,
): boolean {
  const allowed = getAllowedUsers(interfaceType, envVarName);
  if (allowed.length === 0) return true; // No restrictions
  return allowed.includes(userId);
}

/**
 * Get allowed guilds/groups from environment
 */
export function getAllowedGuilds(
  envVarName: string,
  interfaceType: "discord" | "slack" = "discord",
): string[] {
  const botInterface = interfacesModel.findByType(interfaceType);
  if (botInterface) {
    const config = interfacesModel.getDecryptedConfig(botInterface.id);
    if (Array.isArray(config?.allowed_guilds)) {
      const guilds = config.allowed_guilds.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      if (guilds.length > 0) {
        return guilds;
      }
    }
  }

  const envGuilds = process.env[envVarName];
  if (envGuilds) {
    return envGuilds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Check if a guild/group is allowed
 */
export function isGuildAllowed(guildId: string, envVarName: string): boolean {
  const allowed = getAllowedGuilds(envVarName);
  if (allowed.length === 0) return true; // No restrictions
  return allowed.includes(guildId);
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Split text into chunks for message platforms with size limits
 */
export function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point (newline, space)
    let breakPoint = remaining.lastIndexOf("\n", maxLength);
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = remaining.lastIndexOf(" ", maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength / 2) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

/**
 * Format tool execution for display
 */
export function formatToolCall(toolName: string): string {
  const toolIcons: Record<string, string> = {
    shell: "💻",
    readFile: "📄",
    writeFile: "✏️",
    listDirectory: "📁",
    executeShellCommand: "💻",
    executeShellCommandConfirmed: "⚠️",
    spawnSubAgent: "🧠",
  };

  const icon = toolIcons[toolName] || "🔧";
  return `${icon} Using: ${toolName}`;
}

function truncateMiddle(input: string, maxLen: number): string {
  const s = String(input || "");
  if (s.length <= maxLen) return s;
  const head = Math.max(1, Math.floor(maxLen * 0.7));
  const tail = Math.max(1, maxLen - head - 3);
  return `${s.slice(0, head)}...${s.slice(s.length - tail)}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Produce a short "receipt" summary of tool usage suitable for chat UIs.
 * This is intentionally compact: it should explain what ran without dumping logs.
 */
export function formatToolReceipts(
  receipts: Array<{ name: string; args: unknown; result: unknown }>,
): string | null {
  if (!receipts || receipts.length === 0) return null;

  const maxItems = 6;
  const items = receipts.slice(0, maxItems);

  const lines: string[] = ["Tool receipt"];
  for (const r of items) {
    const name = r?.name || "unknown";

    let argsSummary = "";
    if (name === "executeShellCommand" || name === "executeShellCommandConfirmed") {
      const cmd =
        r?.args && typeof r.args === "object" && r.args !== null && "command" in (r.args as any)
          ? String((r.args as any).command || "")
          : safeJson(r.args);
      argsSummary = truncateMiddle(cmd, 120);
    } else {
      argsSummary = truncateMiddle(safeJson(r.args), 120);
    }

    let resultSummary = "";
    if (r?.result && typeof r.result === "object" && r.result !== null) {
      const ok =
        "success" in (r.result as any) ? Boolean((r.result as any).success) : undefined;
      const out =
        "output" in (r.result as any) ? String((r.result as any).output || "") : "";
      const err =
        "error" in (r.result as any) ? String((r.result as any).error || "") : "";

      if (ok === true) {
        resultSummary = out ? `ok: ${truncateMiddle(out.replaceAll("\n", " "), 140)}` : "ok";
      } else if (ok === false) {
        resultSummary = err
          ? `error: ${truncateMiddle(err.replaceAll("\n", " "), 140)}`
          : "error";
      } else {
        resultSummary = truncateMiddle(safeJson(r.result), 140);
      }
    } else {
      resultSummary = truncateMiddle(safeJson(r.result), 140);
    }

    lines.push(`- ${name}: ${argsSummary} -> ${resultSummary}`);
  }

  if (receipts.length > maxItems) {
    lines.push(`- …and ${receipts.length - maxItems} more`);
  }

  return lines.join("\n");
}

/**
 * Format system status message
 */
export async function getSystemStatus(): Promise<string> {
  const os = await import("os");
  const uptime = Math.floor(os.uptime() / 60);
  const memUsed = Math.round(
    ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
  );
  const load = os.loadavg()[0].toFixed(2);

  return (
    `System Status\n\n` +
    `🖥️ Hostname: ${os.hostname()}\n` +
    `⏱️ Uptime: ${uptime} minutes\n` +
    `💾 Memory: ${memUsed}% used\n` +
    `📈 Load: ${load}\n` +
    `🤖 Bot: Online`
  );
}

/**
 * Format help message
 */
export function getHelpMessage(botName = "Overseer"): string {
  return (
    `${botName} Help\n\n` +
    `I'm your assistant. By default I work in your tenant sandbox, and some system actions may require permissions.\n\n` +
    `📁 File Operations\n` +
    `• Read, write, and list files\n\n` +
    `💻 Shell Commands\n` +
    `• Run git and build tooling\n` +
    `• Potentially run system commands if your permissions allow\n\n` +
    `🧠 Sub-Agents\n` +
    `• Delegate complex tasks to specialists\n\n` +
    `Just ask me anything!`
  );
}

/**
 * Format welcome message
 */
export function getWelcomeMessage(): string {
  return (
    `Hello! I'm your assistant.\n\n` +
    `I can help you with:\n` +
    `• Running shell commands\n` +
    `• Managing files and directories\n` +
    `• Git operations\n` +
    `• System monitoring\n` +
    `• And much more!\n\n` +
    `Just send me a message to get started.`
  );
}
