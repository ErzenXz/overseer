import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(process.cwd(), ".env") });

export interface Config {
  // Application
  nodeEnv: string;
  port: number;
  baseUrl: string;

  // Security
  sessionSecret: string;
  encryptionKey: string;

  // Database
  databasePath: string;

  // Default Admin
  defaultAdminUsername: string;
  defaultAdminPassword: string;

  // LLM Providers
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;

  // Telegram
  telegramBotToken?: string;
  telegramAllowedUsers: string[];
  telegramWebhookDomain?: string;
  telegramWebhookSecret?: string;

  // Discord
  discordBotToken?: string;

  // Agent Settings
  agentMaxRetries: number;
  agentMaxSteps: number;
  agentDefaultModel: string;
  agentTimeoutMs: number;

  // Tool Settings
  allowShellCommands: boolean;
  requireConfirmationForDestructive: boolean;
  shellTimeoutMs: number;
  maxFileSizeMb: number;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseArray(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function getConfig(): Config {
  return {
    // Application
    nodeEnv: process.env.NODE_ENV || "development",
    port: parseNumber(process.env.PORT, 3000),
    baseUrl: process.env.BASE_URL || "http://localhost:3000",

    // Security
    sessionSecret: process.env.SESSION_SECRET || "change-this-secret",
    encryptionKey: process.env.ENCRYPTION_KEY || "change-this-key",

    // Database
    databasePath: process.env.DATABASE_PATH || "./data/overseer.db",

    // Default Admin
    defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || "admin",
    defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || "changeme123",

    // LLM Providers
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,

    // Telegram
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramAllowedUsers: parseArray(process.env.TELEGRAM_ALLOWED_USERS),
    telegramWebhookDomain: process.env.TELEGRAM_WEBHOOK_DOMAIN,
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,

    // Discord
    discordBotToken: process.env.DISCORD_BOT_TOKEN,

    // Agent Settings
    agentMaxRetries: parseNumber(process.env.AGENT_MAX_RETRIES, 3),
    agentMaxSteps: parseNumber(process.env.AGENT_MAX_STEPS, 25),
    agentDefaultModel: process.env.AGENT_DEFAULT_MODEL || "gpt-4o",
    agentTimeoutMs: parseNumber(process.env.AGENT_TIMEOUT_MS, 120000),

    // Tool Settings
    allowShellCommands: parseBoolean(process.env.ALLOW_SHELL_COMMANDS, true),
    requireConfirmationForDestructive: parseBoolean(
      process.env.REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE,
      true
    ),
    shellTimeoutMs: parseNumber(process.env.SHELL_TIMEOUT_MS, 30000),
    maxFileSizeMb: parseNumber(process.env.MAX_FILE_SIZE_MB, 10),
  };
}

// Singleton config instance
let configInstance: Config | null = null;

export function loadConfig(): Config {
  if (!configInstance) {
    configInstance = getConfig();
  }
  return configInstance;
}

// Reload config (for when settings change)
export function reloadConfig(): Config {
  configInstance = getConfig();
  return configInstance;
}
