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
export function createBotLogger(botType: string): BotLogger {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      console.log(`[INFO] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.info(botType, msg, meta);
      } catch {}
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      console.error(`[ERROR] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.error(botType, msg, meta);
      } catch {}
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      console.warn(`[WARN] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.warn(botType, msg, meta);
      } catch {}
    },
    debug: (msg: string, meta?: Record<string, unknown>) => {
      console.debug(`[DEBUG] [${botType}] ${msg}`, meta || "");
      try {
        logsModel.debug(botType, msg, meta);
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
  config: RateLimitConfig = {}
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
  config: RateLimitConfig = {}
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
  interfaceType: "telegram" | "discord" | "slack",
  envVarName: string
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
  interfaceType: "telegram" | "discord" | "slack",
  envVarName: string
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
  interfaceType: "telegram" | "discord" | "slack",
  envVarName: string
): boolean {
  const allowed = getAllowedUsers(interfaceType, envVarName);
  if (allowed.length === 0) return true; // No restrictions
  return allowed.includes(userId);
}

/**
 * Get allowed guilds/groups from environment
 */
export function getAllowedGuilds(envVarName: string): string[] {
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
    listFiles: "📁",
    searchFiles: "🔍",
    gitStatus: "📊",
    gitCommit: "📝",
    gitPush: "⬆️",
    gitPull: "⬇️",
    systemInfo: "🖥️",
    processInfo: "⚙️",
    networkInfo: "🌐",
  };

  const icon = toolIcons[toolName] || "🔧";
  return `${icon} Using: ${toolName}`;
}

/**
 * Format system status message
 */
export async function getSystemStatus(): Promise<string> {
  const os = await import("os");
  const uptime = Math.floor(os.uptime() / 60);
  const memUsed = Math.round(
    ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
  );
  const load = os.loadavg()[0].toFixed(2);

  return (
    `**System Status**\n\n` +
    `🖥️ Hostname: \`${os.hostname()}\`\n` +
    `⏱️ Uptime: ${uptime} minutes\n` +
    `💾 Memory: ${memUsed}% used\n` +
    `📈 Load: ${load}\n` +
    `🤖 Bot: Online`
  );
}

/**
 * Format help message
 */
export function getHelpMessage(botName = "MyBot"): string {
  return (
    `**${botName} Help**\n\n` +
    `I'm an AI assistant with full access to this VPS. I can:\n\n` +
    `📁 **File Operations**\n` +
    `• Read, write, and manage files\n` +
    `• Search for files and content\n\n` +
    `💻 **Shell Commands**\n` +
    `• Execute any bash command\n` +
    `• Monitor and manage processes\n\n` +
    `🔧 **Git Operations**\n` +
    `• Clone, pull, push repositories\n` +
    `• Manage branches and commits\n\n` +
    `📊 **System Info**\n` +
    `• CPU, memory, disk usage\n` +
    `• Network diagnostics\n\n` +
    `Just ask me anything!`
  );
}

/**
 * Format welcome message
 */
export function getWelcomeMessage(): string {
  return (
    `👋 Hello! I'm your AI assistant with full VPS access.\n\n` +
    `I can help you with:\n` +
    `• Running shell commands\n` +
    `• Managing files and directories\n` +
    `• Git operations\n` +
    `• System monitoring\n` +
    `• And much more!\n\n` +
    `Just send me a message to get started.`
  );
}
