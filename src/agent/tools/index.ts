// Shell tools
export { executeShellCommand, executeShellCommandConfirmed, getShellInfo } from "./shell";

// File tools
export { readFile, writeFile, listDirectory } from "./files";

// Sub-agent tools
export { spawnSubAgent, checkSubAgentStatus } from "./subagent-tool";

// All tools in a single object
import { executeShellCommand, executeShellCommandConfirmed, getShellInfo } from "./shell";
import { readFile, writeFile, listDirectory } from "./files";
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
  files: ["readFile", "writeFile", "listDirectory"],
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
  spawnSubAgent: "Spawn specialized sub-agents for complex tasks",
  checkSubAgentStatus: "Check status of a spawned sub-agent",
};
