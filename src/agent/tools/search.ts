import { tool } from "ai";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, join, basename } from "path";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";

const execAsync = promisify(exec);
const logger = createLogger("tools:search");

const MAX_RESULTS = 100;

export const searchFiles = tool({
  description: `Search for files by name pattern using find or glob patterns.`,
  parameters: z.object({
    directory: z.string().optional().describe("Directory to search in (default: current directory)"),
    pattern: z.string().describe("File name pattern (supports wildcards: *, ?)"),
    type: z.enum(["file", "directory", "all"]).optional().describe("Type of items to find (default: all)"),
    maxDepth: z.number().optional().describe("Maximum directory depth (default: 10)"),
  }),
  execute: async ({ directory, pattern, type = "all", maxDepth = 10 }) => {
    const searchDir = resolve(directory || process.cwd());

    try {
      let typeFlag = "";
      if (type === "file") typeFlag = "-type f";
      if (type === "directory") typeFlag = "-type d";

      const command = `find "${searchDir}" -maxdepth ${maxDepth} ${typeFlag} -name "${pattern}" 2>/dev/null | head -n ${MAX_RESULTS}`;
      const { stdout } = await execAsync(command, { timeout: 30000 });

      const results = stdout.trim().split("\n").filter(Boolean);

      toolExecutionsModel.create({
        tool_name: "searchFiles",
        input: { directory, pattern, type },
        output: `Found ${results.length} results`,
        success: true,
      });

      return {
        success: true,
        searchDirectory: searchDir,
        pattern,
        results,
        count: results.length,
        truncated: results.length >= MAX_RESULTS,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
      };
    }
  },
});

export const searchInFiles = tool({
  description: `Search for text content within files using grep.`,
  parameters: z.object({
    directory: z.string().optional().describe("Directory to search in"),
    pattern: z.string().describe("Text or regex pattern to search for"),
    filePattern: z.string().optional().describe("File name pattern to limit search (e.g., '*.ts')"),
    caseSensitive: z.boolean().optional().describe("Case sensitive search (default: false)"),
    showContext: z.number().optional().describe("Lines of context to show (default: 0)"),
  }),
  execute: async ({ directory, pattern, filePattern, caseSensitive = false, showContext = 0 }) => {
    const searchDir = resolve(directory || process.cwd());

    try {
      let command = "grep";
      command += caseSensitive ? " " : " -i";
      command += " -r";
      command += " -n"; // Show line numbers
      if (showContext > 0) command += ` -C ${showContext}`;
      
      // Escape pattern for shell
      const escapedPattern = pattern.replace(/"/g, '\\"');
      command += ` "${escapedPattern}"`;
      
      if (filePattern) {
        command += ` --include="${filePattern}"`;
      }
      
      command += ` "${searchDir}"`;
      command += ` 2>/dev/null | head -n ${MAX_RESULTS}`;

      const { stdout } = await execAsync(command, { timeout: 60000 });

      const results = stdout.trim().split("\n").filter(Boolean);

      // Parse results
      const matches = results.map((line) => {
        const colonIndex = line.indexOf(":");
        const secondColonIndex = line.indexOf(":", colonIndex + 1);
        if (colonIndex > 0 && secondColonIndex > colonIndex) {
          return {
            file: line.substring(0, colonIndex),
            line: parseInt(line.substring(colonIndex + 1, secondColonIndex)),
            content: line.substring(secondColonIndex + 1).trim(),
          };
        }
        return { raw: line };
      });

      toolExecutionsModel.create({
        tool_name: "searchInFiles",
        input: { directory, pattern, filePattern },
        output: `Found ${matches.length} matches`,
        success: true,
      });

      return {
        success: true,
        searchDirectory: searchDir,
        pattern,
        matches,
        count: matches.length,
        truncated: results.length >= MAX_RESULTS,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; stdout?: string };
      // grep returns exit code 1 when no matches found
      if (err.stdout !== undefined) {
        return {
          success: true,
          searchDirectory: searchDir,
          pattern,
          matches: [],
          count: 0,
          message: "No matches found",
        };
      }
      return {
        success: false,
        error: err.message || String(error),
      };
    }
  },
});

export const replaceInFile = tool({
  description: `Find and replace text in a file using sed.`,
  parameters: z.object({
    file: z.string().describe("Path to the file"),
    search: z.string().describe("Text to search for"),
    replace: z.string().describe("Text to replace with"),
    all: z.boolean().optional().describe("Replace all occurrences (default: true)"),
    backup: z.boolean().optional().describe("Create a backup file (default: true)"),
  }),
  execute: async ({ file, search, replace, all = true, backup = true }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${file}`,
      };
    }

    try {
      // Read file to count occurrences
      const content = readFileSync(filePath, "utf-8");
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), all ? "g" : "");
      const matches = content.match(regex);
      const matchCount = matches?.length || 0;

      if (matchCount === 0) {
        return {
          success: true,
          message: "No matches found - file unchanged",
          matchCount: 0,
        };
      }

      // Escape for sed
      const escapedSearch = search.replace(/[\/&]/g, "\\$&");
      const escapedReplace = replace.replace(/[\/&]/g, "\\$&");
      
      const globalFlag = all ? "g" : "";
      const backupExt = backup ? ".bak" : "";
      
      const command = `sed -i${backupExt} 's/${escapedSearch}/${escapedReplace}/${globalFlag}' "${filePath}"`;
      
      await execAsync(command, { timeout: 30000 });

      toolExecutionsModel.create({
        tool_name: "replaceInFile",
        input: { file, search, replace, matchCount },
        output: `Replaced ${matchCount} occurrences`,
        success: true,
      });

      return {
        success: true,
        file: filePath,
        matchCount,
        message: `Replaced ${matchCount} occurrence(s)`,
        backupCreated: backup,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
      };
    }
  },
});

export const countLines = tool({
  description: `Count lines, words, and characters in a file.`,
  parameters: z.object({
    path: z.string().describe("Path to the file"),
  }),
  execute: async ({ path }) => {
    const filePath = resolve(path);

    if (!existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${path}`,
      };
    }

    try {
      const { stdout } = await execAsync(`wc "${filePath}"`, { timeout: 10000 });
      const parts = stdout.trim().split(/\s+/);
      
      return {
        success: true,
        file: filePath,
        lines: parseInt(parts[0]) || 0,
        words: parseInt(parts[1]) || 0,
        characters: parseInt(parts[2]) || 0,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
      };
    }
  },
});

export const headTail = tool({
  description: `View the first or last lines of a file.`,
  parameters: z.object({
    path: z.string().describe("Path to the file"),
    mode: z.enum(["head", "tail"]).describe("View first (head) or last (tail) lines"),
    lines: z.number().optional().describe("Number of lines (default: 10)"),
    follow: z.boolean().optional().describe("Follow file for new content (tail -f) - runs for 5 seconds"),
  }),
  execute: async ({ path, mode, lines = 10, follow = false }) => {
    const filePath = resolve(path);

    if (!existsSync(filePath)) {
      return {
        success: false,
        error: `File not found: ${path}`,
      };
    }

    try {
      let command = mode === "head" ? `head -n ${lines}` : `tail -n ${lines}`;
      
      if (follow && mode === "tail") {
        // Follow for 5 seconds then stop
        command = `timeout 5 tail -f -n ${lines} "${filePath}" || tail -n ${lines} "${filePath}"`;
      } else {
        command += ` "${filePath}"`;
      }

      const { stdout } = await execAsync(command, { timeout: 10000 });

      return {
        success: true,
        file: filePath,
        mode,
        lines: lines,
        content: stdout.trim(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
      };
    }
  },
});
