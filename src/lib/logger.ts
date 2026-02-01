import { logsModel } from "../database/index";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLogLevel = LOG_LEVELS[
  (process.env.LOG_LEVEL as LogLevel) || "info"
];

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLogLevel;
}

function formatMessage(
  level: LogLevel,
  category: string,
  message: string
): string {
  const timestamp = new Date().toISOString();
  const levelPadded = level.toUpperCase().padEnd(5);
  return `[${timestamp}] ${levelPadded} [${category}] ${message}`;
}

function logToConsole(
  level: LogLevel,
  category: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  const formattedMessage = formatMessage(level, category, message);

  switch (level) {
    case "debug":
      console.debug(formattedMessage, metadata || "");
      break;
    case "info":
      console.info(formattedMessage, metadata || "");
      break;
    case "warn":
      console.warn(formattedMessage, metadata || "");
      break;
    case "error":
      console.error(formattedMessage, metadata || "");
      break;
  }
}

export function createLogger(category: string) {
  return {
    debug(message: string, metadata?: Record<string, unknown>): void {
      if (shouldLog("debug")) {
        logToConsole("debug", category, message, metadata);
        try {
          logsModel.debug(category, message, metadata);
        } catch {
          // Ignore database errors in logging
        }
      }
    },

    info(message: string, metadata?: Record<string, unknown>): void {
      if (shouldLog("info")) {
        logToConsole("info", category, message, metadata);
        try {
          logsModel.info(category, message, metadata);
        } catch {
          // Ignore database errors in logging
        }
      }
    },

    warn(message: string, metadata?: Record<string, unknown>): void {
      if (shouldLog("warn")) {
        logToConsole("warn", category, message, metadata);
        try {
          logsModel.warn(category, message, metadata);
        } catch {
          // Ignore database errors in logging
        }
      }
    },

    error(message: string, metadata?: Record<string, unknown>): void {
      if (shouldLog("error")) {
        logToConsole("error", category, message, metadata);
        try {
          logsModel.error(category, message, metadata);
        } catch {
          // Ignore database errors in logging
        }
      }
    },
  };
}

// Default loggers for common categories
export const systemLogger = createLogger("system");
export const agentLogger = createLogger("agent");
export const telegramLogger = createLogger("telegram");
export const apiLogger = createLogger("api");
