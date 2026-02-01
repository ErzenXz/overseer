/**
 * Discord Bot Implementation for MyBot
 * Full-featured Discord bot with slash commands, streaming, and multi-modal support
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  type Interaction,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel,
  type DMChannel,
  type Attachment,
} from "discord.js";
import { config } from "dotenv";
import { resolve } from "path";
import { runAgentStream } from "../agent/agent";
import {
  conversationsModel,
  messagesModel,
  interfacesModel,
} from "../database/index";
import { initializeSchema } from "../database/db";
import { SessionManager, estimateTokens } from "../lib/session-manager";
import {
  createBotLogger,
  isRateLimited,
  isUserAllowed,
  isGuildAllowed,
  getBotToken,
  getAllowedUsers,
  getAllowedGuilds,
  truncateText,
  splitText,
  formatToolCall,
  getSystemStatus,
  getHelpMessage,
  getWelcomeMessage,
} from "./shared";

// Load environment
config({ path: resolve(process.cwd(), ".env") });

// Initialize database
initializeSchema();

const logger = createBotLogger("discord");

// Discord message length limits
const MAX_MESSAGE_LENGTH = 2000;
const MAX_EMBED_DESCRIPTION = 4096;

// Rate limiting config
const COOLDOWN_MS = 2000;

// Get Discord configuration
function getDiscordToken(): string | null {
  return getBotToken("discord", "DISCORD_BOT_TOKEN");
}

function getClientId(): string | null {
  // First try database
  const discordInterface = interfacesModel.findByType("discord");
  if (discordInterface && discordInterface.is_active) {
    const config = interfacesModel.getDecryptedConfig(discordInterface.id);
    if (config?.client_id) {
      return config.client_id as string;
    }
  }
  return process.env.DISCORD_CLIENT_ID || null;
}

function getDiscordAllowedUsers(): string[] {
  return getAllowedUsers("discord", "DISCORD_ALLOWED_USERS");
}

function getDiscordAllowedGuilds(): string[] {
  return getAllowedGuilds("DISCORD_ALLOWED_GUILDS");
}

function isDiscordUserAllowed(userId: string): boolean {
  return isUserAllowed(userId, "discord", "DISCORD_ALLOWED_USERS");
}

function isDiscordGuildAllowed(guildId: string | null): boolean {
  if (!guildId) return true; // DMs are always allowed if user is allowed
  return isGuildAllowed(guildId, "DISCORD_ALLOWED_GUILDS");
}

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the AI assistant a question")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Your question or request")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("execute")
    .setDescription("Execute a shell command")
    .addStringOption((option) =>
      option
        .setName("command")
        .setDescription("The shell command to execute")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check system status"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show help information"),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Clear your conversation history"),
];

// Register slash commands
async function registerCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    logger.info("Registering slash commands...");

    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((cmd) => cmd.toJSON()),
    });

    logger.info("Slash commands registered successfully");
  } catch (error) {
    logger.error("Failed to register slash commands", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Process attachments for multi-modal
async function processAttachments(
  attachments: Attachment[]
): Promise<{ type: "image" | "file"; url: string; name: string }[]> {
  const processed: { type: "image" | "file"; url: string; name: string }[] = [];

  for (const attachment of attachments) {
    const isImage =
      attachment.contentType?.startsWith("image/") ||
      /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.name || "");

    processed.push({
      type: isImage ? "image" : "file",
      url: attachment.url,
      name: attachment.name || "attachment",
    });
  }

  return processed;
}

// Get or create conversation for a Discord interaction
function getOrCreateConversation(
  channelId: string,
  userId: string,
  username?: string
) {
  return conversationsModel.findOrCreate({
    interface_type: "discord",
    external_chat_id: channelId,
    external_user_id: userId,
    external_username: username,
  });
}

// Handle /ask command
async function handleAskCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  // Check authorization
  if (!isDiscordUserAllowed(userId)) {
    await interaction.reply({
      content: "⛔ You are not authorized to use this bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDiscordGuildAllowed(guildId)) {
    await interaction.reply({
      content: "⛔ This bot is not available in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check rate limiting
  if (isRateLimited(userId, { cooldownMs: COOLDOWN_MS })) {
    await interaction.reply({
      content: "⏳ Please wait a moment before sending another request.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prompt = interaction.options.getString("prompt", true);
  logger.info("Ask command received", {
    userId,
    username,
    promptLength: prompt.length,
  });

  // Defer reply for long operations
  await interaction.deferReply();

  // Get or create conversation
  const conversation = getOrCreateConversation(channelId, userId, username);

  // Get or create session
  const session = SessionManager.getOrCreateSession({
    conversation_id: conversation.id,
    interface_type: "discord",
    external_user_id: userId,
    external_chat_id: channelId,
  });

  // Add user message to session
  SessionManager.addMessage(session.id, "user", prompt);

  // Save user message to database
  messagesModel.create({
    conversation_id: conversation.id,
    role: "user",
    content: prompt,
  });

  try {
    // Run agent with streaming
    const { textStream, fullText, usage } = await runAgentStream(prompt, {
      conversationId: conversation.id,
      onToolCall: (toolName) => {
        logger.info("Tool called", {
          toolName,
          conversationId: conversation.id,
        });
        SessionManager.recordToolCall(session.id);
      },
    });

    // Stream response
    let responseText = "";
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 1500; // Update every 1.5 seconds

    for await (const chunk of textStream) {
      responseText += chunk;

      // Update message periodically
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

    // Final update
    const finalText = await fullText;
    if (finalText) {
      // Split long messages
      const chunks = splitText(finalText, MAX_MESSAGE_LENGTH);

      if (chunks.length === 1) {
        await interaction.editReply(chunks[0]);
      } else {
        // Edit with first chunk
        await interaction.editReply(chunks[0]);

        // Send remaining chunks as follow-up
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
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
    } else if (!responseText) {
      await interaction.editReply(
        "I apologize, but I couldn't generate a response. Please try again."
      );
    }

    logger.info("Response sent", {
      conversationId: conversation.id,
      length: finalText?.length,
    });
  } catch (error) {
    // Record error in session
    SessionManager.recordError(session.id);
    
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

// Handle /execute command
async function handleExecuteCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  // Check authorization
  if (!isDiscordUserAllowed(userId)) {
    await interaction.reply({
      content: "⛔ You are not authorized to use this bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDiscordGuildAllowed(guildId)) {
    await interaction.reply({
      content: "⛔ This bot is not available in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check rate limiting
  if (isRateLimited(userId, { cooldownMs: COOLDOWN_MS })) {
    await interaction.reply({
      content: "⏳ Please wait a moment before sending another request.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const command = interaction.options.getString("command", true);
  logger.info("Execute command received", { userId, username, command });

  // Defer reply for long operations
  await interaction.deferReply();

  // Get or create conversation
  const conversation = getOrCreateConversation(channelId, userId, username);

  // Create a prompt for shell execution
  const prompt = `Execute this shell command and show me the output: \`${command}\``;

  // Save user message
  messagesModel.create({
    conversation_id: conversation.id,
    role: "user",
    content: prompt,
  });

  try {
    const { textStream, fullText, usage } = await runAgentStream(prompt, {
      conversationId: conversation.id,
      onToolCall: (toolName) => {
        logger.info("Tool called", {
          toolName,
          conversationId: conversation.id,
        });
      },
    });

    // Stream response
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

    // Final update
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

      const usageData = await usage;
      messagesModel.create({
        conversation_id: conversation.id,
        role: "assistant",
        content: finalText,
        input_tokens: usageData?.inputTokens,
        output_tokens: usageData?.outputTokens,
      });
    } else {
      await interaction.editReply(
        "I couldn't execute the command. Please try again."
      );
    }
  } catch (error) {
    logger.error("Error processing execute command", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });

    await interaction.editReply("❌ Error executing command. Please try again.");
  }
}

// Handle /status command
async function handleStatusCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!isDiscordUserAllowed(userId)) {
    await interaction.reply({
      content: "⛔ You are not authorized to use this bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDiscordGuildAllowed(guildId)) {
    await interaction.reply({
      content: "⛔ This bot is not available in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const status = await getSystemStatus();

  const embed = new EmbedBuilder()
    .setTitle("📊 System Status")
    .setDescription(status)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// Handle /help command
async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
  const helpText = getHelpMessage("MyBot Discord");

  const embed = new EmbedBuilder()
    .setTitle("🤖 MyBot Help")
    .setDescription(helpText)
    .setColor(0x5865f2)
    .addFields(
      { name: "/ask", value: "Ask the AI assistant a question", inline: true },
      { name: "/execute", value: "Execute a shell command", inline: true },
      { name: "/status", value: "Check system status", inline: true },
      { name: "/reset", value: "Clear conversation history", inline: true }
    )
    .setFooter({ text: "You can also mention me or DM me directly!" });

  await interaction.reply({ embeds: [embed] });
}

// Handle /reset command
async function handleResetCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const channelId = interaction.channelId;

  if (!isDiscordUserAllowed(userId)) {
    await interaction.reply({
      content: "⛔ You are not authorized to use this bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const conversation = conversationsModel.findOrCreate({
    interface_type: "discord",
    external_chat_id: channelId,
    external_user_id: userId,
    external_username: interaction.user.username,
  });

  // Clear both database messages and session
  conversationsModel.clearMessages(conversation.id);
  
  // Get or create session and clear it
  const session = SessionManager.getOrCreateSession({
    conversation_id: conversation.id,
    interface_type: "discord",
    external_user_id: userId,
    external_chat_id: channelId,
  });
  SessionManager.clearMessages(session.id);

  await interaction.reply({
    content: "🔄 Conversation history cleared. Let's start fresh!",
    flags: MessageFlags.Ephemeral,
  });
}

// Handle direct messages and mentions
async function handleMessage(message: Message) {
  // Ignore bot messages
  if (message.author.bot) return;

  const userId = message.author.id;
  const username = message.author.username;
  const channelId = message.channelId;
  const guildId = message.guildId;
  const isDM = message.channel.type === ChannelType.DM;
  const client = message.client;

  // Check if bot was mentioned or if it's a DM
  const isMentioned = message.mentions.has(client.user!);

  if (!isDM && !isMentioned) return;

  // Check authorization
  if (!isDiscordUserAllowed(userId)) {
    await message.reply("⛔ You are not authorized to use this bot.");
    return;
  }

  if (!isDiscordGuildAllowed(guildId)) {
    await message.reply("⛔ This bot is not available in this server.");
    return;
  }

  // Check rate limiting
  if (isRateLimited(userId, { cooldownMs: COOLDOWN_MS })) {
    return; // Silently ignore rate-limited messages
  }

  // Extract message content (remove mention if present)
  let content = message.content;
  if (isMentioned && client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

  // If no content after removing mention, send help
  if (!content && message.attachments.size === 0) {
    const welcomeEmbed = new EmbedBuilder()
      .setTitle("👋 Hello!")
      .setDescription(getWelcomeMessage())
      .setColor(0x5865f2)
      .addFields({
        name: "Commands",
        value:
          "`/ask` - Ask a question\n`/execute` - Run a command\n`/status` - System status\n`/help` - Show help",
      });

    await message.reply({ embeds: [welcomeEmbed] });
    return;
  }

  logger.info("Message received", {
    userId,
    username,
    isDM,
    length: content.length,
    attachments: message.attachments.size,
  });

  // Process attachments
  const attachments = await processAttachments(
    Array.from(message.attachments.values())
  );

  // Build prompt with attachment context
  let prompt = content;
  if (attachments.length > 0) {
    const attachmentInfo = attachments
      .map((a) => `[${a.type}: ${a.name}](${a.url})`)
      .join("\n");
    prompt = `${content}\n\nAttachments:\n${attachmentInfo}`;
  }

  // Get or create conversation
  const conversation = getOrCreateConversation(channelId, userId, username);

  // Get or create session
  const session = SessionManager.getOrCreateSession({
    conversation_id: conversation.id,
    interface_type: "discord",
    external_user_id: userId,
    external_chat_id: channelId,
  });

  // Add user message to session
  SessionManager.addMessage(session.id, "user", prompt);

  // Save user message to database
  messagesModel.create({
    conversation_id: conversation.id,
    role: "user",
    content: prompt,
    metadata: attachments.length > 0 ? { attachments } : undefined,
  });

  // Show typing indicator
  const channel = message.channel as TextChannel | DMChannel;
  await channel.sendTyping();

  // Keep typing indicator active
  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 5000);

  try {
    const { textStream, fullText, usage } = await runAgentStream(prompt, {
      conversationId: conversation.id,
      onToolCall: (toolName) => {
        logger.info("Tool called", {
          toolName,
          conversationId: conversation.id,
        });
        SessionManager.recordToolCall(session.id);
      },
    });

    // Stream response
    let responseText = "";
    let sentMessage: Message | null = null;
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
          if (!sentMessage) {
            sentMessage = await message.reply(displayText);
          } else {
            await sentMessage.edit(displayText);
          }
          lastUpdate = now;
        } catch {
          // Ignore edit errors
        }
      }
    }

    clearInterval(typingInterval);

    // Final update
    const finalText = await fullText;
    if (finalText) {
      const chunks = splitText(finalText, MAX_MESSAGE_LENGTH);

      if (chunks.length === 1) {
        if (!sentMessage) {
          await message.reply(chunks[0]);
        } else {
          await sentMessage.edit(chunks[0]);
        }
      } else {
        // Handle multiple chunks
        if (!sentMessage) {
          sentMessage = await message.reply(chunks[0]);
        } else {
          await sentMessage.edit(chunks[0]);
        }

        for (let i = 1; i < chunks.length; i++) {
          await channel.send(chunks[i]);
        }
      }

      // Save assistant message
      const usageData = await usage;
      
      // Add to session
      SessionManager.addMessage(session.id, "assistant", finalText);
      
      // Save to database
      messagesModel.create({
        conversation_id: conversation.id,
        role: "assistant",
        content: finalText,
        input_tokens: usageData?.inputTokens,
        output_tokens: usageData?.outputTokens,
      });
    } else if (!responseText) {
      await message.reply(
        "I apologize, but I couldn't generate a response. Please try again."
      );
    }

    logger.info("Response sent", {
      conversationId: conversation.id,
      length: finalText?.length,
    });
  } catch (error) {
    clearInterval(typingInterval);
    
    // Record error in session
    SessionManager.recordError(session.id);
    
    logger.error("Error processing message", {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });

    await message.reply(
      "❌ I encountered an error processing your request. Please try again."
    );
  }
}

// Main function to start the bot
async function startBot() {
  const token = getDiscordToken();
  if (!token) {
    logger.error(
      "No Discord bot token configured. Add it in the admin panel or set DISCORD_BOT_TOKEN."
    );
    console.log("\n⚠️  No Discord bot token found!");
    console.log("   Configure it at: http://localhost:3000/interfaces");
    console.log("   Or set DISCORD_BOT_TOKEN in .env\n");
    process.exit(1);
  }

  const clientId = getClientId();
  if (!clientId) {
    logger.error("No Discord client ID configured. Set DISCORD_CLIENT_ID in .env.");
    console.log("\n⚠️  No Discord client ID found!");
    console.log("   Set DISCORD_CLIENT_ID in .env\n");
    process.exit(1);
  }

  // Register slash commands
  await registerCommands(token, clientId);

  // Create client with necessary intents
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Handle ready event
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Discord bot ready! Logged in as ${readyClient.user.tag}`);
    console.log(`🤖 Discord bot is running!`);
    console.log(`   Logged in as: ${readyClient.user.tag}`);
    console.log(`   Servers: ${readyClient.guilds.cache.size}`);
    console.log(`   Use /ask to start a conversation\n`);
  });

  // Handle slash commands
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
      switch (commandName) {
        case "ask":
          await handleAskCommand(interaction);
          break;
        case "execute":
          await handleExecuteCommand(interaction);
          break;
        case "status":
          await handleStatusCommand(interaction);
          break;
        case "help":
          await handleHelpCommand(interaction);
          break;
        case "reset":
          await handleResetCommand(interaction);
          break;
        default:
          await interaction.reply({
            content: "Unknown command.",
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      logger.error("Error handling interaction", {
        error: error instanceof Error ? error.message : String(error),
        commandName,
      });

      const errorReply = {
        content: "❌ An error occurred while processing your command.",
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorReply);
      } else {
        await interaction.reply(errorReply);
      }
    }
  });

  // Handle messages (DMs and mentions)
  client.on(Events.MessageCreate, handleMessage);

  // Handle errors
  client.on(Events.Error, (error) => {
    logger.error("Discord client error", { error: error.message });
  });

  // Login
  await client.login(token);

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down Discord bot...");
    client.destroy();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

// Run
startBot().catch((error) => {
  console.error("Failed to start Discord bot:", error);
  process.exit(1);
});
