import { generateText, streamText, stepCountIs, type LanguageModel, type ModelMessage } from "ai";
import { loadSoul } from "./soul";
import { getDefaultModel, getActiveModels } from "./providers";
import { allTools, getAllAvailableTools, getToolCounts } from "./tools/index";
import { messagesModel, conversationsModel, logsModel } from "../database/index";
import { createLogger } from "../lib/logger";

// Type alias for messages (using ModelMessage from AI SDK)
type CoreMessage = ModelMessage;

// MCP and Skills imports
import { getConnectionStatus as getMCPStatus, getActiveServers as getActiveMCPServers } from "./mcp/client";
import { getActiveSkills, matchSkillTriggers, recordUsage as recordSkillUsage } from "./skills/registry";

const logger = createLogger("agent");

// Agent configuration
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "25", 10);
const MAX_RETRIES = parseInt(process.env.AGENT_MAX_RETRIES || "3", 10);
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "120000", 10);

export interface AgentOptions {
  conversationId?: number;
  model?: LanguageModel;
  maxSteps?: number;
  maxRetries?: number;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onError?: (error: Error) => void;
}

export interface AgentResult {
  success: boolean;
  text: string;
  toolCalls?: { name: string; args: unknown; result: unknown }[];
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  error?: string;
}

/**
 * Build the system prompt including SOUL.md, MCP server info, and available skills
 */
function buildSystemPrompt(query?: string): string {
  const soul = loadSoul();
  
  // Get MCP server info
  const mcpServers = getActiveMCPServers();
  const mcpStatus = getMCPStatus();
  
  // Get active skills
  const activeSkills = getActiveSkills();
  
  // Match skills based on query if provided
  const matchedSkills = query ? matchSkillTriggers(query) : [];
  
  // Get tool counts
  const toolCounts = getToolCounts();
  
  // Build MCP server section
  let mcpSection = "";
  if (mcpServers.length > 0 || mcpStatus.length > 0) {
    mcpSection = `
## MCP Servers

Connected MCP (Model Context Protocol) servers provide additional tools:
`;
    for (const status of mcpStatus) {
      mcpSection += `- **${status.server}**: ${status.connected ? `Connected (${status.tools} tools)` : "Disconnected"}\n`;
    }
    
    if (mcpStatus.length === 0) {
      mcpSection += `- No MCP servers currently connected\n`;
    }
  }
  
  // Build skills section
  let skillsSection = "";
  if (activeSkills.length > 0) {
    skillsSection = `
## Available Skills

The following skills are active and provide specialized capabilities:
`;
    for (const skill of activeSkills) {
      skillsSection += `- **${skill.name}** (v${skill.version}): ${skill.description || "No description"}\n`;
    }
  }
  
  // Build matched skills section with their system prompts
  let matchedSkillsSection = "";
  if (matchedSkills.length > 0) {
    matchedSkillsSection = `
## Activated Skills for This Query

Based on the user's query, the following specialized skills are activated:
`;
    for (const skill of matchedSkills) {
      matchedSkillsSection += `### ${skill.name}\n`;
      if (skill.system_prompt) {
        matchedSkillsSection += `${skill.system_prompt}\n\n`;
      }
      // Record skill usage
      recordSkillUsage(skill.skill_id);
    }
  }
  
  // Build sub-agents section
  const subAgentsSection = `
## Sub-Agents

You can spawn specialized sub-agents for complex tasks using the spawnSubAgent tool:
- **code**: Code generation, modification, and review
- **file**: File system operations specialist
- **git**: Version control operations (via shell)
- **system**: System administration (via shell)
- **web**: Web scraping and API calls (via shell)
- **docker**: Container management
- **db**: Database operations
- **security**: Security and firewall
- **network**: Network diagnostics

Use sub-agents when a task requires focused expertise or when you want to delegate work.
`;

  const systemPrompt = `${soul}

---

## Current Session Context

- **Date/Time**: ${new Date().toISOString()}
- **Working Directory**: ${process.cwd()}
- **User**: ${process.env.USER || "unknown"}
- **Platform**: ${process.platform}

## Available Tools

You have access to ${toolCounts.total} tools:
- **Built-in tools**: ${toolCounts.builtin} (shell, files, sub-agents)
- **MCP tools**: ${toolCounts.mcp} (from connected MCP servers)
- **Skill tools**: ${toolCounts.skills} (from active skills)

Built-in capabilities include:
- Shell access for any command (git, system admin, networking, search)
- File operations (read, write, list)
- Sub-agent spawning (delegate specialized tasks)
${mcpSection}${skillsSection}${matchedSkillsSection}${subAgentsSection}

Use these tools to help the user with their requests. Always explain what you're doing and why.
`;

  return systemPrompt;
}

/**
 * Convert database messages to CoreMessage format
 */
function formatMessagesForAI(
  dbMessages: { role: string; content: string; tool_calls?: string | null; tool_results?: string | null }[]
): CoreMessage[] {
  const messages: CoreMessage[] = [];

  for (const msg of dbMessages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    }
    // Tool messages are handled by the AI SDK internally
  }

  return messages;
}

/**
 * Run the agent with a prompt (non-streaming)
 */
export async function runAgent(
  prompt: string,
  options: AgentOptions = {}
): Promise<AgentResult> {
  const {
    conversationId,
    maxSteps = MAX_STEPS,
    maxRetries = MAX_RETRIES,
    onToolCall,
    onToolResult,
    onError,
  } = options;

  // Get model
  let model = options.model || getDefaultModel();
  if (!model) {
    return {
      success: false,
      text: "No LLM provider configured. Please add a provider in the admin panel.",
      error: "No provider configured",
    };
  }

  // Get conversation history if available
  let history: CoreMessage[] = [];
  if (conversationId) {
    const dbMessages = messagesModel.getRecentForContext(conversationId, 20);
    history = formatMessagesForAI(dbMessages);
  }

  // Build messages
  const messages: CoreMessage[] = [
    ...history,
    { role: "user", content: prompt },
  ];

  // Get all available tools (built-in + MCP + Skills)
  const combinedTools = getAllAvailableTools();

  logger.info("Running agent", {
    conversationId,
    promptLength: prompt.length,
    historyLength: history.length,
    maxSteps,
    toolCount: Object.keys(combinedTools).length,
  });

  // Retry logic with provider fallback
  let lastError: Error | null = null;
  const activeModels = getActiveModels();

  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      const startTime = Date.now();

      const result = await generateText({
        model,
        system: buildSystemPrompt(prompt),
        messages,
        tools: combinedTools,
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: ({ toolCalls, toolResults }) => {
          if (toolCalls) {
            for (const tc of toolCalls) {
              const args = 'args' in tc ? tc.args : undefined;
              logger.debug("Tool called", { name: tc.toolName, args });
              onToolCall?.(tc.toolName, args);
            }
          }
          if (toolResults) {
            for (const tr of toolResults) {
              logger.debug("Tool result", { name: tr.toolName });
              const result = 'result' in tr ? tr.result : undefined;
              onToolResult?.(tr.toolName, result);
            }
          }
        },
      });

      const executionTime = Date.now() - startTime;
      logger.info("Agent completed", {
        executionTime,
        steps: result.steps?.length || 0,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      });

      // Extract tool calls from steps
      const toolCalls: { name: string; args: unknown; result: unknown }[] = [];
      if (result.steps) {
        for (const step of result.steps) {
          if (step.toolCalls) {
            for (const tc of step.toolCalls) {
              const matchingResult = step.toolResults?.find(
                (tr) => tr.toolCallId === tc.toolCallId
              );
              const args = 'args' in tc ? tc.args : undefined;
              const result = matchingResult && 'result' in matchingResult ? matchingResult.result : undefined;
              toolCalls.push({
                name: tc.toolName,
                args,
                result,
              });
            }
          }
        }
      }

      return {
        success: true,
        text: result.text,
        toolCalls,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        model: (model as { modelId?: string }).modelId || "unknown",
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error("Agent error", {
        error: lastError.message,
        retry,
        maxRetries,
      });

      onError?.(lastError);

      // Try fallback provider if available
      if (retry < maxRetries && activeModels.length > 1) {
        const currentIndex = activeModels.findIndex(
          (m) => (m.model as { modelId?: string }).modelId === (model as { modelId?: string }).modelId
        );
        const nextIndex = (currentIndex + 1) % activeModels.length;
        if (nextIndex !== currentIndex) {
          model = activeModels[nextIndex].model;
          logger.info("Switching to fallback provider", {
            providerId: activeModels[nextIndex].providerId,
          });
        }
      }

      // Wait before retry (exponential backoff)
      if (retry < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retry) * 1000));
      }
    }
  }

  return {
    success: false,
    text: `I encountered an error: ${lastError?.message}. Please check your provider configuration.`,
    error: lastError?.message,
  };
}

/**
 * Run the agent with streaming responses
 */
export async function runAgentStream(
  prompt: string,
  options: AgentOptions = {}
): Promise<{
  textStream: AsyncIterable<string>;
  fullText: Promise<string>;
  usage: Promise<{ inputTokens: number; outputTokens: number } | undefined>;
}> {
  const {
    conversationId,
    maxSteps = MAX_STEPS,
    onToolCall,
    onToolResult,
  } = options;

  // Get model
  const model = options.model || getDefaultModel();
  if (!model) {
    // Return error as stream
    const errorText = "No LLM provider configured. Please add a provider in the admin panel.";
    return {
      textStream: (async function* () {
        yield errorText;
      })(),
      fullText: Promise.resolve(errorText),
      usage: Promise.resolve(undefined),
    };
  }

  // Get conversation history
  let history: CoreMessage[] = [];
  if (conversationId) {
    const dbMessages = messagesModel.getRecentForContext(conversationId, 20);
    history = formatMessagesForAI(dbMessages);
  }

  const messages: CoreMessage[] = [
    ...history,
    { role: "user", content: prompt },
  ];

  // Get all available tools (built-in + MCP + Skills)
  const combinedTools = getAllAvailableTools();

  logger.info("Starting agent stream", {
    conversationId,
    promptLength: prompt.length,
    historyLength: history.length,
    toolCount: Object.keys(combinedTools).length,
  });

  const result = streamText({
    model,
    system: buildSystemPrompt(prompt),
    messages,
    tools: combinedTools,
    stopWhen: stepCountIs(maxSteps),
        onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls) {
        for (const tc of toolCalls) {
          const args = 'args' in tc ? tc.args : undefined;
          logger.debug("Tool called (stream)", { name: tc.toolName, args });
          onToolCall?.(tc.toolName, args);
        }
      }
      if (toolResults) {
        for (const tr of toolResults) {
          const result = 'result' in tr ? tr.result : undefined;
          onToolResult?.(tr.toolName, result);
        }
      }
    },
  });

  return {
    textStream: result.textStream,
    fullText: Promise.resolve(result.text),
    usage: Promise.resolve(result.usage).then((u) =>
      u && u.inputTokens !== undefined && u.outputTokens !== undefined
        ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens }
        : undefined
    ),
  };
}

/**
 * Simple chat completion without tools (for testing)
 */
export async function simpleChat(prompt: string): Promise<string> {
  const model = getDefaultModel();
  if (!model) {
    return "No LLM provider configured.";
  }

  try {
    const result = await generateText({
      model,
      system: loadSoul(),
      prompt,
    });

    return result.text;
  } catch (error) {
    logger.error("Simple chat error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
