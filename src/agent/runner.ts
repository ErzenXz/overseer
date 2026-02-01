/**
 * Standalone Agent Runner for MyBot
 * Runs independently with full VPS control, retry logic, and context management
 * NO CONFIRMATIONS - Executes commands immediately!
 */

import { generateText, streamText, type CoreMessage } from "ai";
import { loadSoul } from "./soul";
import { getDefaultModel, getActiveModels, createModel, type ProviderName } from "./providers-comprehensive";
import { executeShellCommand, executeMultipleCommands } from "./tools/shell-noconfirm";
import { allTools } from "./tools/index";
import { messagesModel, conversationsModel } from "../database/index";
import { createLogger } from "../lib/logger";
import { config } from "dotenv";
import { resolve } from "path";
import readline from "readline";

// Load environment
config({ path: resolve(process.cwd(), ".env") });

const logger = createLogger("agent-runner");

// Configuration
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "50", 10);
const MAX_RETRIES = parseInt(process.env.AGENT_MAX_RETRIES || "5", 10);
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "180000", 10);
const RETRY_DELAY_MS = parseInt(process.env.AGENT_RETRY_DELAY_MS || "2000", 10);

interface AgentContext {
  conversationId: number;
  messages: CoreMessage[];
  workingDirectory: string;
  environment: Record<string, string>;
  metadata: {
    startTime: number;
    totalTokens: number;
    stepCount: number;
    retryCount: number;
    toolCalls: Array<{
      name: string;
      timestamp: number;
      success: boolean;
    }>;
  };
}

interface AgentResult {
  success: boolean;
  text: string;
  steps?: number;
  inputTokens?: number;
  outputTokens?: number;
  executionTimeMs: number;
  toolCalls?: string[];
  error?: string;
}

/**
 * Build system prompt with context
 */
function buildSystemPrompt(context?: Partial<AgentContext>): string {
  const soul = loadSoul();
  
  let contextInfo = "";
  if (context) {
    contextInfo = `
## Current Context
- Working Directory: ${context.workingDirectory || process.cwd()}
- Session Start: ${context.metadata?.startTime ? new Date(context.metadata.startTime).toISOString() : new Date().toISOString()}
- Steps Taken: ${context.metadata?.stepCount || 0}
`;
  }

  return `${soul}

---

## VPS Control Mode (NO CONFIRMATIONS)
You have FULL ACCESS to this VPS with NO RESTRICTIONS.
- ALL commands execute IMMEDIATELY without confirmation
- You can delete, modify, or create any files
- You can install, update, or remove software
- You have full system access

## Available Tools
You have access to powerful tools for VPS control:
- executeShellCommand: Run any shell command immediately
- executeMultipleCommands: Run a sequence of commands
- File operations: readFile, writeFile, listDirectory, fileInfo
- Git operations: gitStatus, gitCommit, gitPush, gitPull, etc.
- System info: systemInfo, processInfo, networkInfo
- Search: searchFiles, searchInFiles

## Important
- Explain what you're doing before executing commands
- Provide clear summaries of results
- If a command fails, try an alternative approach
- Use multiple commands in sequence for complex operations
${contextInfo}
`;
}

/**
 * Get conversation history for context
 */
async function getConversationHistory(conversationId: number, limit = 30): Promise<CoreMessage[]> {
  const dbMessages = messagesModel.getRecentForContext(conversationId, limit);
  const messages: CoreMessage[] = [];

  for (const msg of dbMessages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    }
  }

  return messages;
}

/**
 * Execute agent with retry logic
 */
export async function executeAgent(
  prompt: string,
  options: {
    conversationId?: number;
    stream?: boolean;
    onProgress?: (text: string) => void;
    onToolCall?: (toolName: string) => void;
  } = {}
): Promise<AgentResult> {
  const startTime = Date.now();
  const { conversationId, stream, onProgress, onToolCall } = options;

  logger.info("Starting agent execution", {
    promptLength: prompt.length,
    conversationId,
    stream: !!stream,
  });

  // Get or create conversation
  let convId = conversationId;
  if (!convId) {
    const conv = conversationsModel.findOrCreate({
      interface_type: "agent",
      external_chat_id: "standalone",
      external_user_id: "agent",
      title: "Standalone Agent Session",
    });
    convId = conv.id;
  }

  // Save user message
  messagesModel.create({
    conversation_id: convId,
    role: "user",
    content: prompt,
  });

  // Build context
  const context: AgentContext = {
    conversationId: convId,
    messages: await getConversationHistory(convId),
    workingDirectory: process.cwd(),
    environment: { ...process.env },
    metadata: {
      startTime: Date.now(),
      totalTokens: 0,
      stepCount: 0,
      retryCount: 0,
      toolCalls: [],
    },
  };

  // Get model with fallback
  let model = getDefaultModel();
  let providerIndex = 0;
  const activeModels = getActiveModels();

  if (!model) {
    return {
      success: false,
      text: "No LLM provider configured. Please set up a provider using environment variables or the admin panel.",
      executionTimeMs: Date.now() - startTime,
      error: "No provider configured",
    };
  }

  // Retry loop
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      context.metadata.retryCount = attempt;

      if (attempt > 0) {
        logger.info(`Retry attempt ${attempt}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }

      let result;

      if (stream && onProgress) {
        // Streaming mode
        const streamResult = streamText({
          model,
          system: buildSystemPrompt(context),
          messages: [
            ...context.messages,
            { role: "user", content: prompt },
          ],
          tools: { ...allTools, executeShellCommand, executeMultipleCommands },
          maxSteps: MAX_STEPS,
          maxRetries: 3,
          onStepFinish: ({ toolCalls, toolResults }) => {
            context.metadata.stepCount++;
            
            if (toolCalls) {
              for (const tc of toolCalls) {
                context.metadata.toolCalls.push({
                  name: tc.toolName,
                  timestamp: Date.now(),
                  success: true,
                });
                onToolCall?.(tc.toolName);
                logger.info("Tool called", { name: tc.toolName, step: context.metadata.stepCount });
              }
            }
          },
        });

        // Handle streaming
        let fullText = "";
        for await (const chunk of streamResult.textStream) {
          fullText += chunk;
          onProgress(fullText);
        }

        const finalText = await streamResult.text;
        const usage = await streamResult.usage;

        result = {
          text: finalText,
          usage: {
            promptTokens: usage?.promptTokens || 0,
            completionTokens: usage?.completionTokens || 0,
          },
        };
      } else {
        // Non-streaming mode
        result = await generateText({
          model,
          system: buildSystemPrompt(context),
          messages: [
            ...context.messages,
            { role: "user", content: prompt },
          ],
          tools: { ...allTools, executeShellCommand, executeMultipleCommands },
          maxSteps: MAX_STEPS,
          maxRetries: 3,
          onStepFinish: ({ toolCalls, toolResults }) => {
            context.metadata.stepCount++;
            
            if (toolCalls) {
              for (const tc of toolCalls) {
                context.metadata.toolCalls.push({
                  name: tc.toolName,
                  timestamp: Date.now(),
                  success: true,
                });
                onToolCall?.(tc.toolName);
                logger.info("Tool called", { name: tc.toolName, step: context.metadata.stepCount });
              }
            }
          },
        });
      }

      // Save assistant message
      messagesModel.create({
        conversation_id: convId,
        role: "assistant",
        content: result.text,
        input_tokens: result.usage?.promptTokens,
        output_tokens: result.usage?.completionTokens,
      });

      const executionTimeMs = Date.now() - startTime;

      logger.info("Agent execution completed", {
        executionTimeMs,
        steps: context.metadata.stepCount,
        toolCalls: context.metadata.toolCalls.length,
        inputTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.completionTokens,
      });

      return {
        success: true,
        text: result.text,
        steps: context.metadata.stepCount,
        inputTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.completionTokens,
        executionTimeMs,
        toolCalls: context.metadata.toolCalls.map(t => t.name),
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error("Agent execution error", {
        attempt,
        error: lastError.message,
        conversationId: convId,
      });

      // Try next provider if available
      if (attempt < MAX_RETRIES && activeModels.length > 1) {
        providerIndex = (providerIndex + 1) % activeModels.length;
        model = activeModels[providerIndex].model;
        logger.info("Switching to fallback provider", { providerIndex });
      }
    }
  }

  // All retries exhausted
  const executionTimeMs = Date.now() - startTime;
  
  logger.error("Agent execution failed after all retries", {
    retries: MAX_RETRIES,
    error: lastError?.message,
  });

  return {
    success: false,
    text: `Execution failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message}`,
    executionTimeMs,
    error: lastError?.message,
  };
}

/**
 * Interactive CLI mode
 */
export async function startInteractiveMode() {
  console.log("\n🤖 MyBot Agent - Interactive Mode");
  console.log("====================================");
  console.log("Type your commands or 'quit' to exit.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question("\n> ", async (input) => {
      if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
        console.log("\n👋 Goodbye!");
        rl.close();
        process.exit(0);
      }

      if (input.trim()) {
        console.log("\n🔄 Executing...\n");
        
        const result = await executeAgent(input, {
          stream: true,
          onProgress: (text) => {
            // Clear line and rewrite
            process.stdout.write(`\r${text.slice(-100)}`);
          },
          onToolCall: (toolName) => {
            console.log(`\n[Tool: ${toolName}]`);
          },
        });

        console.log("\n\n" + result.text);
        
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log(`\n📊 Tools used: ${result.toolCalls.join(", ")}`);
        }
        
        console.log(`\n⏱️  Time: ${result.executionTimeMs}ms | Steps: ${result.steps || 0}`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Execute a single command and exit
 */
export async function executeSingleCommand(command: string) {
  console.log(`\n🤖 MyBot Agent - Single Command Mode`);
  console.log(`Command: ${command}\n`);

  const result = await executeAgent(command, {
    stream: true,
    onProgress: (text) => {
      process.stdout.write(text);
    },
    onToolCall: (toolName) => {
      console.log(`\n[Executing: ${toolName}]\n`);
    },
  });

  console.log("\n\n====================================");
  
  if (result.success) {
    console.log("✅ Execution completed successfully");
  } else {
    console.log("❌ Execution failed");
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
  }

  console.log(`\n📊 Stats:`);
  console.log(`  Time: ${result.executionTimeMs}ms`);
  console.log(`  Steps: ${result.steps || 0}`);
  console.log(`  Tokens: ${(result.inputTokens || 0) + (result.outputTokens || 0)}`);
  if (result.toolCalls) {
    console.log(`  Tools: ${result.toolCalls.length}`);
  }

  process.exit(result.success ? 0 : 1);
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Interactive mode
    startInteractiveMode();
  } else {
    // Single command mode
    const command = args.join(" ");
    executeSingleCommand(command);
  }
}

export { executeAgent };
