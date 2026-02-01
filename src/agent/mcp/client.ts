/**
 * MCP (Model Context Protocol) Support
 * Connects to MCP servers for extended tool capabilities
 */

import { db } from "../../database/db";
import { createLogger } from "../../lib/logger";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("mcp");

// Active MCP connections
const mcpClients = new Map<string, Client>();
const mcpTools = new Map<string, Map<string, Tool>>();

export interface MCPServer {
  id: number;
  name: string;
  server_type: "stdio" | "sse";
  transport_config: string;
  command: string | null;
  args: string | null;
  env_vars: string | null;
  url: string | null;
  headers: string | null;
  is_active: number;
  auto_connect: number;
  last_connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMCPServerInput {
  name: string;
  server_type: "stdio" | "sse";
  command?: string;
  args?: string[];
  env_vars?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auto_connect?: boolean;
}

/**
 * Get all MCP servers
 */
export function getAllServers(): MCPServer[] {
  const stmt = db.prepare("SELECT * FROM mcp_servers ORDER BY name");
  return stmt.all() as MCPServer[];
}

/**
 * Get active MCP servers
 */
export function getActiveServers(): MCPServer[] {
  const stmt = db.prepare("SELECT * FROM mcp_servers WHERE is_active = 1");
  return stmt.all() as MCPServer[];
}

/**
 * Find server by ID
 */
export function findServerById(id: number): MCPServer | null {
  const stmt = db.prepare("SELECT * FROM mcp_servers WHERE id = ?");
  return stmt.get(id) as MCPServer | null;
}

/**
 * Create a new MCP server
 */
export function createServer(input: CreateMCPServerInput): MCPServer {
  const stmt = db.prepare(`
    INSERT INTO mcp_servers (
      name, server_type, command, args, env_vars, url, headers, auto_connect
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    input.name,
    input.server_type,
    input.command || null,
    input.args ? JSON.stringify(input.args) : null,
    input.env_vars ? JSON.stringify(input.env_vars) : null,
    input.url || null,
    input.headers ? JSON.stringify(input.headers) : null,
    input.auto_connect ? 1 : 0
  );
  
  logger.info("Created MCP server", { name: input.name, type: input.server_type });
  return findServerById(result.lastInsertRowid as number)!;
}

/**
 * Connect to an MCP server
 */
export async function connectToServer(serverId: number): Promise<boolean> {
  const server = findServerById(serverId);
  if (!server) {
    logger.error("MCP server not found", { serverId });
    return false;
  }
  
  // Disconnect if already connected
  if (mcpClients.has(server.name)) {
    await disconnectFromServer(serverId);
  }
  
  try {
    let transport;
    
    if (server.server_type === "stdio") {
      if (!server.command) {
        throw new Error("STDIO server requires a command");
      }
      
      const args = server.args ? JSON.parse(server.args) : [];
      const env = server.env_vars ? JSON.parse(server.env_vars) : {};
      
      transport = new StdioClientTransport({
        command: server.command,
        args,
        env: { ...process.env, ...env },
      });
    } else if (server.server_type === "sse") {
      if (!server.url) {
        throw new Error("SSE server requires a URL");
      }
      
      const headers = server.headers ? JSON.parse(server.headers) : {};
      
      transport = new SSEClientTransport(new URL(server.url), {
        eventSourceInit: { headers },
      });
    } else {
      throw new Error(`Unknown server type: ${server.server_type}`);
    }
    
    const client = new Client(
      { name: "mybot-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );
    
    await client.connect(transport);
    mcpClients.set(server.name, client);
    
    // Load tools from this server
    await loadToolsFromServer(server.name, client);
    
    // Update last connected
    const updateStmt = db.prepare(`
      UPDATE mcp_servers 
      SET last_connected_at = CURRENT_TIMESTAMP, last_error = NULL
      WHERE id = ?
    `);
    updateStmt.run(serverId);
    
    logger.info("Connected to MCP server", { name: server.name });
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    const updateStmt = db.prepare(`
      UPDATE mcp_servers 
      SET last_error = ?
      WHERE id = ?
    `);
    updateStmt.run(errorMessage, serverId);
    
    logger.error("Failed to connect to MCP server", { name: server.name, error: errorMessage });
    return false;
  }
}

/**
 * Disconnect from an MCP server
 */
export async function disconnectFromServer(serverId: number): Promise<void> {
  const server = findServerById(serverId);
  if (!server) return;
  
  const client = mcpClients.get(server.name);
  if (client) {
    try {
      await client.close();
      mcpClients.delete(server.name);
      mcpTools.delete(server.name);
      logger.info("Disconnected from MCP server", { name: server.name });
    } catch (error) {
      logger.error("Error disconnecting from MCP server", { name: server.name, error });
    }
  }
}

/**
 * Load tools from an MCP server
 */
async function loadToolsFromServer(serverName: string, client: Client): Promise<void> {
  try {
    const toolsResponse = await client.listTools();
    const serverTools = new Map<string, Tool>();
    
    for (const mcpTool of toolsResponse.tools) {
      // Convert MCP tool to AI SDK tool
      const aiTool = tool({
        description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
        parameters: convertMCPSchemaToZod(mcpTool.inputSchema),
        execute: async (args) => {
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: args,
          });
          return JSON.stringify(result);
        },
      });
      
      serverTools.set(mcpTool.name, aiTool);
    }
    
    mcpTools.set(serverName, serverTools);
    logger.info("Loaded MCP tools", { server: serverName, count: serverTools.size });
  } catch (error) {
    logger.error("Failed to load MCP tools", { server: serverName, error });
  }
}

/**
 * Convert JSON schema to Zod schema
 */
function convertMCPSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || schema.type !== "object") {
    return z.object({});
  }
  
  const shape: Record<string, z.ZodTypeAny> = {};
  
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const propSchema = prop as any;
      let zodType: z.ZodTypeAny;
      
      switch (propSchema.type) {
        case "string":
          zodType = z.string();
          break;
        case "number":
          zodType = z.number();
          break;
        case "integer":
          zodType = z.number().int();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = convertMCPSchemaToZod(propSchema);
          break;
        default:
          zodType = z.any();
      }
      
      if (propSchema.description) {
        zodType = zodType.describe(propSchema.description);
      }
      
      shape[key] = zodType;
    }
  }
  
  let zodSchema = z.object(shape);
  
  // Handle required fields
  if (schema.required && Array.isArray(schema.required)) {
    // Zod objects are required by default, so we only need to handle optionals
    // Actually, we need to make non-required fields optional
    const optionalShape: Record<string, z.ZodTypeAny> = {};
    for (const [key, val] of Object.entries(shape)) {
      if (!schema.required.includes(key)) {
        optionalShape[key] = val.optional();
      } else {
        optionalShape[key] = val;
      }
    }
    zodSchema = z.object(optionalShape);
  }
  
  return zodSchema;
}

/**
 * Get all tools from all connected MCP servers
 */
export function getAllMCPTools(): Record<string, Tool> {
  const allTools: Record<string, Tool> = {};
  
  for (const [serverName, tools] of mcpTools) {
    for (const [toolName, tool] of tools) {
      // Prefix tool name with server to avoid conflicts
      allTools[`${serverName}_${toolName}`] = tool;
    }
  }
  
  return allTools;
}

/**
 * Connect to all auto-connect servers
 */
export async function connectAutoConnectServers(): Promise<void> {
  const stmt = db.prepare("SELECT id FROM mcp_servers WHERE auto_connect = 1 AND is_active = 1");
  const servers = stmt.all() as { id: number }[];
  
  for (const server of servers) {
    await connectToServer(server.id);
  }
}

/**
 * Update server configuration
 */
export function updateServer(
  serverId: number,
  updates: Partial<CreateMCPServerInput>
): void {
  const fields: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const values: any[] = [];
  
  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.command !== undefined) {
    fields.push("command = ?");
    values.push(updates.command);
  }
  if (updates.args !== undefined) {
    fields.push("args = ?");
    values.push(JSON.stringify(updates.args));
  }
  if (updates.env_vars !== undefined) {
    fields.push("env_vars = ?");
    values.push(JSON.stringify(updates.env_vars));
  }
  if (updates.url !== undefined) {
    fields.push("url = ?");
    values.push(updates.url);
  }
  if (updates.headers !== undefined) {
    fields.push("headers = ?");
    values.push(JSON.stringify(updates.headers));
  }
  if (updates.auto_connect !== undefined) {
    fields.push("auto_connect = ?");
    values.push(updates.auto_connect ? 1 : 0);
  }
  
  const stmt = db.prepare(`
    UPDATE mcp_servers 
    SET ${fields.join(", ")}
    WHERE id = ?
  `);
  
  stmt.run(...values, serverId);
}

/**
 * Delete an MCP server
 */
export async function deleteServer(serverId: number): Promise<void> {
  const server = findServerById(serverId);
  if (server) {
    await disconnectFromServer(serverId);
  }
  
  const stmt = db.prepare("DELETE FROM mcp_servers WHERE id = ?");
  stmt.run(serverId);
}

/**
 * Get connection status
 */
export function getConnectionStatus(): {
  server: string;
  connected: boolean;
  tools: number;
}[] {
  return Array.from(mcpClients.keys()).map(serverName => ({
    server: serverName,
    connected: true,
    tools: mcpTools.get(serverName)?.size || 0,
  }));
}
