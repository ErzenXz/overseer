/**
 * Agent Initialization
 * Sets up the agent on startup with MCP connections, skills sync, and platform settings
 */

import { createLogger } from "../lib/logger";
import { connectAutoConnectServers, getConnectionStatus } from "./mcp/client";
import { syncBuiltinSkills, getActiveSkills } from "./skills/registry";
import { getToolCounts } from "./tools/index";

const logger = createLogger("agent:init");

export interface InitResult {
  success: boolean;
  mcp: {
    connected: number;
    servers: { server: string; connected: boolean; tools: number }[];
  };
  skills: {
    synced: boolean;
    active: number;
  };
  tools: {
    builtin: number;
    mcp: number;
    skills: number;
    total: number;
  };
  platform: {
    os: string;
    arch: string;
    nodeVersion: string;
    workingDirectory: string;
  };
  errors: string[];
}

/**
 * Initialize the agent
 * Call this on application startup to:
 * 1. Connect to auto-connect MCP servers
 * 2. Sync built-in skills from the skills directory
 * 3. Set up platform-specific settings
 */
export async function initializeAgent(): Promise<InitResult> {
  const errors: string[] = [];
  
  logger.info("Initializing agent...");
  const startTime = Date.now();

  // Platform information
  const platform = {
    os: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    workingDirectory: process.cwd(),
  };
  
  logger.info("Platform info", platform);

  // Sync built-in skills
  let skillsSynced = false;
  try {
    syncBuiltinSkills();
    skillsSynced = true;
    logger.info("Built-in skills synced");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Skills sync failed: ${errorMessage}`);
    logger.error("Failed to sync built-in skills", { error: errorMessage });
  }

  // Connect to auto-connect MCP servers
  let mcpConnected = 0;
  try {
    await connectAutoConnectServers();
    const status = getConnectionStatus();
    mcpConnected = status.filter(s => s.connected).length;
    logger.info("MCP servers connected", { count: mcpConnected });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`MCP connection failed: ${errorMessage}`);
    logger.error("Failed to connect MCP servers", { error: errorMessage });
  }

  // Get tool counts
  const toolCounts = getToolCounts();

  // Get active skills count
  const activeSkills = getActiveSkills();

  const result: InitResult = {
    success: errors.length === 0,
    mcp: {
      connected: mcpConnected,
      servers: getConnectionStatus(),
    },
    skills: {
      synced: skillsSynced,
      active: activeSkills.length,
    },
    tools: toolCounts,
    platform,
    errors,
  };

  const initTime = Date.now() - startTime;
  logger.info("Agent initialization complete", {
    success: result.success,
    initTimeMs: initTime,
    tools: result.tools.total,
    mcpServers: result.mcp.connected,
    activeSkills: result.skills.active,
  });

  return result;
}

/**
 * Shutdown the agent gracefully
 * Call this when the application is stopping
 */
export async function shutdownAgent(): Promise<void> {
  logger.info("Shutting down agent...");
  
  // Note: MCP server disconnection would be handled here
  // Currently MCP clients don't require explicit disconnection on app shutdown
  
  logger.info("Agent shutdown complete");
}

/**
 * Get current agent status
 */
export function getAgentStatus(): {
  running: boolean;
  mcp: { server: string; connected: boolean; tools: number }[];
  skills: { active: number };
  tools: { builtin: number; mcp: number; skills: number; total: number };
} {
  const mcpStatus = getConnectionStatus();
  const activeSkills = getActiveSkills();
  const toolCounts = getToolCounts();

  return {
    running: true,
    mcp: mcpStatus,
    skills: { active: activeSkills.length },
    tools: toolCounts,
  };
}
