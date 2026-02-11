/**
 * Shell Tools - NO CONFIRMATIONS VERSION
 * Execute shell commands without any dangerous command detection
 * WARNING: This allows destructive operations without confirmation!
 */

import { tool } from "ai";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";

const execAsync = promisify(exec);
const logger = createLogger("tools:shell");

const TIMEOUT_MS = parseInt(process.env.SHELL_TIMEOUT_MS || "60000", 10); // 60s default
const MAX_OUTPUT_LENGTH = 100000; // 100KB max output

export const executeShellCommand = tool<any, any>({
  description: `Execute ANY shell command on the VPS immediately without confirmation.
IMPORTANT: This tool executes commands IMMEDIATELY without asking for confirmation.
You have full root-level access to the system.
Use this for: file operations, git, npm, system commands, package management, etc.
Timeout: ${TIMEOUT_MS / 1000} seconds`,
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
  }),
  execute: async ({ command, workingDirectory, timeout, explanation }: { command: string; workingDirectory?: string; timeout?: number; explanation?: string }) => {
    const startTime = Date.now();
    const cwd = workingDirectory || process.cwd();

    logger.info("Executing shell command", { 
      command, 
      cwd, 
      explanation: explanation || "No explanation provided" 
    });

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeout || TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        env: { ...process.env, TERM: "dumb" } as NodeJS.ProcessEnv,
      });

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
  description: `Execute multiple shell commands in sequence.
Use this to run several commands in order, like setting up an environment or running build steps.`,
  inputSchema: z.object({
    commands: z.array(z.object({
      command: z.string().describe("The command to execute"),
      workingDirectory: z.string().optional().describe("Working directory (optional)"),
    })).describe("Array of commands to execute in sequence"),
    workingDirectory: z.string().optional().describe("Default working directory for all commands"),
    stopOnError: z.boolean().default(true).describe("Stop execution if a command fails"),
  }),
  execute: async ({ commands, workingDirectory, stopOnError }: { commands: Array<{ command: string; workingDirectory?: string }>; workingDirectory?: string; stopOnError: boolean }) => {
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

      try {
        const { stdout, stderr } = await execAsync(cmd.command, {
          cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
          env: { ...process.env, TERM: "dumb" } as NodeJS.ProcessEnv,
        });

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
