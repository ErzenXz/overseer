import { tool } from "ai";
import { z } from "zod";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  copyFileSync,
  renameSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  chmodSync,
  constants,
  accessSync,
} from "fs";
import { join, dirname, basename, extname, resolve, sep, posix, win32, isAbsolute } from "path";
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
      ? process.env.USERPROFILE || process.env.HOMEDRIVE + process.env.HOMEPATH
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
  if (isWindows()) {
    // Windows doesn't have Unix-style permissions
    // Return a simplified version based on what we can determine
    const isReadOnly = !(stats.mode & 0o200);
    return isReadOnly ? "r--" : "rw-";
  }
  return stats.mode.toString(8).slice(-3);
}

export const readFile = tool({
  description: `Read the contents of a file. Use this to view file contents.
Works on: Windows, Linux, macOS
Note: 
- Sensitive files (.env, credentials, keys) will be blocked for security
- Large files will be truncated
- Binary files are not supported
- Handles both Unix (/) and Windows (\\) path formats`,
  parameters: z.object({
    path: z.string().describe("Path to the file to read (supports Unix and Windows formats)"),
    startLine: z.number().optional().describe("Starting line number (1-based, default: 1)"),
    endLine: z.number().optional().describe("Ending line number (default: startLine + 1000)"),
    encoding: z.enum(["utf-8", "ascii", "base64"]).optional().describe("File encoding (default: utf-8)"),
  }),
  execute: async ({ path, startLine = 1, endLine, encoding = "utf-8" }) => {
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

export const writeFile = tool({
  description: `Write content to a file. Creates the file if it doesn't exist, or overwrites if it does.
Works on: Windows, Linux, macOS
Use this to create or modify files.`,
  parameters: z.object({
    path: z.string().describe("Path to the file to write"),
    content: z.string().describe("Content to write to the file"),
    createDirectories: z.boolean().optional().describe("Create parent directories if they don't exist (default: true)"),
    append: z.boolean().optional().describe("Append to file instead of overwriting (default: false)"),
  }),
  execute: async ({ path, content, createDirectories = true, append = false }) => {
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

export const listDirectory = tool({
  description: `List contents of a directory. Shows files and subdirectories with details.
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    path: z.string().describe("Path to the directory to list"),
    showHidden: z.boolean().optional().describe("Include hidden files (starting with .) (default: false)"),
    recursive: z.boolean().optional().describe("List recursively (default: false, max 2 levels)"),
  }),
  execute: async ({ path, showHidden = false, recursive = false }) => {
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

export const fileInfo = tool({
  description: `Get detailed information about a file or directory.
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    path: z.string().describe("Path to the file or directory"),
  }),
  execute: async ({ path }) => {
    const startTime = Date.now();
    const resolvedPath = resolveCrossPlatformPath(path);

    try {
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          info: null,
          error: `Path not found: ${path}`,
          platform: getPlatform(),
        };
      }

      const stats = statSync(resolvedPath);
      const lstats = lstatSync(resolvedPath);
      const isSymlink = lstats.isSymbolicLink();

      let symlinkTarget: string | undefined;
      if (isSymlink) {
        try {
          symlinkTarget = readlinkSync(resolvedPath);
        } catch {
          symlinkTarget = "(unable to read)";
        }
      }

      const info: Record<string, unknown> = {
        path: resolvedPath,
        name: basename(resolvedPath),
        extension: extname(resolvedPath) || null,
        type: stats.isDirectory() ? "directory" : isSymlink ? "symlink" : "file",
        size: formatFileSize(stats.size),
        sizeBytes: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString(),
        permissions: getFilePermissions(stats),
        isReadable: hasReadAccess(resolvedPath),
        isWritable: hasWriteAccess(resolvedPath),
        platform: getPlatform(),
      };

      if (isSymlink) {
        info.symlinkTarget = symlinkTarget;
      }

      // Add Windows-specific info
      if (isWindows()) {
        info.isHidden = basename(resolvedPath).startsWith(".");
      }

      return {
        success: true,
        info,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        info: null,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const createDirectory = tool({
  description: `Create a new directory.
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    path: z.string().describe("Path of the directory to create"),
    recursive: z.boolean().optional().describe("Create parent directories if needed (default: true)"),
  }),
  execute: async ({ path, recursive = true }) => {
    const resolvedPath = resolveCrossPlatformPath(path);

    try {
      if (existsSync(resolvedPath)) {
        return {
          success: false,
          error: `Path already exists: ${path}`,
          platform: getPlatform(),
        };
      }

      mkdirSync(resolvedPath, { recursive });

      toolExecutionsModel.create({
        tool_name: "createDirectory",
        input: { path },
        output: "Directory created",
        success: true,
      });

      return {
        success: true,
        path: resolvedPath,
        message: `Directory created: ${resolvedPath}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const deleteFile = tool({
  description: `Delete a file. Use with caution - this cannot be undone!
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    path: z.string().describe("Path to the file to delete"),
    confirmed: z.boolean().describe("Set to true to confirm deletion"),
  }),
  execute: async ({ path, confirmed }) => {
    const resolvedPath = resolveCrossPlatformPath(path);

    if (!confirmed) {
      return {
        success: false,
        error: `⚠️ Deletion not confirmed. Set 'confirmed: true' to delete "${basename(resolvedPath)}"`,
        requiresConfirmation: true,
        platform: getPlatform(),
      };
    }

    try {
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `File not found: ${path}`,
          platform: getPlatform(),
        };
      }

      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        const deleteCmd = isWindows()
          ? `Use PowerShell: Remove-Item -Recurse -Force "${resolvedPath}"`
          : `Use shell command: rm -r "${resolvedPath}"`;
        return {
          success: false,
          error: `"${path}" is a directory. ${deleteCmd}`,
          platform: getPlatform(),
        };
      }

      unlinkSync(resolvedPath);

      toolExecutionsModel.create({
        tool_name: "deleteFile",
        input: { path },
        output: "File deleted",
        success: true,
      });

      return {
        success: true,
        message: `Deleted: ${resolvedPath}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const copyFile = tool({
  description: `Copy a file to a new location.
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    source: z.string().describe("Path to the source file"),
    destination: z.string().describe("Path to the destination"),
    overwrite: z.boolean().optional().describe("Overwrite if destination exists (default: false)"),
  }),
  execute: async ({ source, destination, overwrite = false }) => {
    const sourcePath = resolveCrossPlatformPath(source);
    const destPath = resolveCrossPlatformPath(destination);

    try {
      if (!existsSync(sourcePath)) {
        return {
          success: false,
          error: `Source file not found: ${source}`,
          platform: getPlatform(),
        };
      }

      if (existsSync(destPath) && !overwrite) {
        return {
          success: false,
          error: `Destination already exists: ${destination}. Set overwrite: true to replace.`,
          platform: getPlatform(),
        };
      }

      // Create destination directory if needed
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      copyFileSync(sourcePath, destPath);

      toolExecutionsModel.create({
        tool_name: "copyFile",
        input: { source, destination },
        output: "File copied",
        success: true,
      });

      return {
        success: true,
        source: sourcePath,
        destination: destPath,
        message: `Copied to ${destPath}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const moveFile = tool({
  description: `Move or rename a file.
Works on: Windows, Linux, macOS`,
  parameters: z.object({
    source: z.string().describe("Path to the source file"),
    destination: z.string().describe("Path to the destination"),
    overwrite: z.boolean().optional().describe("Overwrite if destination exists (default: false)"),
  }),
  execute: async ({ source, destination, overwrite = false }) => {
    const sourcePath = resolveCrossPlatformPath(source);
    const destPath = resolveCrossPlatformPath(destination);

    try {
      if (!existsSync(sourcePath)) {
        return {
          success: false,
          error: `Source not found: ${source}`,
          platform: getPlatform(),
        };
      }

      if (existsSync(destPath) && !overwrite) {
        return {
          success: false,
          error: `Destination already exists: ${destination}. Set overwrite: true to replace.`,
          platform: getPlatform(),
        };
      }

      // Create destination directory if needed
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      renameSync(sourcePath, destPath);

      toolExecutionsModel.create({
        tool_name: "moveFile",
        input: { source, destination },
        output: "File moved",
        success: true,
      });

      return {
        success: true,
        source: sourcePath,
        destination: destPath,
        message: `Moved to ${destPath}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      
      // Handle cross-device moves
      if (err.code === "EXDEV") {
        // Cross-device move: copy then delete
        try {
          copyFileSync(sourcePath, destPath);
          unlinkSync(sourcePath);
          
          return {
            success: true,
            source: sourcePath,
            destination: destPath,
            message: `Moved to ${destPath} (cross-device)`,
            platform: getPlatform(),
          };
        } catch (copyErr: unknown) {
          const copyError = copyErr as { message?: string };
          return {
            success: false,
            error: copyError.message || String(copyErr),
            platform: getPlatform(),
          };
        }
      }
      
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});

export const createSymlink = tool({
  description: `Create a symbolic link.
Works on: Windows (requires admin or developer mode), Linux, macOS`,
  parameters: z.object({
    target: z.string().describe("Path to the target file/directory"),
    linkPath: z.string().describe("Path where the symlink will be created"),
    type: z.enum(["file", "dir"]).optional().describe("Type of symlink (Windows only, default: auto-detect)"),
  }),
  execute: async ({ target, linkPath, type }) => {
    const targetPath = resolveCrossPlatformPath(target);
    const symlinkPath = resolveCrossPlatformPath(linkPath);

    try {
      if (!existsSync(targetPath)) {
        return {
          success: false,
          error: `Target not found: ${target}`,
          platform: getPlatform(),
        };
      }

      if (existsSync(symlinkPath)) {
        return {
          success: false,
          error: `Link path already exists: ${linkPath}`,
          platform: getPlatform(),
        };
      }

      // Determine symlink type for Windows
      let symlinkType: "file" | "dir" | "junction" = "file";
      if (type) {
        symlinkType = type;
      } else {
        const targetStats = statSync(targetPath);
        symlinkType = targetStats.isDirectory() ? "dir" : "file";
      }

      // On Windows, symlinks require elevated privileges or developer mode
      if (isWindows()) {
        symlinkSync(targetPath, symlinkPath, symlinkType);
      } else {
        symlinkSync(targetPath, symlinkPath);
      }

      return {
        success: true,
        target: targetPath,
        link: symlinkPath,
        type: symlinkType,
        message: `Symlink created: ${symlinkPath} -> ${targetPath}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      let errorMessage = err.message || String(error);

      if (isWindows() && err.code === "EPERM") {
        errorMessage = "Creating symlinks on Windows requires administrator privileges or Developer Mode enabled.";
      }

      return {
        success: false,
        error: errorMessage,
        platform: getPlatform(),
      };
    }
  },
});

export const setPermissions = tool({
  description: `Set file permissions (Unix-style chmod, limited on Windows).
Works on: Linux, macOS (full support), Windows (limited - read-only flag only)`,
  parameters: z.object({
    path: z.string().describe("Path to the file"),
    mode: z.string().describe("Permission mode (e.g., '755', '644')"),
  }),
  execute: async ({ path, mode }) => {
    const resolvedPath = resolveCrossPlatformPath(path);

    try {
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `File not found: ${path}`,
          platform: getPlatform(),
        };
      }

      const numericMode = parseInt(mode, 8);
      if (isNaN(numericMode)) {
        return {
          success: false,
          error: `Invalid permission mode: ${mode}. Use octal format like '755' or '644'.`,
          platform: getPlatform(),
        };
      }

      if (isWindows()) {
        // Windows only supports read-only flag through chmod
        // For full control, would need icacls which requires shell execution
        chmodSync(resolvedPath, numericMode);
        
        return {
          success: true,
          path: resolvedPath,
          mode,
          message: `Permissions set (note: Windows has limited chmod support)`,
          platform: getPlatform(),
          note: "For full Windows permission control, use the shell with 'icacls' command.",
        };
      }

      chmodSync(resolvedPath, numericMode);

      return {
        success: true,
        path: resolvedPath,
        mode,
        message: `Permissions set to ${mode}`,
        platform: getPlatform(),
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || String(error),
        platform: getPlatform(),
      };
    }
  },
});
