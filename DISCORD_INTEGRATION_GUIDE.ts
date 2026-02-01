/**
 * Discord Bot Rate Limiting Integration Guide
 * 
 * Add these imports at the top of src/bot/discord.ts:
 */

import { getRateLimiter } from "../lib/rate-limiter";
import { poolManager } from "../lib/resource-pool";

/**
 * Then update the handleAskCommand function around line 190-326:
 * 
 * Replace the rate limiting section with:
 */

async function handleAskCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  // Check authorization
  if (!isDiscordUserAllowed(userId)) {
    await interaction.reply({
      content: "⛔ You are not authorized to use this bot.",
      ephemeral: true,
    });
    return;
  }

  if (!isDiscordGuildAllowed(guildId)) {
    await interaction.reply({
      content: "⛔ This bot is not available in this server.",
      ephemeral: true,
    });
    return;
  }

  // ===== NEW: Comprehensive Rate Limiting =====
  const rateLimiter = getRateLimiter();
  const prompt = interaction.options.getString("prompt", true);
  
  const rateLimitCheck = await rateLimiter.checkLimit({
    userId,
    interfaceType: "discord",
    tokens: estimateTokens(prompt),
  });

  if (!rateLimitCheck.allowed) {
    const errorMessage = rateLimiter.getErrorMessage(rateLimitCheck);
    await interaction.reply({
      content: errorMessage,
      ephemeral: true,
    });
    logger.warn("Rate limit exceeded", { userId, reason: rateLimitCheck.reason });
    return;
  }

  // Check for quota warnings
  const warning = rateLimiter.shouldWarnUser(userId);
  if (warning.warn && warning.message) {
    await interaction.reply({
      content: warning.message,
      ephemeral: true,
    });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Brief pause
  }
  // ===== END NEW CODE =====

  logger.info("Ask command received", {
    userId,
    username,
    promptLength: prompt.length,
  });

  // Defer reply for long operations
  await interaction.deferReply();

  // Get or create conversation
  const conversation = getOrCreateConversation(channelId, userId, username);

  // Save user message
  messagesModel.create({
    conversation_id: conversation.id,
    role: "user",
    content: prompt,
  });

  try {
    // ===== NEW: Wrap in Resource Pool =====
    const pool = poolManager.getPool("agent-execution");
    
    await pool.execute(`discord-${userId}`, async () => {
      // Run agent with streaming (EXISTING CODE)
      const { textStream, fullText, usage } = await runAgentStream(prompt, {
        conversationId: conversation.id,
        onToolCall: (toolName) => {
          logger.info("Tool called", {
            toolName,
            conversationId: conversation.id,
          });
        },
      });

      // Stream response (EXISTING CODE - unchanged)
      let responseText = "";
      let lastUpdate = 0;
      const UPDATE_INTERVAL = 1500;

      for await (const chunk of textStream) {
        responseText += chunk;
        const now = Date.now();
        if (now - lastUpdate > UPDATE_INTERVAL && responseText.length > 0) {
          try {
            const displayText = truncateText(
              responseText + "▌",
              MAX_MESSAGE_LENGTH
            );
            await interaction.editReply(displayText);
            lastUpdate = now;
          } catch {
            // Ignore edit errors
          }
        }
      }

      // Final update (EXISTING CODE - unchanged)
      const finalText = await fullText;
      if (finalText) {
        const chunks = splitText(finalText, MAX_MESSAGE_LENGTH);
        if (chunks.length === 1) {
          await interaction.editReply(chunks[0]);
        } else {
          await interaction.editReply(chunks[0]);
          for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp(chunks[i]);
          }
        }

        // Save assistant message (EXISTING CODE)
        const usageData = await usage;
        messagesModel.create({
          conversation_id: conversation.id,
          role: "assistant",
          content: finalText,
          input_tokens: usageData?.inputTokens,
          output_tokens: usageData?.outputTokens,
        });

        // ===== NEW: Record Usage for Cost Tracking =====
        if (usageData) {
          rateLimiter.recordRequest({
            userId,
            conversationId: conversation.id,
            interfaceType: "discord",
            inputTokens: usageData.inputTokens,
            outputTokens: usageData.outputTokens,
            model: "default", // Extract from agent if available
          });
        }
        // ===== END NEW CODE =====
      } else if (!responseText) {
        await interaction.editReply(
          "I apologize, but I couldn't generate a response. Please try again."
        );
      }

      logger.info("Response sent", {
        conversationId: conversation.id,
        length: finalText?.length,
      });
    }); // END pool.execute
    // ===== END NEW CODE =====
    
  } catch (error) {
    logger.error("Error processing ask command", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });

    await interaction.editReply(
      "❌ I encountered an error processing your request. Please try again.\n\n" +
        "If this persists, check the admin panel for provider configuration."
    );
  }
}

/**
 * Apply the same pattern to:
 * - handleExecuteCommand() around line 328-448
 * - handleMessage() around line 530-722
 * 
 * Key changes for each:
 * 1. Add rate limit check before processing
 * 2. Show user-friendly error if limit exceeded
 * 3. Show warnings at 80% usage
 * 4. Wrap agent execution in pool.execute()
 * 5. Record usage after successful response
 */

/**
 * Summary of changes needed:
 * 
 * 1. Add imports (top of file)
 * 2. Add rate check to handleAskCommand (line ~190-230)
 * 3. Wrap agent call in pool.execute (line ~241-315)
 * 4. Record usage after response (line ~303-310)
 * 5. Repeat for handleExecuteCommand
 * 6. Repeat for handleMessage (DMs and mentions)
 * 
 * The exact same pattern works for all three!
 */
