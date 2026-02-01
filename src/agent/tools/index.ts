// Shell tools
export { executeShellCommand, executeShellCommandConfirmed, getShellInfo } from "./shell";

// File tools
export {
  readFile,
  writeFile,
  listDirectory,
  fileInfo,
  createDirectory,
  deleteFile,
  copyFile,
  moveFile,
  createSymlink,
  setPermissions,
} from "./files";

// Git tools
export {
  gitStatus,
  gitLog,
  gitDiff,
  gitBranch,
  gitAdd,
  gitCommit,
  gitPull,
  gitPush,
  gitClone,
  gitStash,
} from "./git";

// System tools
export {
  systemInfo,
  processInfo,
  killProcess,
  networkInfo,
  ping,
  curl,
  environmentVariables,
  serviceInfo,
  platformInfo,
} from "./system";

// Search tools
export {
  searchFiles,
  searchInFiles,
  replaceInFile,
  countLines,
  headTail,
} from "./search";

// Platform-specific command tools (cross-platform)
export {
  listProcesses,
  killProcessByPidOrName,
  listServices,
  manageService,
  networkInfo as platformNetworkInfo,
  diskUsage,
  memoryUsage,
  cpuInfo,
  findFiles,
  searchInFiles as platformSearchInFiles,
} from "./platform-commands";

// Sub-agent tools
export { spawnSubAgent, checkSubAgentStatus } from "./subagent-tool";

// All tools in a single object
import { executeShellCommand, executeShellCommandConfirmed, getShellInfo } from "./shell";
import {
  readFile,
  writeFile,
  listDirectory,
  fileInfo,
  createDirectory,
  deleteFile,
  copyFile,
  moveFile,
  createSymlink,
  setPermissions,
} from "./files";
import {
  gitStatus,
  gitLog,
  gitDiff,
  gitBranch,
  gitAdd,
  gitCommit,
  gitPull,
  gitPush,
  gitClone,
  gitStash,
} from "./git";
import {
  systemInfo,
  processInfo,
  killProcess,
  networkInfo,
  ping,
  curl,
  environmentVariables,
  serviceInfo,
  platformInfo,
} from "./system";
import {
  searchFiles,
  searchInFiles,
  replaceInFile,
  countLines,
  headTail,
} from "./search";
import {
  listProcesses,
  killProcessByPidOrName,
  listServices,
  manageService,
  diskUsage,
  memoryUsage,
  cpuInfo,
  findFiles,
} from "./platform-commands";
import { spawnSubAgent, checkSubAgentStatus } from "./subagent-tool";

// Import MCP and Skills for combined tools
import { getAllMCPTools } from "../mcp/client";
import { getAllActiveSkillTools } from "../skills/registry";
import type { Tool } from "ai";

/**
 * Built-in tools - always available
 */
export const allTools = {
  // Shell
  executeShellCommand,
  executeShellCommandConfirmed,
  getShellInfo,
  
  // Files
  readFile,
  writeFile,
  listDirectory,
  fileInfo,
  createDirectory,
  deleteFile,
  copyFile,
  moveFile,
  createSymlink,
  setPermissions,
  
  // Git
  gitStatus,
  gitLog,
  gitDiff,
  gitBranch,
  gitAdd,
  gitCommit,
  gitPull,
  gitPush,
  gitClone,
  gitStash,
  
  // System
  systemInfo,
  processInfo,
  killProcess,
  networkInfo,
  ping,
  curl,
  environmentVariables,
  serviceInfo,
  platformInfo,
  
  // Search
  searchFiles,
  searchInFiles,
  replaceInFile,
  countLines,
  headTail,

  // Platform Commands (cross-platform)
  listProcesses,
  killProcessByPidOrName,
  listServices,
  manageService,
  diskUsage,
  memoryUsage,
  cpuInfo,
  findFiles,
  
  // Sub-agents
  spawnSubAgent,
  checkSubAgentStatus,
};

export type ToolName = keyof typeof allTools;

/**
 * Get all available tools including MCP and Skills
 * This combines:
 * - Built-in tools (allTools)
 * - MCP server tools (from connected MCP servers)
 * - Skill tools (from active skills)
 */
export function getAllAvailableTools(): Record<string, Tool> {
  const combinedTools: Record<string, Tool> = { ...allTools };
  
  // Add MCP tools
  const mcpTools = getAllMCPTools();
  for (const [name, tool] of Object.entries(mcpTools)) {
    combinedTools[name] = tool;
  }
  
  // Add Skill tools
  const skillTools = getAllActiveSkillTools();
  for (const [name, tool] of Object.entries(skillTools)) {
    combinedTools[name] = tool;
  }
  
  return combinedTools;
}

/**
 * Get tool counts by category
 */
export function getToolCounts(): {
  builtin: number;
  mcp: number;
  skills: number;
  total: number;
} {
  const mcpTools = getAllMCPTools();
  const skillTools = getAllActiveSkillTools();
  const builtinCount = Object.keys(allTools).length;
  const mcpCount = Object.keys(mcpTools).length;
  const skillsCount = Object.keys(skillTools).length;
  
  return {
    builtin: builtinCount,
    mcp: mcpCount,
    skills: skillsCount,
    total: builtinCount + mcpCount + skillsCount,
  };
}

export const toolCategories = {
  shell: ["executeShellCommand", "executeShellCommandConfirmed", "getShellInfo"],
  files: [
    "readFile",
    "writeFile",
    "listDirectory",
    "fileInfo",
    "createDirectory",
    "deleteFile",
    "copyFile",
    "moveFile",
    "createSymlink",
    "setPermissions",
  ],
  git: [
    "gitStatus",
    "gitLog",
    "gitDiff",
    "gitBranch",
    "gitAdd",
    "gitCommit",
    "gitPull",
    "gitPush",
    "gitClone",
    "gitStash",
  ],
  system: [
    "systemInfo",
    "processInfo",
    "killProcess",
    "networkInfo",
    "ping",
    "curl",
    "environmentVariables",
    "serviceInfo",
    "platformInfo",
  ],
  search: [
    "searchFiles",
    "searchInFiles",
    "replaceInFile",
    "countLines",
    "headTail",
  ],
  platform: [
    "listProcesses",
    "killProcessByPidOrName",
    "listServices",
    "manageService",
    "diskUsage",
    "memoryUsage",
    "cpuInfo",
    "findFiles",
  ],
  subagents: [
    "spawnSubAgent",
    "checkSubAgentStatus",
  ],
} as const;

export const toolDescriptions: Record<string, string> = {
  executeShellCommand: "Execute shell commands (bash/PowerShell)",
  executeShellCommandConfirmed: "Execute dangerous commands with confirmation",
  getShellInfo: "Get current shell and platform information",
  readFile: "Read file contents (cross-platform)",
  writeFile: "Write/create files",
  listDirectory: "List directory contents",
  fileInfo: "Get file/directory information",
  createDirectory: "Create directories",
  deleteFile: "Delete files",
  copyFile: "Copy files",
  moveFile: "Move/rename files",
  createSymlink: "Create symbolic links",
  setPermissions: "Set file permissions (chmod)",
  gitStatus: "Get git repository status",
  gitLog: "View git commit history",
  gitDiff: "Show git changes",
  gitBranch: "Manage git branches",
  gitAdd: "Stage files for commit",
  gitCommit: "Create git commits",
  gitPull: "Pull from remote",
  gitPush: "Push to remote",
  gitClone: "Clone repositories",
  gitStash: "Stash/restore changes",
  systemInfo: "Get system information (cross-platform)",
  processInfo: "List running processes",
  killProcess: "Terminate processes",
  networkInfo: "Get network information",
  ping: "Ping hosts",
  curl: "Make HTTP requests",
  environmentVariables: "List environment variables",
  serviceInfo: "List and manage services",
  platformInfo: "Get detailed platform information",
  searchFiles: "Search for files by name",
  searchInFiles: "Search text in files (grep/Select-String)",
  replaceInFile: "Find and replace in files",
  countLines: "Count lines/words in files",
  headTail: "View first/last lines of files",
  listProcesses: "List processes (cross-platform)",
  killProcessByPidOrName: "Kill process by PID or name",
  listServices: "List system services (cross-platform)",
  manageService: "Start/stop/restart services",
  diskUsage: "Get disk usage information",
  memoryUsage: "Get memory usage information",
  cpuInfo: "Get CPU information",
  findFiles: "Find files matching pattern (cross-platform)",
  spawnSubAgent: "Spawn specialized sub-agents for complex tasks",
  checkSubAgentStatus: "Check status of a spawned sub-agent",
};
