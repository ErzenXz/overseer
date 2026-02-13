import { tool } from "ai";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";

const execFileAsync = promisify(execFile);
const logger = createLogger("tools:search");

const MAX_OUTPUT = 50_000;

export const searchCodebase = tool({
  description: `Search the codebase using ripgrep (rg) and return matches.

WHEN TO USE:
- You need to find where something is implemented (routes, configs, tools, etc.).
- You want a fast, structured search without writing ad-hoc shell pipelines.

NOTES:
- This tool requires \`rg\` to be installed (it is commonly available).
- Output is truncated to keep responses manageable.`,
  inputSchema: z.object({
    query: z.string().describe("Search pattern (ripgrep syntax)"),
    path: z
      .string()
      .optional()
      .describe("Path to search (default: current working directory)"),
    glob: z
      .string()
      .optional()
      .describe("Optional glob filter, e.g. '*.ts' or 'src/**'"),
    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("Maximum matches to return (default: 200)"),
    contextLines: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Context lines before/after each match (default: 0)"),
    caseSensitive: z
      .boolean()
      .optional()
      .describe("Case sensitive search (default: false)"),
  }),
  execute: async ({
    query,
    path,
    glob,
    maxMatches = 200,
    contextLines = 0,
    caseSensitive = false,
  }: {
    query: string;
    path?: string;
    glob?: string;
    maxMatches?: number;
    contextLines?: number;
    caseSensitive?: boolean;
  }) => {
    const startTime = Date.now();
    const cwd = path || process.cwd();

    const args: string[] = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      String(maxMatches),
    ];

    if (!caseSensitive) args.push("-i");
    if (contextLines > 0) args.push("-C", String(contextLines));
    if (glob) args.push("--glob", glob);

    args.push(query, cwd);

    logger.info("Searching codebase", { query, cwd, glob, maxMatches });

    try {
      const { stdout, stderr } = await execFileAsync("rg", args, {
        maxBuffer: 10 * 1024 * 1024,
      });

      let output = (stdout || stderr || "").trim();
      if (!output) output = "(no matches)";
      if (output.length > MAX_OUTPUT) {
        output =
          output.slice(0, MAX_OUTPUT) +
          `\n\n... (truncated, ${output.length - MAX_OUTPUT} bytes omitted)`;
      }

      const executionTimeMs = Date.now() - startTime;
      toolExecutionsModel.create({
        tool_name: "searchCodebase",
        input: { query, path: cwd, glob, maxMatches, contextLines, caseSensitive },
        output: output.slice(0, 5000),
        success: true,
        execution_time_ms: executionTimeMs,
      });

      return { success: true, output, executionTimeMs };
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;
      const message =
        typeof error?.message === "string"
          ? error.message
          : "Search failed";

      toolExecutionsModel.create({
        tool_name: "searchCodebase",
        input: { query, path: cwd, glob, maxMatches, contextLines, caseSensitive },
        output: undefined,
        success: false,
        error: message,
        execution_time_ms: executionTimeMs,
      });

      return { success: false, output: "", error: message, executionTimeMs };
    }
  },
});

