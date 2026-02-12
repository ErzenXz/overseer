import {
  generateText,
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { loadSoul } from "./soul";
import {
  buildFallbackModelChain,
  findModelInfo,
  getDefaultModel,
} from "./providers";
import { allTools, getAllAvailableTools, getToolCounts } from "./tools/index";
import {
  messagesModel,
  conversationsModel,
  logsModel,
} from "../database/index";
import { createLogger } from "../lib/logger";
import type { ModelInfo, ProviderName } from "./provider-info";
import { agentCache } from "@/lib/agent-cache";
import { runPlanModeOrchestration } from "@/agent/orchestrator";

// Type alias for messages (using ModelMessage from AI SDK)
type CoreMessage = ModelMessage;

// MCP and Skills imports
import {
  getConnectionStatus as getMCPStatus,
  getActiveServers as getActiveMCPServers,
} from "./mcp/client";
import {
  getActiveSkills,
  matchSkillTriggers,
  recordUsage as recordSkillUsage,
} from "./skills/registry";

const logger = createLogger("agent");

// Agent configuration
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "25", 10);
const MAX_RETRIES = parseInt(process.env.AGENT_MAX_RETRIES || "3", 10);
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "120000", 10);

// ---------------------------------------------------------------------------
// Dynamic model settings based on provider-info capabilities
// ---------------------------------------------------------------------------

// Provider options type: matches AI SDK's SharedV3ProviderOptions (Record<string, JSONObject>)
// JSONObject = { [key: string]: JSONValue | undefined }, JSONValue = null | string | number | boolean | JSONObject | JSONArray
type JSONValue =
  | null
  | string
  | number
  | boolean
  | { [key: string]: JSONValue | undefined }
  | JSONValue[];
type JSONObject = { [key: string]: JSONValue | undefined };
type ProviderOptions = Record<string, JSONObject>;

interface ModelSettings {
  providerOptions?: ProviderOptions;
  maxOutputTokens?: number;
  temperature?: number;
}

/**
 * Extract the model ID from a LanguageModel object.
 * The AI SDK v6 LanguageModel has a `modelId` property.
 */
function extractModelId(model: LanguageModel): string {
  return (model as { modelId?: string }).modelId || "unknown";
}

/**
 * Build dynamic providerOptions, maxOutputTokens, and temperature
 * based on the model's capabilities from provider-info.
 *
 * This enables:
 * - Extended thinking for Anthropic, Google, xAI, DeepSeek, and Mistral models
 * - Reasoning effort for OpenAI o-series models
 * - Correct maxOutputTokens per model
 * - Skipping temperature for reasoning models that disallow it
 */
function getModelSettings(model: LanguageModel): ModelSettings {
  const modelId = extractModelId(model);
  const info = findModelInfo(modelId);

  if (!info) {
    logger.debug("No model info found, using defaults", { modelId });
    return {};
  }

  const { provider, model: modelInfo } = info;
  const settings: ModelSettings = {};

  // --- maxOutputTokens: use the model's known max ---
  if (modelInfo.maxOutput) {
    settings.maxOutputTokens = modelInfo.maxOutput;
  }

  // --- temperature: skip for reasoning models that disallow it ---
  if (!modelInfo.allowsTemperature) {
    // Don't set temperature at all — let the provider use its default
    settings.temperature = undefined;
  } else {
    // Default temperature for non-reasoning models
    settings.temperature = 0.7;
  }

  // --- providerOptions: enable thinking/reasoning per provider ---
  if (modelInfo.supportsThinking) {
    settings.providerOptions = buildThinkingOptions(provider, modelInfo);
  }

  logger.debug("Resolved model settings", {
    modelId,
    provider,
    maxOutputTokens: settings.maxOutputTokens,
    hasProviderOptions: !!settings.providerOptions,
    allowsTemperature: modelInfo.allowsTemperature,
  });

  return settings;
}

/**
 * Build provider-specific options to enable extended thinking / reasoning.
 */
function buildThinkingOptions(
  provider: ProviderName,
  modelInfo: ModelInfo,
): ProviderOptions | undefined {
  switch (provider) {
    // Anthropic: extended thinking with budget
    case "anthropic":
      return {
        anthropic: {
          thinking: {
            type: "enabled",
            budgetTokens: Math.min(
              Math.floor(modelInfo.maxOutput * 0.6),
              16_000,
            ),
          },
        },
      };

    // OpenAI o-series: reasoning effort
    case "openai":
    case "azure":
      if (modelInfo.reasoning) {
        return {
          openai: {
            reasoningEffort: "medium",
          },
        };
      }
      return undefined;

    // Google Gemini 2.5: thinking config
    case "google":
      if (modelInfo.supportsThinking) {
        return {
          google: {
            thinkingConfig: {
              thinkingBudget: Math.min(
                Math.floor(modelInfo.maxOutput * 0.5),
                16_000,
              ),
            },
          },
        };
      }
      return undefined;

    // xAI Grok: thinking (uses openai-compatible format)
    case "xai":
      if (modelInfo.supportsThinking) {
        return {
          xai: {
            reasoningEffort: "medium",
          },
        };
      }
      return undefined;

    // DeepSeek Reasoner: uses provider-specific thinking
    case "deepseek":
      if (modelInfo.supportsThinking) {
        return {
          deepseek: {
            thinking: { type: "enabled" },
          },
        };
      }
      return undefined;

    // Mistral Magistral: reasoning models
    case "mistral":
      if (modelInfo.supportsThinking) {
        return {
          mistral: {
            thinking: { type: "enabled" },
          },
        };
      }
      return undefined;

    // Bedrock: uses anthropic-style thinking for Claude models
    case "amazon-bedrock":
      if (modelInfo.id.includes("anthropic") && modelInfo.supportsThinking) {
        return {
          "amazon-bedrock": {
            thinking: {
              type: "enabled",
              budgetTokens: Math.min(
                Math.floor(modelInfo.maxOutput * 0.6),
                16_000,
              ),
            },
          },
        };
      }
      return undefined;

    default:
      return undefined;
  }
}

export interface AgentOptions {
  conversationId?: number;
  model?: LanguageModel;
  maxSteps?: number;
  maxRetries?: number;
  planMode?: boolean;
  steering?: {
    tone?: "concise" | "balanced" | "deep";
    responseStyle?: "direct" | "explanatory" | "mentor";
    requireChecklist?: boolean;
    prioritizeSafety?: boolean;
    includeReasoningSummary?: boolean;
  };
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
function buildSystemPrompt(
  query?: string,
  steering?: AgentOptions["steering"],
): string {
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
- **auto**: Generic task routing (automatically selects the best sub-agent type)
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
Prefer autonomous delegation with wait_for_result=false so you can continue responding to new user requests while sub-agents run.
Only use wait_for_result=true when the immediate next answer strictly depends on that sub-agent output.
`;

  const steeringSection = steering
    ? `
## Steering

- Tone: ${steering.tone ?? "balanced"}
- Response style: ${steering.responseStyle ?? "direct"}
- Require checklist: ${steering.requireChecklist ? "yes" : "no"}
- Prioritize safety: ${steering.prioritizeSafety ? "yes" : "no"}
- Include reasoning summary: ${steering.includeReasoningSummary ? "yes" : "no"}

Follow these steering instructions strictly while still completing user intent.
`
    : "";

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
${steeringSection}

Use these tools to help the user with their requests. Always explain what you're doing and why.
`;

  return systemPrompt;
}

/**
 * Convert database messages to CoreMessage format
 */
function formatMessagesForAI(
  dbMessages: {
    role: string;
    content: string;
    tool_calls?: string | null;
    tool_results?: string | null;
  }[],
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
  options: AgentOptions = {},
): Promise<AgentResult> {
  const {
    conversationId,
    maxSteps = MAX_STEPS,
    maxRetries = MAX_RETRIES,
    planMode = false,
    steering,
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

  const cacheKey = [
    "runAgent:v2",
    prompt,
    JSON.stringify(history.slice(-8)),
    JSON.stringify(steering ?? {}),
    planMode ? "plan" : "normal",
    (model as { modelId?: string }).modelId ?? "unknown",
    Object.keys(combinedTools).length,
  ].join("|");

  const cached = agentCache.get<AgentResult>("agent", cacheKey);
  if (cached) {
    return {
      ...cached,
      model:
        cached.model ?? (model as { modelId?: string }).modelId ?? "unknown",
    };
  }

  if (planMode) {
    const orchestration = await runPlanModeOrchestration(prompt, {
      parentSessionId: conversationId
        ? `conversation:${conversationId}`
        : `session:${Date.now()}`,
      model,
      tools: combinedTools,
      context: history
        .map((h) => (typeof h.content === "string" ? h.content : ""))
        .join("\n\n"),
      steering: JSON.stringify(steering ?? {}),
    });

    const planResult: AgentResult = {
      success: orchestration.success,
      text: orchestration.text,
      toolCalls: [],
      model: (model as { modelId?: string }).modelId || "unknown",
    };

    agentCache.set({
      scope: "agent",
      key: cacheKey,
      value: planResult,
      ttlSeconds: 300,
      tags: ["agent", "plan-mode"],
    });

    return planResult;
  }

  logger.info("Running agent", {
    conversationId,
    promptLength: prompt.length,
    historyLength: history.length,
    maxSteps,
    toolCount: Object.keys(combinedTools).length,
  });

  // Retry logic with fallback chain (up to 5 models)
  let lastError: Error | null = null;
  const fallbackChain = buildFallbackModelChain(model, 5);
  let currentIndex = Math.max(
    0,
    fallbackChain.findIndex(
      (m) =>
        ((m as { modelId?: string }).modelId ?? "") ===
        ((model as { modelId?: string }).modelId ?? ""),
    ),
  );
  model = fallbackChain[currentIndex] ?? model;
  const maxAttempts = Math.min(
    maxRetries,
    Math.max(0, fallbackChain.length - 1),
  );

  for (let retry = 0; retry <= maxAttempts; retry++) {
    try {
      const startTime = Date.now();

      // Get dynamic settings based on the model's capabilities
      const modelSettings = getModelSettings(model);

      const result = await generateText({
        model,
        system: buildSystemPrompt(prompt, steering),
        messages,
        tools: combinedTools,
        stopWhen: stepCountIs(maxSteps),
        ...(modelSettings.maxOutputTokens && {
          maxOutputTokens: modelSettings.maxOutputTokens,
        }),
        ...(modelSettings.temperature !== undefined && {
          temperature: modelSettings.temperature,
        }),
        ...(modelSettings.providerOptions && {
          providerOptions: modelSettings.providerOptions,
        }),
        onStepFinish: ({ toolCalls, toolResults }) => {
          if (toolCalls) {
            for (const tc of toolCalls) {
              const args = "args" in tc ? tc.args : undefined;
              logger.debug("Tool called", { name: tc.toolName, args });
              onToolCall?.(tc.toolName, args);
            }
          }
          if (toolResults) {
            for (const tr of toolResults) {
              logger.debug("Tool result", { name: tr.toolName });
              const result = "result" in tr ? tr.result : undefined;
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
                (tr) => tr.toolCallId === tc.toolCallId,
              );
              const args = "args" in tc ? tc.args : undefined;
              const result =
                matchingResult && "result" in matchingResult
                  ? matchingResult.result
                  : undefined;
              toolCalls.push({
                name: tc.toolName,
                args,
                result,
              });
            }
          }
        }
      }

      const output = {
        success: true,
        text: result.text,
        toolCalls,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        model: (model as { modelId?: string }).modelId || "unknown",
      };

      const ttlSeconds =
        output.toolCalls && output.toolCalls.length > 0 ? 120 : 600;
      agentCache.set({
        scope: "agent",
        key: cacheKey,
        value: output,
        ttlSeconds,
        tags: [
          "agent",
          output.toolCalls && output.toolCalls.length > 0
            ? "toolful"
            : "toolfree",
        ],
      });

      return output;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error("Agent error", {
        error: lastError.message,
        retry,
        maxRetries: maxAttempts,
      });

      onError?.(lastError);

      // Try fallback provider if available
      if (retry < maxAttempts && fallbackChain.length > 1) {
        const nextIndex = currentIndex + 1;
        if (fallbackChain[nextIndex]) {
          currentIndex = nextIndex;
          model = fallbackChain[currentIndex];
          logger.info("Switching to fallback provider", {
            modelId: (model as { modelId?: string }).modelId ?? "unknown",
            index: currentIndex,
            chainLength: fallbackChain.length,
          });
        }
      }

      // Wait before retry (exponential backoff)
      if (retry < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retry) * 1000),
        );
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
  options: AgentOptions = {},
): Promise<{
  textStream: AsyncIterable<string>;
  fullText: Promise<string>;
  usage: Promise<{ inputTokens: number; outputTokens: number } | undefined>;
}> {
  const {
    conversationId,
    maxSteps = MAX_STEPS,
    planMode = false,
    steering,
    onToolCall,
    onToolResult,
  } = options;

  // Get model
  const model = options.model || getDefaultModel();
  if (!model) {
    // Return error as stream
    const errorText =
      "No LLM provider configured. Please add a provider in the admin panel.";
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

  const streamCacheKey = [
    "runAgentStream:v2",
    prompt,
    JSON.stringify(history.slice(-8)),
    JSON.stringify(steering ?? {}),
    planMode ? "plan" : "normal",
    (model as { modelId?: string }).modelId ?? "unknown",
  ].join("|");

  const cached = agentCache.get<{
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
  }>("agent", streamCacheKey);
  if (cached) {
    return {
      textStream: (async function* () {
        yield cached.text;
      })(),
      fullText: Promise.resolve(cached.text),
      usage: Promise.resolve(cached.usage),
    };
  }

  if (planMode) {
    const orchestration = await runPlanModeOrchestration(prompt, {
      parentSessionId: conversationId
        ? `conversation:${conversationId}`
        : `session:${Date.now()}`,
      model,
      tools: combinedTools,
      context: history
        .map((h) => (typeof h.content === "string" ? h.content : ""))
        .join("\n\n"),
      steering: JSON.stringify(steering ?? {}),
    });

    const full = orchestration.text;
    agentCache.set({
      scope: "agent",
      key: streamCacheKey,
      value: { text: full },
      ttlSeconds: 240,
      tags: ["agent", "plan-mode", "stream"],
    });

    return {
      textStream: (async function* () {
        const chunks = full.match(/.{1,160}/g) ?? [full];
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
      fullText: Promise.resolve(full),
      usage: Promise.resolve(undefined),
    };
  }

  logger.info("Starting agent stream", {
    conversationId,
    promptLength: prompt.length,
    historyLength: history.length,
    toolCount: Object.keys(combinedTools).length,
  });

  // Get dynamic settings based on the model's capabilities
  const modelSettings = getModelSettings(model);

  const result = streamText({
    model,
    system: buildSystemPrompt(prompt, steering),
    messages,
    tools: combinedTools,
    stopWhen: stepCountIs(maxSteps),
    ...(modelSettings.maxOutputTokens && {
      maxOutputTokens: modelSettings.maxOutputTokens,
    }),
    ...(modelSettings.temperature !== undefined && {
      temperature: modelSettings.temperature,
    }),
    ...(modelSettings.providerOptions && {
      providerOptions: modelSettings.providerOptions,
    }),
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls) {
        for (const tc of toolCalls) {
          const args = "args" in tc ? tc.args : undefined;
          logger.debug("Tool called (stream)", { name: tc.toolName, args });
          onToolCall?.(tc.toolName, args);
        }
      }
      if (toolResults) {
        for (const tr of toolResults) {
          const result = "result" in tr ? tr.result : undefined;
          onToolResult?.(tr.toolName, result);
        }
      }
    },
  });

  return {
    textStream: result.textStream,
    fullText: Promise.resolve(result.text).then((text) => {
      agentCache.set({
        scope: "agent",
        key: streamCacheKey,
        value: { text },
        ttlSeconds: 180,
        tags: ["agent", "stream"],
      });
      return text;
    }),
    usage: Promise.resolve(result.usage).then((u) =>
      u && u.inputTokens !== undefined && u.outputTokens !== undefined
        ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens }
        : undefined,
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
    const modelSettings = getModelSettings(model);

    const result = await generateText({
      model,
      system: loadSoul(),
      prompt,
      ...(modelSettings.maxOutputTokens && {
        maxOutputTokens: modelSettings.maxOutputTokens,
      }),
      ...(modelSettings.temperature !== undefined && {
        temperature: modelSettings.temperature,
      }),
      ...(modelSettings.providerOptions && {
        providerOptions: modelSettings.providerOptions,
      }),
    });

    return result.text;
  } catch (error) {
    logger.error("Simple chat error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
