import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "dotenv";
import { resolve } from "path";
import { runAgentStream } from "../agent/agent";
import { conversationsModel, messagesModel } from "../database/index";
import { initializeSchema } from "../database/db";
import { SessionManager, estimateTokens } from "../lib/session-manager";
import {
  createBotLogger,
  isRateLimited,
  isUserAllowed as checkUserAllowed,
  getBotToken as getToken,
  getSystemStatus,
  getHelpMessage,
  getWelcomeMessage,
} from "./shared";
import { getRateLimiter } from "../lib/rate-limiter";
import { poolManager } from "../lib/resource-pool";

// Load environment
config({ path: resolve(process.cwd(), ".env") });

// Initialize database
initializeSchema();

const logger = createBotLogger("telegram");

// Rate limiting config
const COOLDOWN_MS = 2000;

// Get bot token from database or environment
function getBotToken(): string | null {
  return getToken("telegram", "TELEGRAM_BOT_TOKEN");
}

// Check if user is allowed
function isUserAllowed(userId: string): boolean {
  return checkUserAllowed(userId, "telegram", "TELEGRAM_ALLOWED_USERS");
}

// Start the bot
async function startBot() {
  const token = getBotToken();
  if (!token) {
    logger.error("No Telegram bot token configured. Add it in the admin panel or set TELEGRAM_BOT_TOKEN.");
    console.log("\n⚠️  No Telegram bot token found!");
    console.log("   Configure it at: http://localhost:3000/interfaces");
    console.log("   Or set TELEGRAM_BOT_TOKEN in .env\n");
    process.exit(1);
  }

  const bot = new Telegraf(token);

  // Error handling
  bot.catch((err: unknown, ctx) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Bot error", { error: errorMessage, userId: String(ctx.from?.id) });
  });

  // /start command
  bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    if (!isUserAllowed(userId)) {
      await ctx.reply("⛔ You are not authorized to use this bot.");
      return;
    }

    await ctx.reply(getWelcomeMessage() + "\n\nCommands:\n/help - Show this message\n/reset - Clear conversation history\n/status - Check system status");
  });

  // /help command
  bot.help(async (ctx) => {
    await ctx.reply(getHelpMessage("MyBot Telegram"), { parse_mode: "Markdown" });
  });

  // /reset command
  bot.command("reset", async (ctx) => {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id.toString();

    const conversation = conversationsModel.findOrCreate({
      interface_type: "telegram",
      external_chat_id: chatId,
      external_user_id: userId,
      external_username: ctx.from.username || undefined,
    });

    // Clear both database messages and session
    conversationsModel.clearMessages(conversation.id);
    
    // Get or create session and clear it
    const session = SessionManager.getOrCreateSession({
      conversation_id: conversation.id,
      interface_type: "telegram",
      external_user_id: userId,
      external_chat_id: chatId,
    });
    SessionManager.clearMessages(session.id);
    
    await ctx.reply("🔄 Conversation history cleared. Let's start fresh!");
  });

  // /status command
  bot.command("status", async (ctx) => {
    const status = await getSystemStatus();
    await ctx.reply(`📊 ${status}`, { parse_mode: "Markdown" });
  });

  // Handle text messages
  bot.on(message("text"), async (ctx) => {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id.toString();
    const username = ctx.from.username || ctx.from.first_name || undefined;
    const messageText = ctx.message.text;

    // Check authorization
    if (!isUserAllowed(userId)) {
      logger.warn("Unauthorized user attempt", { userId, username });
      await ctx.reply("⛔ You are not authorized to use this bot.");
      return;
    }

    // Check comprehensive rate limits
    const rateLimiter = getRateLimiter();
    const estimatedTokenCount = estimateTokens(messageText);
    
    const rateLimitCheck = await rateLimiter.checkLimit({
      userId,
      interfaceType: "telegram",
      tokens: estimatedTokenCount,
    });

    if (!rateLimitCheck.allowed) {
      const errorMessage = rateLimiter.getErrorMessage(rateLimitCheck);
      await ctx.reply(errorMessage);
      logger.warn("Rate limit exceeded", { userId, reason: rateLimitCheck.reason });
      return;
    }

    // Check for quota warnings
    const warning = rateLimiter.shouldWarnUser(userId);
    if (warning.warn && warning.message) {
      await ctx.reply(warning.message);
    }

    logger.info("Message received", { userId, username, length: messageText.length });

    // Get or create conversation
    const conversation = conversationsModel.findOrCreate({
      interface_type: "telegram",
      external_chat_id: chatId,
      external_user_id: userId,
      external_username: username,
    });

    // Get or create session
    const session = SessionManager.getOrCreateSession({
      conversation_id: conversation.id,
      interface_type: "telegram",
      external_user_id: userId,
      external_chat_id: chatId,
    });

    // Add user message to session
    SessionManager.addMessage(session.id, "user", messageText);

    // Save user message to database
    messagesModel.create({
      conversation_id: conversation.id,
      role: "user",
      content: messageText,
    });

    // Send typing indicator
    await ctx.sendChatAction("typing");

    try {
      // Submit to resource pool with priority
      const pool = poolManager.getPool("agent-execution");
      
      await pool.execute(`telegram-${userId}`, async () => {
        // Run agent with streaming
        const { textStream, fullText, usage } = await runAgentStream(messageText, {
          conversationId: conversation.id,
          onToolCall: (toolName) => {
            logger.info("Tool called", { toolName, conversationId: conversation.id });
            SessionManager.recordToolCall(session.id);
          },
        });

        // Stream response to Telegram
        let responseText = "";
        let sentMessage: { message_id: number } | null = null;
        let lastUpdate = 0;
        const UPDATE_INTERVAL = 1000; // Update every 1 second

        for await (const chunk of textStream) {
          responseText += chunk;

          // Update message periodically
          const now = Date.now();
          if (now - lastUpdate > UPDATE_INTERVAL && responseText.length > 0) {
            try {
              if (!sentMessage) {
                sentMessage = await ctx.reply(responseText + "▌");
              } else {
                await ctx.telegram.editMessageText(
                  ctx.chat.id,
                  sentMessage.message_id,
                  undefined,
                  responseText + "▌"
                );
              }
              lastUpdate = now;
            } catch {
              // Ignore edit errors (message not modified, etc.)
            }
          }
        }

        // Final update
        const finalText = await fullText;
        if (finalText) {
          try {
            if (!sentMessage) {
              await ctx.reply(finalText);
            } else {
              await ctx.telegram.editMessageText(
                ctx.chat.id,
                sentMessage.message_id,
                undefined,
                finalText
              );
            }
          } catch {
            // If edit fails, send new message
            if (sentMessage) {
              await ctx.reply(finalText);
            }
          }

          // Add assistant message to session
          SessionManager.addMessage(session.id, "assistant", finalText);

          // Save assistant message to database
          const usageData = await usage;
          messagesModel.create({
            conversation_id: conversation.id,
            role: "assistant",
            content: finalText,
            input_tokens: usageData?.inputTokens,
            output_tokens: usageData?.outputTokens,
          });

          // Record usage for cost tracking
          if (usageData) {
            rateLimiter.recordRequest({
              userId,
              conversationId: conversation.id,
              interfaceType: "telegram",
              inputTokens: usageData.inputTokens,
              outputTokens: usageData.outputTokens,
              model: "default", // Could be extracted from agent response
            });
          }
        } else if (!responseText) {
          await ctx.reply("I apologize, but I couldn't generate a response. Please try again.");
        }

        logger.info("Response sent", { conversationId: conversation.id, length: finalText?.length });
      });
    } catch (error) {
      // Record error in session
      SessionManager.recordError(session.id);
      
      logger.error("Error processing message", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      await ctx.reply(
        "❌ I encountered an error processing your request. Please try again.\n\n" +
          "If this persists, check the admin panel for provider configuration."
      );
    }
  });

  // Start polling
  logger.info("Starting Telegram bot...");
  
  bot.launch({
    dropPendingUpdates: true,
  });

  console.log("🤖 Telegram bot is running!");
  console.log("   Send /start to your bot to begin\n");

  // Graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

// Run
startBot().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});
