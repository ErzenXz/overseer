import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { settingsModel, toolExecutionsModel } from "../../database/index";
import { usersModel } from "../../database";
import { createLogger } from "../../lib/logger";
import { classifyCommandSafety } from "../../lib/command-safety";
import { getToolContext } from "../../lib/tool-context";
import { ensureDir } from "../../lib/userfs";
import { hasPermission, Permission } from "../../lib/permissions";
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

const TIMEOUT_MS = parseInt(process.env.SHELL_TIMEOUT_MS || "30000", 10);
const MAX_OUTPUT_LENGTH = 50000; // 50KB max output

/**
 * Execute a command with proper platform handling.
 * When stdinInput is provided, uses spawn to pipe input to the command's stdin.
 */
async function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  stdinInput?: string
): Promise<{ stdout: string; stderr: string }> {
  const normalizedCwd = normalizePath(cwd);

  // If stdin input is provided, use spawn to pipe it
  if (stdinInput !== undefined) {
    return new Promise((resolve, reject) => {
      const shellCmd = isWindows() ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
      const shellArgs = isWindows() ? ["-Command", command] : ["-c", command];
      const spawnEnv = { ...process.env, ...getPlatformEnv(), TERM: "dumb", DEBIAN_FRONTEND: "noninteractive" };

      const child = spawn(shellCmd, shellArgs, {
        cwd: normalizedCwd,
        env: spawnEnv,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Write stdin and close
      if (stdinInput) {
        child.stdin.write(stdinInput);
      }
      child.stdin.end();

      child.on("error", reject);

      child.on("close", (code: number | null) => {
        if (timedOut) return;
        if (code === 0 || stdout || stderr) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });

      setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        reject(new Error(`Command timed out after ${timeout / 1000} seconds`));
      }, timeout);
    });
  }

  if (isWindows()) {
    // Use PowerShell on Windows
    const { shell, args } = getShellArgs(command);
    
    return new Promise((resolve, reject) => {
      const child = spawn(shell, args, {
        cwd: normalizedCwd,
        env: getPlatformEnv() as NodeJS.ProcessEnv,
        shell: false,
        timeout,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", reject);

      child.on("close", (code: number | null) => {
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
    env: getPlatformEnv() as NodeJS.ProcessEnv,
    shell: process.env.SHELL || "/bin/bash",
  });
}

function hasDisallowedAbsolutePaths(command: string, sandboxRoot: string): boolean {
  const root = normalizePath(sandboxRoot);
  // crude scan for absolute unix paths; allow /dev/* only.
  const unixMatches = command.match(/\/[A-Za-z0-9._\/-]+/g) || [];
  for (const m of unixMatches) {
    if (m.startsWith("/dev/")) continue;
    if (m.startsWith(root)) continue;
    return true;
  }

  // windows drive paths
  const winMatches = command.match(/[A-Za-z]:\\[^\\s"']+/g) || [];
  for (const m of winMatches) {
    if (m.startsWith(root)) continue;
    return true;
  }

  return false;
}

export const executeShellCommand = tool<any, any>({
  description: `Execute a shell command on the system and return its output.
Platform: ${getPlatform().toUpperCase()} | Shell: ${isWindows() ? "PowerShell" : "Bash/Zsh"}

WHEN TO USE:
- Use for git operations, package management (npm, pip, apt), build tools, system info, searching (grep, find, rg), and any CLI workflow.
- Prefer the dedicated readFile/writeFile/listDirectory tools for basic file operations — they provide structured output and cross-platform safety.
- Use this tool when you need: piping, redirection, process management, network commands, or anything the file tools can't do.

EXECUTION DETAILS:
- Commands run as the current user (not root/admin) using ${isWindows() ? "PowerShell" : "the default shell (bash/zsh)"}.
- Dangerous commands (rm -rf /, format C:, drop database, etc.) are detected and blocked — use executeShellCommandConfirmed if the user explicitly approves.
- Timeout: ${TIMEOUT_MS / 1000} seconds. Set a custom timeout for long-running operations (builds, downloads).
- Max output: ${MAX_OUTPUT_LENGTH / 1000}KB — output beyond this is truncated.
- Cross-platform: set autoMap: true to automatically translate Unix commands to Windows equivalents (e.g., ls → Get-ChildItem).

COMMON PATTERNS:
- Package install: "npm install express" or "pip install requests"
- Git operations: "git status", "git log --oneline -20"
- Search: "grep -rn 'TODO' src/" or "find . -name '*.ts' -type f"
- System info: "df -h", "free -m", "uname -a"
- Process management: "ps aux | grep node", "lsof -i :3000"
- Docker: "docker ps", "docker-compose up -d"

INTERACTIVE COMMANDS:
- ALWAYS prefer non-interactive flags when available: --yes, -y, --default, --no-input, CI=true.
- If no non-interactive flag exists, provide answers via the "stdin" parameter as newline-separated values.
- Example: for a CLI that asks project name then language, use stdin: "my-project\\nTypeScript\\n"
- The stdin input is written to the command's stdin and then stdin is closed.`,
  inputSchema: z.object({
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
    stdin: z.string().optional().describe(
      "Input to pipe to the command's stdin. Use this for interactive commands that prompt for input. " +
      "Provide answers separated by newlines (\\n). " +
      "Example: for a CLI that asks name then language, use 'my-project\\nTypeScript\\n'. " +
      "PREFER using non-interactive flags (--yes, -y, --default) when available instead of stdin."
    ),
  }),
  execute: async ({ command, workingDirectory, timeout, autoMap = false, stdin }: { command: string; workingDirectory?: string; timeout?: number; autoMap?: boolean; stdin?: string }) => {
    const startTime = Date.now();
    const requireConfirmation =
      settingsModel.getWithDefault("tools.require_confirmation", "true") ===
      "true";
    const configuredTimeoutMsRaw = settingsModel.getWithDefault(
      "tools.shell_timeout_ms",
      String(TIMEOUT_MS),
    );
    const configuredTimeoutMs = Number.parseInt(configuredTimeoutMsRaw, 10);
    const effectiveTimeoutMs = Number.isFinite(configuredTimeoutMs)
      ? configuredTimeoutMs
      : TIMEOUT_MS;
    const ctx = getToolContext();
    if (ctx?.sandboxRoot && !ctx.allowSystem) {
      ensureDir(ctx.sandboxRoot);
    }
    if (ctx?.allowSystem) {
      const actorId =
        ctx.actor?.kind === "web" ? Number.parseInt(ctx.actor.id, 10) : NaN;
      if (!Number.isFinite(actorId)) {
        return {
          success: false,
          output: "",
          error: "Host shell access denied: no authenticated web user context.",
          executionTimeMs: Date.now() - startTime,
          platform: getPlatform(),
        };
      }
      const actorUser = usersModel.findById(actorId);
      if (!hasPermission(actorUser ?? null, Permission.SYSTEM_SHELL)) {
        return {
          success: false,
          output: "",
          error: "Host shell access denied: missing permission system:shell.",
          executionTimeMs: Date.now() - startTime,
          platform: getPlatform(),
        };
      }
    }

    const homeDir = isWindows()
      ? process.env.USERPROFILE || `${process.env.HOMEDRIVE ?? ""}${process.env.HOMEPATH ?? ""}`
      : process.env.HOME;
    const defaultCwd = workingDirectory || homeDir || process.cwd();
    const cwd =
      ctx?.sandboxRoot && !ctx.allowSystem ? ctx.sandboxRoot : defaultCwd;

    // Optionally map command between platforms
    let finalCommand = command;
    if (autoMap) {
      finalCommand = mapCommand(command);
    }

    if (ctx?.sandboxRoot && !ctx.allowSystem) {
      // Disallow absolute paths outside the sandbox for basic containment.
      if (hasDisallowedAbsolutePaths(finalCommand, ctx.sandboxRoot)) {
        return {
          success: false,
          output: "",
          error:
            "Sandbox mode: absolute paths outside your sandbox are blocked. Use relative paths inside your sandbox root.",
          executionTimeMs: Date.now() - startTime,
          platform: getPlatform(),
        };
      }
    }

    logger.info("Executing shell command", { 
      command: finalCommand, 
      cwd, 
      platform: getPlatform(),
      originalCommand: autoMap ? command : undefined,
      hasStdin: !!stdin,
    });

    const safety = classifyCommandSafety(finalCommand, getPlatform());
    if (safety.risk === "deny") {
      const result = {
        success: false,
        output: "",
        error:
          `⛔ COMMAND BLOCKED: "${finalCommand}"\n\n` +
          `This command matches a high-risk pattern and is blocked to prevent system damage.\n` +
          (safety.reasons.length > 0
            ? `\nReasons:\n- ${safety.reasons.join("\n- ")}\n`
            : ""),
        requiresConfirmation: false,
        denied: true,
        executionTimeMs: Date.now() - startTime,
        platform: getPlatform(),
      };

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command: finalCommand, workingDirectory },
        output: result.error,
        success: false,
        error: "Command denied by safety policy",
        execution_time_ms: result.executionTimeMs,
      });

      return result;
    }

    if (safety.risk === "confirm" && requireConfirmation) {
      const result = {
        success: false,
        output: "",
        error:
          `⚠️ CONFIRMATION REQUIRED: "${finalCommand}"\n\n` +
          `This command may be destructive or disruptive.\n` +
          (safety.reasons.length > 0
            ? `\nWhy it was flagged:\n- ${safety.reasons.join("\n- ")}\n`
            : "") +
          `\nIf you want to proceed, explicitly confirm and I will run it using executeShellCommandConfirmed.`,
        requiresConfirmation: true,
        executionTimeMs: Date.now() - startTime,
        platform: getPlatform(),
      };

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command: finalCommand, workingDirectory },
        output: result.error,
        success: false,
        error: "Confirmation required",
        execution_time_ms: result.executionTimeMs,
      });

      return result;
    }

    try {
      const { stdout, stderr } = await executeCommand(
        finalCommand,
        cwd,
        timeout || effectiveTimeoutMs,
        stdin
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

export const executeShellCommandConfirmed = tool<any, any>({
  description: `Execute a dangerous/destructive shell command AFTER the user has explicitly confirmed.
Platform: ${getPlatform().toUpperCase()}

WHEN TO USE:
- Only use this when executeShellCommand blocked a command as dangerous AND the user has explicitly confirmed they want to proceed.
- You MUST include the user's confirmation message in the userConfirmation parameter.
- This tool has double the normal timeout (${(TIMEOUT_MS * 2) / 1000}s) since destructive operations may take longer.

NEVER use this tool preemptively — always attempt the command with executeShellCommand first and let the danger detection decide.`,
  inputSchema: z.object({
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
  execute: async ({ command, workingDirectory, userConfirmation, autoMap = false }: { command: string; workingDirectory?: string; userConfirmation: string; autoMap?: boolean }) => {
    const startTime = Date.now();
    const configuredTimeoutMsRaw = settingsModel.getWithDefault(
      "tools.shell_timeout_ms",
      String(TIMEOUT_MS),
    );
    const configuredTimeoutMs = Number.parseInt(configuredTimeoutMsRaw, 10);
    const effectiveTimeoutMs = Number.isFinite(configuredTimeoutMs)
      ? configuredTimeoutMs
      : TIMEOUT_MS;
    const ctx = getToolContext();
    if (ctx?.sandboxRoot && !ctx.allowSystem) {
      ensureDir(ctx.sandboxRoot);
    }
    if (ctx?.allowSystem) {
      const actorId =
        ctx.actor?.kind === "web" ? Number.parseInt(ctx.actor.id, 10) : NaN;
      if (!Number.isFinite(actorId)) {
        return {
          success: false,
          output: "",
          error: "Host shell access denied: no authenticated web user context.",
          executionTimeMs: Date.now() - startTime,
          platform: getPlatform(),
        };
      }
      const actorUser = usersModel.findById(actorId);
      if (!hasPermission(actorUser ?? null, Permission.SYSTEM_SHELL)) {
        return {
          success: false,
          output: "",
          error: "Host shell access denied: missing permission system:shell.",
          executionTimeMs: Date.now() - startTime,
          platform: getPlatform(),
        };
      }
    }

    const homeDir = isWindows()
      ? process.env.USERPROFILE || `${process.env.HOMEDRIVE ?? ""}${process.env.HOMEPATH ?? ""}`
      : process.env.HOME;
    const defaultCwd = workingDirectory || homeDir || process.cwd();
    const cwd =
      ctx?.sandboxRoot && !ctx.allowSystem ? ctx.sandboxRoot : defaultCwd;

    // Optionally map command between platforms
    let finalCommand = command;
    if (autoMap) {
      finalCommand = mapCommand(command);
    }

    if (ctx?.sandboxRoot && !ctx.allowSystem) {
      if (hasDisallowedAbsolutePaths(finalCommand, ctx.sandboxRoot)) {
        return {
          success: false,
          output: "",
          error:
            "Sandbox mode: absolute paths outside your sandbox are blocked. Use relative paths inside your sandbox root.",
          executionTimeMs: Date.now() - startTime,
          platform: getPlatform(),
        };
      }
    }

    logger.warn("Executing confirmed dangerous command", {
      command: finalCommand,
      cwd,
      userConfirmation,
      platform: getPlatform(),
    });

    const safety = classifyCommandSafety(finalCommand, getPlatform());
    if (safety.risk === "deny") {
      const executionTimeMs = Date.now() - startTime;
      const error =
        `⛔ COMMAND BLOCKED: "${finalCommand}"\n\n` +
        `This command is blocked by the safety policy and cannot be executed.\n` +
        (safety.reasons.length > 0
          ? `\nReasons:\n- ${safety.reasons.join("\n- ")}\n`
          : "");

      toolExecutionsModel.create({
        tool_name: "executeShellCommandConfirmed",
        input: { command: finalCommand, workingDirectory, userConfirmation },
        output: error,
        success: false,
        error: "Command denied by safety policy",
        execution_time_ms: executionTimeMs,
      });

      return {
        success: false,
        output: "",
        error,
        executionTimeMs,
        platform: getPlatform(),
      };
    }

    try {
      const { stdout, stderr } = await executeCommand(
        finalCommand,
        cwd,
        effectiveTimeoutMs * 2 // Double timeout for dangerous commands
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
export const getShellInfo = tool<any, any>({
  description: `Get information about the current shell environment and platform.
Returns: platform (linux/darwin/win32), shell path, home directory, temp directory, and whether the system is Windows or Unix.
Use this when you need to determine the correct command syntax or paths for the current OS before running shell commands.`,
  inputSchema: z.object({}),
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
