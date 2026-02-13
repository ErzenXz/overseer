/**
 * Shell Tools - NO CONFIRMATIONS VERSION
 * Execute shell commands without any dangerous command detection
 * WARNING: This allows destructive operations without confirmation!
 */

import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";
import { classifyCommandSafety } from "../../lib/command-safety";

const execAsync = promisify(exec);
const logger = createLogger("tools:shell");

const TIMEOUT_MS = parseInt(process.env.SHELL_TIMEOUT_MS || "60000", 10); // 60s default
const MAX_OUTPUT_LENGTH = 100000; // 100KB max output
const ALLOW_UNSAFE = (process.env.ALLOW_UNSAFE_NOCONFIRM_SHELL || "").toLowerCase() === "true";

/**
 * Execute a command, optionally piping stdinInput via spawn.
 */
async function executeCommandNoConfirm(
  command: string,
  cwd: string,
  timeout: number,
  stdinInput?: string
): Promise<{ stdout: string; stderr: string }> {
  // If stdin input is provided, use spawn to pipe it
  if (stdinInput !== undefined) {
    return new Promise((resolve, reject) => {
      const shellCmd = process.env.SHELL || "/bin/bash";
      const shellArgs = ["-c", command];
      const spawnEnv = { ...process.env, TERM: "dumb", DEBIAN_FRONTEND: "noninteractive" };

      const child = spawn(shellCmd, shellArgs, {
        cwd,
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

  // Default: use exec
  return execAsync(command, {
    cwd,
    timeout,
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    env: { ...process.env, TERM: "dumb", CI: "true", DEBIAN_FRONTEND: "noninteractive" } as NodeJS.ProcessEnv,
  });
}

export const executeShellCommand = tool<any, any>({
  description: `Execute ANY shell command on the VPS immediately without confirmation or dangerous-command checks.

WARNING: This tool executes commands IMMEDIATELY — including destructive ones (rm -rf, drop database, etc.) — without asking for confirmation. Use responsibly.

WHEN TO USE:
- Use for all shell operations: git, npm, system commands, package management, builds, deployments, Docker, etc.
- This is the primary tool for interacting with the VPS. You have full system access.
- Timeout: ${TIMEOUT_MS / 1000} seconds (set a higher custom timeout for builds/downloads).
- Max output: ${MAX_OUTPUT_LENGTH / 1000}KB.

COMMON PATTERNS:
- Package management: "apt-get install -y nginx", "npm install", "pip install -r requirements.txt"
- Service management: "systemctl restart nginx", "pm2 restart all"
- Git: "git pull origin main", "git log --oneline -10"
- Docker: "docker-compose up -d", "docker ps", "docker logs <container>"
- Monitoring: "htop -n 1", "df -h", "free -m", "journalctl -u myapp --since '1h ago'"
- Networking: "curl -I https://example.com", "ss -tlnp", "dig example.com"

ENVIRONMENT:
- Commands run with CI=true and DEBIAN_FRONTEND=noninteractive to suppress interactive prompts.
- ALWAYS prefer non-interactive flags: --yes, -y, --default, --no-input, --non-interactive.

INTERACTIVE COMMANDS:
- If a command requires user input and has no non-interactive flag, provide answers via the "stdin" parameter as newline-separated values.
- Example: stdin: "my-project\\nTypeScript\\n"
- The stdin input is written to the command's stdin and then stdin is closed.`,
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute immediately"),
    workingDirectory: z
      .string()
      .optional()
      .describe("Working directory for the command (default: current directory)"),
    timeout: z
      .number()
      .optional()
      .describe(`Timeout in milliseconds (default: ${TIMEOUT_MS})`),
    explanation: z
      .string()
      .optional()
      .describe("Brief explanation of what this command does (for logging)"),
    stdin: z.string().optional().describe(
      "Input to pipe to the command's stdin. Use this for interactive commands that prompt for input. " +
      "Provide answers separated by newlines (\\n). " +
      "Example: for a CLI that asks name then language, use 'my-project\\nTypeScript\\n'. " +
      "PREFER using non-interactive flags (--yes, -y, --default) when available instead of stdin."
    ),
  }),
  execute: async ({ command, workingDirectory, timeout, explanation, stdin }: { command: string; workingDirectory?: string; timeout?: number; explanation?: string; stdin?: string }) => {
    const startTime = Date.now();
    const cwd = workingDirectory || process.cwd();

    const safety = classifyCommandSafety(command, process.platform);
    if (safety.risk === "deny") {
      const executionTimeMs = Date.now() - startTime;
      const error =
        `⛔ COMMAND BLOCKED: "${command}"\n\n` +
        `This command matches a high-risk pattern and is blocked.\n` +
        (safety.reasons.length > 0
          ? `\nReasons:\n- ${safety.reasons.join("\n- ")}\n`
          : "");

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command, workingDirectory, explanation },
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
        command,
      };
    }

    if (safety.risk === "confirm" && !ALLOW_UNSAFE) {
      const executionTimeMs = Date.now() - startTime;
      const error =
        `⚠️ CONFIRMATION REQUIRED: "${command}"\n\n` +
        `This no-confirmation shell tool is locked down by default.\n` +
        `Use executeShellCommand (safe) first, or set ALLOW_UNSAFE_NOCONFIRM_SHELL=true if you really want this tool to run destructive commands.\n` +
        (safety.reasons.length > 0
          ? `\nWhy it was flagged:\n- ${safety.reasons.join("\n- ")}\n`
          : "");

      toolExecutionsModel.create({
        tool_name: "executeShellCommand",
        input: { command, workingDirectory, explanation },
        output: error,
        success: false,
        error: "Unsafe no-confirmation command blocked",
        execution_time_ms: executionTimeMs,
      });

      return {
        success: false,
        output: "",
        error,
        executionTimeMs,
        command,
      };
    }

    logger.info("Executing shell command", { 
      command, 
      cwd, 
      explanation: explanation || "No explanation provided",
      hasStdin: !!stdin,
    });

    try {
      const { stdout, stderr } = await executeCommandNoConfirm(
        command,
        cwd,
        timeout || TIMEOUT_MS,
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
        input: { command, workingDirectory, explanation },
        output: output.substring(0, 5000),
        success: true,
        execution_time_ms: executionTimeMs,
      });

      logger.info("Command executed successfully", {
        command,
        executionTimeMs,
        outputLength: output.length,
      });

      return {
        success: true,
        output: output || "(no output)",
        executionTimeMs,
        command,
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
        input: { command, workingDirectory, explanation },
        output: undefined,
        success: false,
        error: errorMessage,
        execution_time_ms: executionTimeMs,
      });

      logger.error("Command execution failed", {
        command,
        error: errorMessage,
        executionTimeMs,
      });

      return {
        success: false,
        output: err.stderr || "",
        error: errorMessage,
        executionTimeMs,
        command,
      };
    }
  },
});

export const executeMultipleCommands = tool<any, any>({
  description: `Execute multiple shell commands in sequence, optionally stopping on the first failure.

WHEN TO USE:
- Use for multi-step workflows: environment setup, build pipelines, deployment sequences.
- Each command runs in its own shell invocation but can share a working directory.
- Set stopOnError: false to continue executing remaining commands even if one fails (useful for cleanup scripts).

EXAMPLES:
- Build pipeline: ["npm ci", "npm run lint", "npm run test", "npm run build"]
- Deployment: ["git pull origin main", "npm ci --production", "pm2 restart all"]
- Setup: ["apt-get update", "apt-get install -y nginx certbot", "systemctl enable nginx"]

INTERACTIVE COMMANDS:
- Each command can include its own "stdin" field for interactive prompts.
- ALWAYS prefer non-interactive flags (--yes, -y, --default) when available.`,
  inputSchema: z.object({
    commands: z.array(z.object({
      command: z.string().describe("The command to execute"),
      workingDirectory: z.string().optional().describe("Working directory (optional)"),
      stdin: z.string().optional().describe(
        "Input to pipe to the command's stdin. Use for interactive commands. " +
        "Provide answers separated by newlines (\\n)."
      ),
    })).describe("Array of commands to execute in sequence"),
    workingDirectory: z.string().optional().describe("Default working directory for all commands"),
    stopOnError: z.boolean().default(true).describe("Stop execution if a command fails"),
  }),
  execute: async ({ commands, workingDirectory, stopOnError }: { commands: Array<{ command: string; workingDirectory?: string; stdin?: string }>; workingDirectory?: string; stopOnError: boolean }) => {
    const startTime = Date.now();
    const results: Array<{
      command: string;
      success: boolean;
      output: string;
      error?: string;
      executionTimeMs: number;
    }> = [];

    logger.info("Executing multiple commands", { count: commands.length });

    for (const cmd of commands) {
      const cmdStartTime = Date.now();
      const cwd = cmd.workingDirectory || workingDirectory || process.cwd();

      const safety = classifyCommandSafety(cmd.command, process.platform);
      if (safety.risk === "deny" || (safety.risk === "confirm" && !ALLOW_UNSAFE)) {
        const cmdExecutionTime = Date.now() - cmdStartTime;
        const error =
          safety.risk === "deny"
            ? `Command denied by safety policy`
            : `Unsafe command blocked in no-confirmation mode (set ALLOW_UNSAFE_NOCONFIRM_SHELL=true to override)`;

        results.push({
          command: cmd.command,
          success: false,
          output: "",
          error:
            `${error}\n` +
            (safety.reasons.length > 0
              ? `Reasons:\n- ${safety.reasons.join("\n- ")}`
              : ""),
          executionTimeMs: cmdExecutionTime,
        });

        logger.warn("Blocked command in executeMultipleCommands", {
          command: cmd.command,
          risk: safety.risk,
          reasons: safety.reasons,
        });

        if (stopOnError) break;
        continue;
      }

      try {
        const { stdout, stderr } = await executeCommandNoConfirm(
          cmd.command,
          cwd,
          TIMEOUT_MS,
          cmd.stdin
        );

        let output = stdout || "";
        if (stderr) {
          output += "\n--- stderr ---\n" + stderr;
        }

        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.substring(0, MAX_OUTPUT_LENGTH) + "\n\n... (truncated)";
        }

        const cmdExecutionTime = Date.now() - cmdStartTime;

        results.push({
          command: cmd.command,
          success: true,
          output: output || "(no output)",
          executionTimeMs: cmdExecutionTime,
        });

        logger.info(`Command succeeded: ${cmd.command.substring(0, 50)}...`);
      } catch (error: unknown) {
        const cmdExecutionTime = Date.now() - cmdStartTime;
        const err = error as { message?: string; stderr?: string };
        
        results.push({
          command: cmd.command,
          success: false,
          output: err.stderr || "",
          error: err.message || String(error),
          executionTimeMs: cmdExecutionTime,
        });

        logger.error(`Command failed: ${cmd.command.substring(0, 50)}...`, { error: err.message });

        if (stopOnError) {
          break;
        }
      }
    }

    const totalExecutionTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;

    toolExecutionsModel.create({
      tool_name: "executeMultipleCommands",
      input: { commands, workingDirectory, stopOnError },
      output: JSON.stringify(results.map(r => ({ command: r.command, success: r.success }))),
      success: successCount === commands.length,
      execution_time_ms: totalExecutionTime,
    });

    return {
      success: successCount === commands.length,
      results,
      totalExecutionTimeMs: totalExecutionTime,
      succeeded: successCount,
      failed: results.length - successCount,
    };
  },
});
