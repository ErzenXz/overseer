/**
 * Post-install script for cross-platform setup
 * Runs after npm install to ensure the environment is properly configured
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

console.log('🔧 Overseer Post-Install Setup');
console.log(`   Platform: ${process.platform} (${os.arch()})`);
console.log(`   Node: ${process.version}`);
console.log('');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✅ Created data directory');
}

// Create .env file from example if it doesn't exist
const envPath = path.join(process.cwd(), '.env');
const envExamplePath = path.join(process.cwd(), '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log('✅ Created .env file from .env.example');
  console.log('   ⚠️  Please edit .env and add your API keys');
}

// Platform-specific notes
console.log('');
console.log('📋 Platform Notes:');

if (isWindows) {
  console.log('   Windows detected:');
  console.log('   - Shell commands will use PowerShell');
  console.log('   - Symlinks require admin or Developer Mode');
  console.log('   - Use forward slashes (/) or escaped backslashes (\\\\) in paths');
  console.log('   - Native dependencies (better-sqlite3) may need Windows Build Tools');
  console.log('');
  console.log('   If you encounter native module issues, run:');
  console.log('   npm install --global windows-build-tools');
}

if (isMacOS) {
  console.log('   macOS detected:');
  console.log('   - Shell commands will use your default shell (bash/zsh)');
  console.log('   - Service management uses launchctl');
  console.log('   - Homebrew is the recommended package manager');
}

if (isLinux) {
  console.log('   Linux detected:');
  console.log('   - Shell commands will use bash');
  console.log('   - Service management uses systemd (if available)');
  console.log('   - Some commands may require sudo for system operations');
}

// Check for required environment variables
console.log('');
console.log('🔑 Environment Check:');

const requiredForLLM = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'];
const optionalForBots = ['TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN'];

let hasAnyLLMKey = false;
for (const key of requiredForLLM) {
  if (process.env[key]) {
    hasAnyLLMKey = true;
    console.log(`   ✅ ${key} is set`);
  }
}

if (!hasAnyLLMKey) {
  console.log('   ⚠️  No LLM API keys detected in environment');
  console.log('      Add at least one to .env: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY');
}

for (const key of optionalForBots) {
  if (process.env[key]) {
    console.log(`   ✅ ${key} is set`);
  } else {
    console.log(`   ℹ️  ${key} not set (optional)`);
  }
}

console.log('');
console.log('🚀 Setup complete! Next steps:');
console.log('   1. Edit .env with your API keys');
console.log('   2. Run: npm run db:init');
console.log('   3. Run: npm run dev (web admin)');
console.log('   4. Run: npm run bot:dev (Telegram bot)');
console.log('');
