import { tool } from "ai";
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdirSync,
  lstatSync,
  constants,
  accessSync,
} from "fs";
import { join, dirname, basename, resolve } from "path";
import { toolExecutionsModel } from "../../database/index";
import { createLogger } from "../../lib/logger";
import {
  isWindows,
  normalizePath,
  toPosixPath,
  getPlatform,
} from "../../lib/platform";

const logger = createLogger("tools:files");

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10) * 1024 * 1024;
const MAX_READ_LINES = 1000;

// Files that should never be exposed
const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /credentials?\.(json|yaml|yml)$/i,
  /secrets?\.(json|yaml|yml)$/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa$/,
  /id_ed25519$/,
  /\.ssh[/\\]config$/,
];

function isSensitiveFile(filePath: string): boolean {
  const filename = basename(filePath);
  const normalizedPath = toPosixPath(filePath);
  return SENSITIVE_PATTERNS.some(
    (pattern) => pattern.test(filename) || pattern.test(normalizedPath)
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Resolve a path handling both Unix and Windows formats
 */
function resolveCrossPlatformPath(inputPath: string): string {
  // Handle Windows UNC paths
  if (inputPath.startsWith("\\\\")) {
    return inputPath;
  }

  // Handle Windows drive letters (C:\, D:\, etc.)
  if (/^[A-Za-z]:/.test(inputPath)) {
    return normalizePath(inputPath);
  }

  // Handle absolute Unix paths on non-Windows
  if (inputPath.startsWith("/") && !isWindows()) {
    return resolve(inputPath);
  }

  // Handle home directory expansion
  if (inputPath.startsWith("~")) {
    const homeDir = isWindows()
      ? process.env.USERPROFILE || ((process.env.HOMEDRIVE ?? "") + (process.env.HOMEPATH ?? ""))
      : process.env.HOME;
    if (homeDir) {
      return resolve(join(homeDir, inputPath.slice(1)));
    }
  }

  // Regular path resolution
  return resolve(inputPath);
}

/**
 * Check if we have read access to a file
 */
function hasReadAccess(filePath: string): boolean {
  try {
    accessSync(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if we have write access to a file/directory
 */
function hasWriteAccess(filePath: string): boolean {
  try {
    accessSync(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file permissions in a cross-platform way
 */
function getFilePermissions(stats: ReturnType<typeof statSync>): string {
  if (!stats) return "???";
  if (isWindows()) {
    // Windows doesn't have Unix-style permissions
    // Return a simplified version based on what we can determine
    const mode = stats.mode;
    if (typeof mode !== "number") return "???";
    const isReadOnly = !(mode & 0o200);
    return isReadOnly ? "r--" : "rw-";
  }
  const mode = stats.mode;
  if (typeof mode !== "number") return "???";
  return mode.toString(8).slice(-3);
}

// Define schema separately for proper type inference
const readFileSchema = z.object({
  path: z.string().describe("Path to the file to read (supports Unix and Windows formats)"),
  startLine: z.number().optional().describe("Starting line number (1-based, default: 1)"),
  endLine: z.number().optional().describe("Ending line number (default: startLine + 1000)"),
  encoding: z.enum(["utf-8", "ascii", "base64"]).optional().describe("File encoding (default: utf-8)"),
});

type ReadFileInput = z.infer<typeof readFileSchema>;

export const readFile = tool<any, any>({
  description: `Read the contents of a file. Use this to view file contents.
Works on: Windows, Linux, macOS
Note:
- Sensitive files (.env, credentials, keys) will be blocked for security
- Large files will be truncated
- Binary files are not supported
- Handles both Unix (/) and Windows (\\) path formats`,
  inputSchema: readFileSchema,
  execute: async ({ path, startLine = 1, endLine, encoding = "utf-8" }: ReadFileInput) => {
    const startTime = Date.now();
    const resolvedPath = resolveCrossPlatformPath(path);

    logger.info("Reading file", { path: resolvedPath, platform: getPlatform() });

    // Check for sensitive files
    if (isSensitiveFile(resolvedPath)) {
      const result = {
        success: false,
        content: null,
        error: `🔒 Access denied: "${basename(resolvedPath)}" appears to be a sensitive file (credentials, keys, etc.). For security, I cannot read this file.`,
      };

      toolExecutionsModel.create({
        tool_name: "readFile",
        input: { path },
        success: false,
        error: "Sensitive file blocked",
        execution_time_ms: Date.now() - startTime,
      });

      return result;
    }

    try {
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          content: null,
          error: `File not found: ${path}`,
          platform: getPlatform(),
        };
      }

      const stats = statSync(resolvedPath);

      if (stats.isDirectory()) {
        return {
          success: false,
          content: null,
          error: `"${path}" is a directory, not a file. Use listDirectory instead.`,
          platform: getPlatform(),
        };
      }

      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          content: null,
          error: `File is too large (${formatFileSize(stats.size)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`,
          platform: getPlatform(),
        };
      }

      const content = readFileSync(resolvedPath, encoding as BufferEncoding);
      const lines = content.split("\n");
      const totalLines = lines.length;

      // Apply line range
      const start = Math.max(0, startLine - 1);
      const end = endLine ? Math.min(lines.length, endLine) : Math.min(lines.length, start + MAX_READ_LINES);
      const selectedLines = lines.slice(start, end);

      let output = selectedLines.join("\n");
      let truncated = false;

      if (end < totalLines) {
        truncated = true;
        output += `\n\n... (showing lines ${startLine}-${end} of ${totalLines} total)`;
      }

      toolExecutionsModel.create({
        tool_name: "readFile",
        input: { path, startLine, endLine },
        output: `Read ${selectedLines.length} lines`,
        success: true,
        execution_time_ms: Date.now() - startTime,
      });

      return {
        success: true,
        content: output,
        path: resolvedPath,
        totalLines,
        linesShown: selectedLines.length,
        truncated,
        fileSize: formatFileSize(stats.size),
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      let errorMessage = err.message || String(error);
      
      // Provide helpful error messages for common issues
      if (err.code === "EACCES") {
        errorMessage = `Permission denied: Cannot read "${basename(resolvedPath)}"`;
      } else if (err.code === "ENOENT") {
        errorMessage = `File not found: ${path}`;
      }

      toolExecutionsModel.create({
        tool_name: "readFile",
        input: { path },
        success: false,
        error: errorMessage,
        execution_time_ms: Date.now() - startTime,
      });

      return {
        success: false,
        content: null,
        error: errorMessage,
        platform: getPlatform(),
      };
    }
  },
});

// Define schema separately for proper type inference
const writeFileSchema = z.object({
  path: z.string().describe("Path to the file to write"),
  content: z.string().describe("Content to write to the file"),
  createDirectories: z.boolean().optional().describe("Create parent directories if they don't exist (default: true)"),
  append: z.boolean().optional().describe("Append to file instead of overwriting (default: false)"),
});

type WriteFileInput = z.infer<typeof writeFileSchema>;

export const writeFile = tool<any, any>({
  description: `Write content to a file. Creates the file if it doesn't exist, or overwrites if it does.
Works on: Windows, Linux, macOS
Use this to create or modify files.`,
  inputSchema: writeFileSchema,
  execute: async ({ path, content, createDirectories = true, append = false }: WriteFileInput) => {
    const startTime = Date.now();
    const resolvedPath = resolveCrossPlatformPath(path);

    logger.info("Writing file", { path: resolvedPath, append, platform: getPlatform() });

    // Check for sensitive files
    if (isSensitiveFile(resolvedPath)) {
      return {
        success: false,
        error: `🔒 Cannot write to sensitive file: "${basename(resolvedPath)}". Please handle credentials manually.`,
        platform: getPlatform(),
      };
    }

    try {
      // Create directories if needed
      if (createDirectories) {
        const dir = dirname(resolvedPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }

      const existedBefore = existsSync(resolvedPath);

      if (append && existedBefore) {
        const existing = readFileSync(resolvedPath, "utf-8");
        writeFileSync(resolvedPath, existing + content, "utf-8");
      } else {
        writeFileSync(resolvedPath, content, "utf-8");
      }

      toolExecutionsModel.create({
        tool_name: "writeFile",
        input: { path, contentLength: content.length, append },
        output: `Wrote ${content.length} bytes`,
        success: true,
        execution_time_ms: Date.now() - startTime,
      });

      return {
        success: true,
        path: resolvedPath,
        bytesWritten: content.length,
        action: existedBefore ? (append ? "appended" : "overwritten") : "created",
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      let errorMessage = err.message || String(error);

      if (err.code === "EACCES") {
        errorMessage = `Permission denied: Cannot write to "${basename(resolvedPath)}"`;
      } else if (err.code === "ENOENT") {
        errorMessage = `Parent directory does not exist. Set createDirectories: true to create it.`;
      } else if (err.code === "EROFS") {
        errorMessage = `Read-only file system: Cannot write to "${basename(resolvedPath)}"`;
      }

      toolExecutionsModel.create({
        tool_name: "writeFile",
        input: { path },
        success: false,
        error: errorMessage,
        execution_time_ms: Date.now() - startTime,
      });

      return {
        success: false,
        error: errorMessage,
        platform: getPlatform(),
      };
    }
  },
});

// Define schema separately for proper type inference
const listDirectorySchema = z.object({
  path: z.string().describe("Path to the directory to list"),
  showHidden: z.boolean().optional().describe("Include hidden files (starting with .) (default: false)"),
  recursive: z.boolean().optional().describe("List recursively (default: false, max 2 levels)"),
});

type ListDirectoryInput = z.infer<typeof listDirectorySchema>;

export const listDirectory = tool<any, any>({
  description: `List contents of a directory. Shows files and subdirectories with details.
Works on: Windows, Linux, macOS`,
  inputSchema: listDirectorySchema,
  execute: async ({ path, showHidden = false, recursive = false }: ListDirectoryInput) => {
    const startTime = Date.now();
    const resolvedPath = resolveCrossPlatformPath(path);

    logger.info("Listing directory", { path: resolvedPath, platform: getPlatform() });

    try {
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          entries: null,
          error: `Directory not found: ${path}`,
          platform: getPlatform(),
        };
      }

      const stats = statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          entries: null,
          error: `"${path}" is not a directory`,
          platform: getPlatform(),
        };
      }

      interface Entry {
        name: string;
        type: "file" | "directory" | "symlink";
        size?: string;
        modified?: string;
        permissions?: string;
        children?: Entry[];
      }

      function listDir(dirPath: string, depth = 0): Entry[] {
        const items = readdirSync(dirPath, { withFileTypes: true });
        const entries: Entry[] = [];

        for (const item of items) {
          // Handle hidden files
          if (!showHidden && item.name.startsWith(".")) continue;
          // On Windows, also skip system hidden files if not showing hidden
          if (!showHidden && isWindows()) {
            // Could check for hidden attribute, but for now just skip dot files
          }

          const itemPath = join(dirPath, item.name);
          
          let itemType: "file" | "directory" | "symlink" = "file";
          let isSymlink = false;

          try {
            const lstats = lstatSync(itemPath);
            isSymlink = lstats.isSymbolicLink();
            
            if (isSymlink) {
              itemType = "symlink";
            } else if (item.isDirectory()) {
              itemType = "directory";
            }
          } catch {
            // If we can't lstat, use the dirent info
            itemType = item.isDirectory() ? "directory" : item.isSymbolicLink() ? "symlink" : "file";
          }

          const entry: Entry = {
            name: item.name,
            type: itemType,
          };

          try {
            const itemStats = statSync(itemPath);
            entry.size = !item.isDirectory() ? formatFileSize(itemStats.size) : undefined;
            entry.modified = itemStats.mtime.toISOString();
            entry.permissions = getFilePermissions(itemStats);
          } catch {
            // Skip items we can't stat
          }

          if (recursive && item.isDirectory() && depth < 2) {
            try {
              entry.children = listDir(itemPath, depth + 1);
            } catch {
              // Skip directories we can't read
            }
          }

          entries.push(entry);
        }

        // Sort: directories first, then alphabetically
        return entries.sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });
      }

      const entries = listDir(resolvedPath);

      toolExecutionsModel.create({
        tool_name: "listDirectory",
        input: { path, showHidden, recursive },
        output: `Listed ${entries.length} entries`,
        success: true,
        execution_time_ms: Date.now() - startTime,
      });

      return {
        success: true,
        path: resolvedPath,
        entries,
        count: entries.length,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      let errorMessage = err.message || String(error);

      if (err.code === "EACCES") {
        errorMessage = `Permission denied: Cannot list "${basename(resolvedPath)}"`;
      }

      toolExecutionsModel.create({
        tool_name: "listDirectory",
        input: { path },
        success: false,
        error: errorMessage,
        execution_time_ms: Date.now() - startTime,
      });

      return {
        success: false,
        entries: null,
        error: errorMessage,
        platform: getPlatform(),
      };
    }
  },
});
