import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";
import {
  isWindows,
  isUnix,
  getShellArgs,
  getPlatformEnv,
  mapCommand,
  normalizePath,
  getPlatform,
} from "../../lib/platform";

const execAsync = promisify(exec);
const logger = createLogger("tools:shell");

// Dangerous commands that require confirmation - platform specific
const UNIX_DANGEROUS_PATTERNS = [
  /\brm\s+(-[rf]+\s+)?\//, // rm with absolute path
  /\brm\s+-rf?\s/,        // rm -r or rm -rf
  /\brmdir\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b>\s*\/dev\//,
  /\bchmod\s+777/,
  /\bchown\s+/,
  /\bsudo\s+rm/,
  /\bkill\s+-9/,
  /\bkillall\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsystemctl\s+(stop|disable|mask)/,
  />\s*\//,              // redirect to root
];

const WINDOWS_DANGEROUS_PATTERNS = [
  /Remove-Item\s+.*-Recurse/i,
  /Remove-Item\s+.*-Force/i,
  /del\s+\/[sS]/i,
  /rd\s+\/[sS]/i,
  /rmdir\s+\/[sS]/i,
  /format\s+[a-z]:/i,
  /diskpart/i,
  /Stop-Process\s+.*-Force/i,
  /Stop-Service/i,
  /Disable-Service/i,
  /shutdown/i,
  /Restart-Computer/i,
  /Stop-Computer/i,
  /Remove-Item\s+C:\\/i,
  /Remove-Item\s+"?C:\\/i,
  /reg\s+delete/i,
];

const SQL_DANGEROUS_PATTERNS = [
  /\bdrop\s+database/i,
  /\bdrop\s+table/i,
  /\btruncate\s+table/i,
  /\bdelete\s+from/i,
];

function isDangerousCommand(command: string): boolean {
  // Check SQL patterns (platform-independent)
  if (SQL_DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) {
    return true;
  }

  // Check platform-specific patterns
  if (isWindows()) {
    return WINDOWS_DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
  }

  return UNIX_DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

const TIMEOUT_MS = parseInt(process.env.SHELL_TIMEOUT_MS || "30000", 10);
const MAX_OUTPUT_LENGTH = 50000; // 50KB max output

/**
 * Execute a command with proper platform handling
 */
async function executeCommand(
  command: string,
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  const platform = getPlatform();
  
  // Normalize working directory path
  const normalizedCwd = normalizePath(cwd);

  if (isWindows()) {
    // Use PowerShell on Windows
    const { shell, args } = getShellArgs(command);
    
    return new Promise((resolve, reject) => {
      const child = spawn(shell, args, {
        cwd: normalizedCwd,
        env: getPlatformEnv(),
        shell: false,
        timeout,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (code === 0 || stdout || stderr) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      // Handle timeout
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Command timed out after ${timeout / 1000} seconds`));
      }, timeout);
    });
  }

  // Unix-like systems - use exec which handles shell properly
  return execAsync(command, {
    cwd: normalizedCwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    env: getPlatformEnv(),
    shell: process.env.SHELL || "/bin/bash",
  });
}

export const executeShellCommand = tool({
  description: `Execute a shell command on the system. 
Platform: ${getPlatform().toUpperCase()}
Shell: ${isWindows() ? "PowerShell" : "Bash/Zsh"}

IMPORTANT:
- Commands are executed using ${isWindows() ? "PowerShell" : "the default shell (bash/zsh)"}
- Commands run as the current user (not root/admin)
- Dangerous commands (rm -rf, Remove-Item -Recurse, etc.) will be flagged
- Long-running commands will timeout after ${TIMEOUT_MS / 1000} seconds
- Use this for: file operations, git, npm, system info, etc.
- For cross-platform compatibility, commands may be automatically mapped between Unix and Windows equivalents`,
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    workingDirectory: z
      .string()
      .optional()
      .describe("Working directory for the command (default: home directory)"),
    timeout: z
      .number()
      .optional()
      .describe(`Timeout in milliseconds (default: ${TIMEOUT_MS})`),
    autoMap: z
      .boolean()
      .optional()
      .describe("Automatically map Unix commands to Windows equivalents (default: false)"),
  }),
  execute: async ({ command, workingDirectory, timeout, autoMap = false }) => {
    const startTime = Date.now();
    const homeDir = isWindows() 
      ? process.env.USERPROFILE || process.env.HOMEDRIVE + process.env.HOMEPATH 
      : process.env.HOME;
    const cwd = workingDirectory || homeDir || process.cwd();

    // Optionally map command between platforms
    let finalCommand = command;
    if (autoMap) {
      finalCommand = mapCommand(command);
    }

    logger.info("Executing shell command", { 
      command: finalCommand, 
      cwd, 
      platform: getPlatform(),
      originalCommand: autoMap ? command : undefined,
    });

    // Check for dangerous commands
    if (isDangerousCommand(finalCommand)) {
      const result = {
        success: false,
        output: "",
        error: `⚠️ DANGEROUS COMMAND DETECTED: "${finalCommand}"\n\nThis command could cause data loss or system damage. Please confirm you want to run this command by explicitly asking me to execute it with confirmation.`,
        requiresConfirmation: true,
        executionTimeMs: Date.now() - startTime,
        platform: getPlatform(),
      };

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command: finalCommand, workingDirectory },
        output: result.error,
        success: false,
        error: "Dangerous command blocked",
        execution_time_ms: result.executionTimeMs,
      });

      return result;
    }

    try {
      const { stdout, stderr } = await executeCommand(
        finalCommand,
        cwd,
        timeout || TIMEOUT_MS
      );

      let output = stdout || "";
      if (stderr && !stdout) {
        output = stderr;
      } else if (stderr) {
        output += "\n--- stderr ---\n" + stderr;
      }

      // Truncate if too long
      if (output.length > MAX_OUTPUT_LENGTH) {
        output =
          output.substring(0, MAX_OUTPUT_LENGTH) +
          `\n\n... (output truncated, ${output.length - MAX_OUTPUT_LENGTH} bytes omitted)`;
      }

      const executionTimeMs = Date.now() - startTime;

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command: finalCommand, workingDirectory },
        output: output.substring(0, 5000),
        success: true,
        execution_time_ms: executionTimeMs,
      });

      logger.info("Command executed successfully", {
        command: finalCommand,
        executionTimeMs,
        outputLength: output.length,
        platform: getPlatform(),
      });

      return {
        success: true,
        output: output || "(no output)",
        error: undefined,
        executionTimeMs,
        platform: getPlatform(),
        commandExecuted: finalCommand,
      };
    } catch (error: unknown) {
      const executionTimeMs = Date.now() - startTime;
      const err = error as { message?: string; code?: number; killed?: boolean; stderr?: string };
      
      let errorMessage = err.message || String(error);
      if (err.killed) {
        errorMessage = `Command timed out after ${(timeout || TIMEOUT_MS) / 1000} seconds`;
      }

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command: finalCommand, workingDirectory },
        output: undefined,
        success: false,
        error: errorMessage,
        execution_time_ms: executionTimeMs,
      });

      logger.error("Command execution failed", {
        command: finalCommand,
        error: errorMessage,
        executionTimeMs,
        platform: getPlatform(),
      });

      return {
        success: false,
        output: err.stderr || "",
        error: errorMessage,
        executionTimeMs,
        platform: getPlatform(),
      };
    }
  },
});

export const executeShellCommandConfirmed = tool({
  description: `Execute a dangerous/destructive shell command after user confirmation.
Only use this when the user has explicitly confirmed they want to run a dangerous command.
Platform: ${getPlatform().toUpperCase()}`,
  parameters: z.object({
    command: z.string().describe("The dangerous shell command to execute"),
    workingDirectory: z
      .string()
      .optional()
      .describe("Working directory for the command"),
    userConfirmation: z
      .string()
      .describe("The user's confirmation message (must be provided)"),
    autoMap: z
      .boolean()
      .optional()
      .describe("Automatically map Unix commands to Windows equivalents (default: false)"),
  }),
  execute: async ({ command, workingDirectory, userConfirmation, autoMap = false }) => {
    const startTime = Date.now();
    const homeDir = isWindows() 
      ? process.env.USERPROFILE || process.env.HOMEDRIVE + process.env.HOMEPATH 
      : process.env.HOME;
    const cwd = workingDirectory || homeDir || process.cwd();

    // Optionally map command between platforms
    let finalCommand = command;
    if (autoMap) {
      finalCommand = mapCommand(command);
    }

    logger.warn("Executing confirmed dangerous command", {
      command: finalCommand,
      cwd,
      userConfirmation,
      platform: getPlatform(),
    });

    try {
      const { stdout, stderr } = await executeCommand(
        finalCommand,
        cwd,
        TIMEOUT_MS * 2 // Double timeout for dangerous commands
      );

      let output = stdout || "";
      if (stderr) {
        output += stderr ? "\n--- stderr ---\n" + stderr : "";
      }

      if (output.length > MAX_OUTPUT_LENGTH) {
        output =
          output.substring(0, MAX_OUTPUT_LENGTH) +
          `\n\n... (output truncated)`;
      }

      const executionTimeMs = Date.now() - startTime;

      toolExecutionsModel.create({
        tool_name: "executeShellCommandConfirmed",
        input: { command: finalCommand, workingDirectory, userConfirmation },
        output: output.substring(0, 5000),
        success: true,
        execution_time_ms: executionTimeMs,
      });

      return {
        success: true,
        output: output || "(no output)",
        error: undefined,
        executionTimeMs,
        wasConfirmed: true,
        platform: getPlatform(),
        commandExecuted: finalCommand,
      };
    } catch (error: unknown) {
      const executionTimeMs = Date.now() - startTime;
      const err = error as { message?: string; stderr?: string };
      const errorMessage = err.message || String(error);

      toolExecutionsModel.create({
        tool_name: "executeShellCommandConfirmed",
        input: { command: finalCommand, workingDirectory, userConfirmation },
        output: undefined,
        success: false,
        error: errorMessage,
        execution_time_ms: executionTimeMs,
      });

      return {
        success: false,
        output: err.stderr || "",
        error: errorMessage,
        executionTimeMs,
        platform: getPlatform(),
      };
    }
  },
});

/**
 * Get shell information for the current platform
 */
export const getShellInfo = tool({
  description: `Get information about the current shell and platform.`,
  parameters: z.object({}),
  execute: async () => {
    const platform = getPlatform();
    const { shell } = getShellArgs("echo test");
    
    return {
      success: true,
      platform,
      shell,
      isWindows: isWindows(),
      isUnix: isUnix(),
      homeDirectory: isWindows() 
        ? process.env.USERPROFILE 
        : process.env.HOME,
      tempDirectory: isWindows()
        ? process.env.TEMP
        : "/tmp",
    };
  },
});
