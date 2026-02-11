#!/usr/bin/env node
/**
 * Overseer Interactive Setup Wizard
 * 
 * This script guides you through the initial setup of Overseer:
 * - Generates secure random keys
 * - Configures environment variables
 * - Tests bot tokens
 * - Tests LLM provider connections
 * - Creates admin user
 * - Initializes database
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  header: (msg) => console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n`),
};

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Prompt user for input
 */
function question(prompt, defaultValue = '') {
  return new Promise((resolve) => {
    const displayPrompt = defaultValue
      ? `${prompt} ${colors.yellow}[${defaultValue}]${colors.reset}: `
      : `${prompt}: `;
    
    rl.question(displayPrompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * Prompt for password (hidden input)
 */
function passwordQuestion(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    stdout.write(`${prompt}: `);
    
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    
    let password = '';
    
    stdin.on('data', function onData(char) {
      char = char.toString('utf8');
      
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(password);
          break;
        case '\u0003':
          process.exit();
          break;
        case '\u007f': // Backspace
          password = password.slice(0, -1);
          stdout.clearLine();
          stdout.cursorTo(0);
          stdout.write(`${prompt}: ${'*'.repeat(password.length)}`);
          break;
        default:
          password += char;
          stdout.write('*');
          break;
      }
    });
  });
}

/**
 * Generate secure random string
 */
function generateSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Validate Telegram token format
 */
function isValidTelegramToken(token) {
  return /^\d+:[A-Za-z0-9_-]{35}$/.test(token);
}

/**
 * Validate Discord token format (roughly)
 */
function isValidDiscordToken(token) {
  return token.length > 50 && /^[A-Za-z0-9._-]+$/.test(token);
}

/**
 * Test Telegram bot token
 */
async function testTelegramToken(token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();
    
    if (data.ok) {
      log.success(`Connected to Telegram bot: @${data.result.username}`);
      return true;
    } else {
      log.error(`Telegram API error: ${data.description}`);
      return false;
    }
  } catch (error) {
    log.error(`Failed to connect to Telegram: ${error.message}`);
    return false;
  }
}

/**
 * Test OpenAI API key
 */
async function testOpenAIKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (response.ok) {
      log.success('OpenAI API key is valid');
      return true;
    } else {
      log.error(`OpenAI API error: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    log.error(`Failed to test OpenAI key: ${error.message}`);
    return false;
  }
}

/**
 * Test Anthropic API key
 */
async function testAnthropicKey(apiKey) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    
    if (response.ok || response.status === 400) {
      // 400 is ok - it means the key is valid but request is malformed
      log.success('Anthropic API key is valid');
      return true;
    } else {
      log.error(`Anthropic API error: ${response.status} ${response.statusText}`);
      return false;
    }
  } catch (error) {
    log.error(`Failed to test Anthropic key: ${error.message}`);
    return false;
  }
}

/**
 * Main setup function
 */
async function setup() {
  console.clear();
  log.header('╔════════════════════════════════════════╗');
  log.header('║   Overseer Interactive Setup Wizard      ║');
  log.header('╚════════════════════════════════════════╝');
  
  log.info('This wizard will help you set up Overseer with all required configurations.\n');
  
  const config = {};
  
  // ===========================
  // 1. Application Settings
  // ===========================
  log.header('📋 Application Settings');
  
  config.NODE_ENV = await question('Environment', 'production');
  config.PORT = await question('Port', '3000');
  config.BASE_URL = await question('Base URL', `http://localhost:${config.PORT}`);
  
  // ===========================
  // 2. Security
  // ===========================
  log.header('🔐 Security Configuration');
  
  log.info('Generating secure random keys...');
  config.SESSION_SECRET = generateSecret(32);
  config.ENCRYPTION_KEY = generateSecret(32);
  log.success('Generated SESSION_SECRET');
  log.success('Generated ENCRYPTION_KEY');
  
  // ===========================
  // 3. Database
  // ===========================
  log.header('🗄️  Database Configuration');
  
  config.DATABASE_PATH = await question('Database path', './data/overseer.db');
  
  // ===========================
  // 4. Admin User
  // ===========================
  log.header('👤 Default Admin User');
  
  config.DEFAULT_ADMIN_USERNAME = await question('Admin username', 'admin');
  
  let passwordMatch = false;
  while (!passwordMatch) {
    const password1 = await passwordQuestion('Admin password');
    const password2 = await passwordQuestion('Confirm password');
    
    if (password1 === password2) {
      if (password1.length < 8) {
        log.error('Password must be at least 8 characters long');
      } else {
        config.DEFAULT_ADMIN_PASSWORD = password1;
        passwordMatch = true;
      }
    } else {
      log.error('Passwords do not match. Please try again.');
    }
  }
  
  // ===========================
  // 5. Telegram Bot (Optional)
  // ===========================
  log.header('📱 Telegram Bot Configuration (Optional)');
  
  const setupTelegram = await question('Do you want to set up Telegram bot?', 'y');
  
  if (setupTelegram.toLowerCase() === 'y' || setupTelegram.toLowerCase() === 'yes') {
    log.info('Get your bot token from @BotFather on Telegram');
    
    let tokenValid = false;
    while (!tokenValid) {
      const token = await question('Telegram bot token');
      
      if (!token) {
        log.warn('Skipping Telegram setup');
        break;
      }
      
      if (!isValidTelegramToken(token)) {
        log.error('Invalid token format. Expected format: 123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
        continue;
      }
      
      log.info('Testing Telegram bot token...');
      tokenValid = await testTelegramToken(token);
      
      if (tokenValid) {
        config.TELEGRAM_BOT_TOKEN = token;
        
        const allowedUsers = await question('Allowed Telegram user IDs (comma-separated, empty for all)', '');
        config.TELEGRAM_ALLOWED_USERS = allowedUsers;
        
        const useWebhook = await question('Use webhooks instead of polling?', 'n');
        if (useWebhook.toLowerCase() === 'y') {
          config.TELEGRAM_WEBHOOK_DOMAIN = await question('Webhook domain (e.g., https://overseer.example.com)');
          config.TELEGRAM_WEBHOOK_SECRET = generateSecret(16);
        }
      } else {
        const retry = await question('Would you like to try another token?', 'y');
        if (retry.toLowerCase() !== 'y') break;
      }
    }
  }
  
  // ===========================
  // 6. Discord Bot (Optional)
  // ===========================
  log.header('💬 Discord Bot Configuration (Optional)');
  
  const setupDiscord = await question('Do you want to set up Discord bot?', 'y');
  
  if (setupDiscord.toLowerCase() === 'y' || setupDiscord.toLowerCase() === 'yes') {
    log.info('Get your bot token from https://discord.com/developers/applications');
    
    const token = await question('Discord bot token');
    
    if (token) {
      if (!isValidDiscordToken(token)) {
        log.warn('Token format looks unusual, but will save it anyway');
      }
      
      config.DISCORD_BOT_TOKEN = token;
      config.DISCORD_CLIENT_ID = await question('Discord client ID');
      
      const allowedUsers = await question('Allowed Discord user IDs (comma-separated, empty for all)', '');
      config.DISCORD_ALLOWED_USERS = allowedUsers;
      
      const allowedGuilds = await question('Allowed Discord guild IDs (comma-separated, empty for all)', '');
      config.DISCORD_ALLOWED_GUILDS = allowedGuilds;
    } else {
      log.warn('Skipping Discord setup');
    }
  }
  
  // ===========================
  // 7. LLM Provider (At least one required)
  // ===========================
  log.header('🤖 LLM Provider Configuration');
  
  log.info('You need at least one LLM provider. You can add more later via the web UI.');
  
  const setupOpenAI = await question('Do you want to configure OpenAI?', 'y');
  
  if (setupOpenAI.toLowerCase() === 'y' || setupOpenAI.toLowerCase() === 'yes') {
    const apiKey = await question('OpenAI API key');
    
    if (apiKey) {
      log.info('Testing OpenAI API key...');
      const valid = await testOpenAIKey(apiKey);
      
      if (valid) {
        config.OPENAI_API_KEY = apiKey;
      } else {
        log.warn('Saving API key anyway. You can test it later.');
        config.OPENAI_API_KEY = apiKey;
      }
    }
  }
  
  const setupAnthropic = await question('Do you want to configure Anthropic (Claude)?', 'n');
  
  if (setupAnthropic.toLowerCase() === 'y' || setupAnthropic.toLowerCase() === 'yes') {
    const apiKey = await question('Anthropic API key');
    
    if (apiKey) {
      log.info('Testing Anthropic API key...');
      const valid = await testAnthropicKey(apiKey);
      
      if (valid) {
        config.ANTHROPIC_API_KEY = apiKey;
      } else {
        log.warn('Saving API key anyway. You can test it later.');
        config.ANTHROPIC_API_KEY = apiKey;
      }
    }
  }
  
  const setupGoogle = await question('Do you want to configure Google AI?', 'n');
  
  if (setupGoogle.toLowerCase() === 'y' || setupGoogle.toLowerCase() === 'yes') {
    const apiKey = await question('Google AI API key');
    if (apiKey) {
      config.GOOGLE_API_KEY = apiKey;
    }
  }
  
  // ===========================
  // 8. Agent Settings
  // ===========================
  log.header('🤖 Agent Configuration');
  
  config.AGENT_MAX_RETRIES = await question('Max retries for agent', '3');
  config.AGENT_MAX_STEPS = await question('Max steps per agent execution', '25');
  config.AGENT_DEFAULT_MODEL = await question('Default model', 'gpt-4o');
  config.AGENT_TIMEOUT_MS = await question('Agent timeout (ms)', '120000');
  
  // ===========================
  // 9. Tool Settings
  // ===========================
  log.header('🔧 Tool Configuration');
  
  const allowShell = await question('Allow shell command execution?', 'true');
  config.ALLOW_SHELL_COMMANDS = allowShell;
  
  if (allowShell.toLowerCase() === 'true' || allowShell.toLowerCase() === 'y') {
    const requireConfirm = await question('Require confirmation for destructive commands?', 'true');
    config.REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE = requireConfirm;
  }
  
  config.SHELL_TIMEOUT_MS = await question('Shell command timeout (ms)', '30000');
  config.MAX_FILE_SIZE_MB = await question('Max file size for processing (MB)', '10');
  
  // ===========================
  // 10. Write .env file
  // ===========================
  log.header('💾 Saving Configuration');
  
  const envPath = path.join(process.cwd(), '.env');
  const envContent = generateEnvFile(config);
  
  if (fs.existsSync(envPath)) {
    const backup = `${envPath}.backup.${Date.now()}`;
    fs.copyFileSync(envPath, backup);
    log.info(`Backed up existing .env to ${path.basename(backup)}`);
  }
  
  fs.writeFileSync(envPath, envContent);
  log.success(`Configuration saved to ${envPath}`);
  
  // ===========================
  // 11. Initialize Database
  // ===========================
  log.header('🗄️  Initializing Database');
  
  const initDb = await question('Initialize database now?', 'y');
  
  if (initDb.toLowerCase() === 'y' || initDb.toLowerCase() === 'yes') {
    log.info('Running database initialization...');
    
    try {
      const { execSync } = require('child_process');
      execSync('npm run db:init', { stdio: 'inherit' });
      log.success('Database initialized successfully');
    } catch (error) {
      log.error('Failed to initialize database. You can run "npm run db:init" manually later.');
    }
  }
  
  // ===========================
  // 12. Done!
  // ===========================
  log.header('✨ Setup Complete!');
  
  console.log('\nNext steps:');
  console.log(`  1. Review your configuration in ${colors.cyan}.env${colors.reset}`);
  console.log(`  2. Start the web server: ${colors.green}npm run start${colors.reset}`);
  console.log(`  3. Start the bots: ${colors.green}npm run bots${colors.reset}`);
  console.log(`  4. Access the web UI at: ${colors.blue}${config.BASE_URL}${colors.reset}`);
  console.log(`  5. Login with username: ${colors.cyan}${config.DEFAULT_ADMIN_USERNAME}${colors.reset}\n`);
  
  if (config.TELEGRAM_BOT_TOKEN) {
    console.log(`${colors.green}✓${colors.reset} Telegram bot is configured and ready`);
  }
  if (config.DISCORD_BOT_TOKEN) {
    console.log(`${colors.green}✓${colors.reset} Discord bot is configured and ready`);
  }
  if (config.OPENAI_API_KEY || config.ANTHROPIC_API_KEY || config.GOOGLE_API_KEY) {
    console.log(`${colors.green}✓${colors.reset} LLM provider is configured`);
  }
  
  console.log('\n');
  
  rl.close();
}

/**
 * Generate .env file content
 */
function generateEnvFile(config) {
  return `# Overseer Configuration
# Generated by setup wizard on ${new Date().toISOString()}

# ===========================================
# APPLICATION SETTINGS
# ===========================================
NODE_ENV=${config.NODE_ENV}
PORT=${config.PORT}
BASE_URL=${config.BASE_URL}

# ===========================================
# SECURITY (Auto-generated secure keys)
# ===========================================
SESSION_SECRET=${config.SESSION_SECRET}
ENCRYPTION_KEY=${config.ENCRYPTION_KEY}

# ===========================================
# DATABASE
# ===========================================
DATABASE_PATH=${config.DATABASE_PATH}

# ===========================================
# DEFAULT ADMIN CREDENTIALS
# ===========================================
DEFAULT_ADMIN_USERNAME=${config.DEFAULT_ADMIN_USERNAME}
DEFAULT_ADMIN_PASSWORD=${config.DEFAULT_ADMIN_PASSWORD}

# ===========================================
# LLM PROVIDERS
# ===========================================
${config.OPENAI_API_KEY ? `OPENAI_API_KEY=${config.OPENAI_API_KEY}` : '# OPENAI_API_KEY='}
${config.ANTHROPIC_API_KEY ? `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY}` : '# ANTHROPIC_API_KEY='}
${config.GOOGLE_API_KEY ? `GOOGLE_API_KEY=${config.GOOGLE_API_KEY}` : '# GOOGLE_API_KEY='}

# ===========================================
# TELEGRAM BOT
# ===========================================
${config.TELEGRAM_BOT_TOKEN ? `TELEGRAM_BOT_TOKEN=${config.TELEGRAM_BOT_TOKEN}` : '# TELEGRAM_BOT_TOKEN='}
${config.TELEGRAM_ALLOWED_USERS !== undefined ? `TELEGRAM_ALLOWED_USERS=${config.TELEGRAM_ALLOWED_USERS}` : '# TELEGRAM_ALLOWED_USERS='}
${config.TELEGRAM_WEBHOOK_DOMAIN ? `TELEGRAM_WEBHOOK_DOMAIN=${config.TELEGRAM_WEBHOOK_DOMAIN}` : '# TELEGRAM_WEBHOOK_DOMAIN='}
${config.TELEGRAM_WEBHOOK_SECRET ? `TELEGRAM_WEBHOOK_SECRET=${config.TELEGRAM_WEBHOOK_SECRET}` : '# TELEGRAM_WEBHOOK_SECRET='}

# ===========================================
# DISCORD BOT
# ===========================================
${config.DISCORD_BOT_TOKEN ? `DISCORD_BOT_TOKEN=${config.DISCORD_BOT_TOKEN}` : '# DISCORD_BOT_TOKEN='}
${config.DISCORD_CLIENT_ID ? `DISCORD_CLIENT_ID=${config.DISCORD_CLIENT_ID}` : '# DISCORD_CLIENT_ID='}
${config.DISCORD_ALLOWED_USERS !== undefined ? `DISCORD_ALLOWED_USERS=${config.DISCORD_ALLOWED_USERS}` : '# DISCORD_ALLOWED_USERS='}
${config.DISCORD_ALLOWED_GUILDS !== undefined ? `DISCORD_ALLOWED_GUILDS=${config.DISCORD_ALLOWED_GUILDS}` : '# DISCORD_ALLOWED_GUILDS='}

# ===========================================
# AGENT SETTINGS
# ===========================================
AGENT_MAX_RETRIES=${config.AGENT_MAX_RETRIES}
AGENT_MAX_STEPS=${config.AGENT_MAX_STEPS}
AGENT_DEFAULT_MODEL=${config.AGENT_DEFAULT_MODEL}
AGENT_TIMEOUT_MS=${config.AGENT_TIMEOUT_MS}

# ===========================================
# TOOL SETTINGS
# ===========================================
ALLOW_SHELL_COMMANDS=${config.ALLOW_SHELL_COMMANDS}
${config.REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE !== undefined ? `REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE=${config.REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE}` : '# REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE=true'}
SHELL_TIMEOUT_MS=${config.SHELL_TIMEOUT_MS}
MAX_FILE_SIZE_MB=${config.MAX_FILE_SIZE_MB}
`;
}

// Run setup
setup().catch((error) => {
  log.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
