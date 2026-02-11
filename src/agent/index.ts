// Main agent exports
export { runAgent, runAgentStream, simpleChat, type AgentOptions, type AgentResult } from "./agent";

// Agent initialization
export { initializeAgent, shutdownAgent, getAgentStatus, type InitResult } from "./init";

// Soul management
export { loadSoul, saveSoul, getSoulPath, isUsingCustomSoul, resetToDefaultSoul, getDefaultSoul } from "./soul";

// Provider management
export {
  createModel,
  getDefaultModel,
  getModelById,
  getActiveModels,
  testProvider,
  PROVIDER_INFO,
  getModelInfo,
  type ProviderName,
  type ModelInfo,
} from "./providers";

// Tools
export {
  allTools,
  getAllAvailableTools,
  getToolCounts,
  toolCategories,
  toolDescriptions,
  type ToolName,
} from "./tools/index";

// MCP
export {
  getAllServers as getMCPServers,
  getActiveServers as getActiveMCPServers,
  createServer as createMCPServer,
  connectToServer as connectMCPServer,
  disconnectFromServer as disconnectMCPServer,
  deleteServer as deleteMCPServer,
  getConnectionStatus as getMCPConnectionStatus,
  getAllMCPTools,
} from "./mcp/client";

// Skills
export {
  getAllSkills,
  getActiveSkills,
  findBySkillId as findSkillById,
  createSkill,
  updateSkill,
  deleteSkill,
  syncBuiltinSkills,
  importFromGitHub as importSkillFromGitHub,
  getAllActiveSkillTools,
} from "./skills/registry";

// Sub-agents
export {
  createSubAgent,
  findBySubAgentId,
  findByParentSession,
  executeTask as executeSubAgentTask,
  getStats as getSubAgentStats,
  getAllSubAgentTypes,
  getSubAgentConfig,
  type SubAgentType,
  type SubAgent,
  type TaskResult,
} from "./subagents/manager";
