# 👨‍💻 Developer Guide

Complete guide for developers who want to build, extend, or contribute to MyBot.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Project Structure](#project-structure)
- [Code Architecture](#code-architecture)
- [Adding Custom Tools](#adding-custom-tools)
- [Creating Skills](#creating-skills)
- [Adding LLM Providers](#adding-llm-providers)
- [Database Operations](#database-operations)
- [Testing](#testing)
- [Debugging](#debugging)
- [Building & Deployment](#building--deployment)
- [Best Practices](#best-practices)
- [Contributing](#contributing)

---

## Development Environment Setup

### Prerequisites

- **Node.js** 20.0.0 or higher
- **pnpm** (recommended) or npm
- **Git**
- **Code Editor** (VS Code recommended)
- **Database GUI** (optional): DB Browser for SQLite

### Initial Setup

```bash
# 1. Clone repository
git clone https://github.com/yourusername/mybot.git
cd mybot

# 2. Install dependencies
pnpm install  # or npm install

# 3. Set up environment
cp .env.example .env
nano .env  # Configure your settings

# 4. Initialize database
pnpm db:init

# 5. Start development servers
pnpm dev          # Web admin on http://localhost:3000
pnpm bot:dev      # Telegram bot (in another terminal)
pnpm discord:dev  # Discord bot (optional)
```

### VS Code Setup

**Recommended Extensions:**

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "prisma.prisma",
    "formulahendry.auto-close-tag",
    "formulahendry.auto-rename-tag"
  ]
}
```

**Settings (`.vscode/settings.json`):**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

---

## Project Structure

```
mybot/
├── src/
│   ├── agent/                  # AI Agent Core
│   │   ├── agent.ts           # Main agent logic
│   │   ├── providers.ts       # LLM provider manager
│   │   ├── soul.ts            # SOUL.md loader
│   │   ├── soul.md            # Default personality
│   │   ├── tools/             # Built-in tools
│   │   │   ├── index.ts       # Tool registry
│   │   │   ├── shell.ts       # Shell commands
│   │   │   ├── files.ts       # File operations
│   │   │   ├── git.ts         # Git operations
│   │   │   ├── system.ts      # System monitoring
│   │   │   └── search.ts      # Search tools
│   │   ├── skills/            # Skills system
│   │   │   └── registry.ts    # Skill loader
│   │   ├── mcp/               # MCP integration
│   │   │   └── client.ts      # MCP client
│   │   └── subagents/         # Sub-agent system
│   │       └── manager.ts     # Agent spawner
│   │
│   ├── bot/                    # Chat Interfaces
│   │   ├── index.ts           # Telegram bot
│   │   ├── discord.ts         # Discord bot
│   │   └── shared.ts          # Shared bot logic
│   │
│   ├── app/                    # Next.js Web Admin
│   │   ├── api/               # API routes
│   │   │   ├── auth/          # Authentication
│   │   │   ├── chat/          # Chat endpoints
│   │   │   ├── providers/     # Provider management
│   │   │   └── ...
│   │   ├── (dashboard)/       # Dashboard pages
│   │   │   ├── page.tsx       # Home
│   │   │   ├── conversations/ # Conversations
│   │   │   ├── settings/      # Settings
│   │   │   └── tools/         # Tool browser
│   │   ├── login/             # Login page
│   │   └── layout.tsx         # Root layout
│   │
│   ├── components/             # React Components
│   │   ├── Chat/              # Chat interface
│   │   ├── Dashboard/         # Dashboard widgets
│   │   ├── Settings/          # Settings forms
│   │   └── ui/                # Shared UI components
│   │
│   ├── database/               # Database Layer
│   │   ├── db.ts              # Database connection
│   │   ├── init.ts            # Schema initialization
│   │   ├── index.ts           # Model exports
│   │   └── models/            # Data models
│   │       ├── users.ts
│   │       ├── conversations.ts
│   │       ├── providers.ts
│   │       └── ...
│   │
│   ├── lib/                    # Shared Utilities
│   │   ├── auth.ts            # Authentication
│   │   ├── crypto.ts          # Encryption
│   │   ├── logger.ts          # Logging
│   │   ├── config.ts          # Configuration
│   │   └── platform.ts        # Platform detection
│   │
│   ├── types/                  # TypeScript Types
│   │   ├── database.ts        # Database types
│   │   └── ...
│   │
│   └── middleware.ts           # Next.js middleware
│
├── skills/                     # Skill Plugins
│   ├── security-audit/
│   │   ├── skill.json         # Skill manifest
│   │   └── index.ts           # Implementation
│   ├── deploy-assistant/
│   └── ...
│
├── scripts/                    # Utility Scripts
│   ├── install.sh             # Installation script
│   └── postinstall.js         # Post-install hook
│
├── systemd/                    # Service Files
│   ├── mybot-web.service
│   ├── mybot-telegram.service
│   └── mybot-discord.service
│
├── docs/                       # Documentation
│   ├── DEPLOYMENT.md
│   ├── API.md
│   ├── ARCHITECTURE.md
│   └── ...
│
├── data/                       # Runtime Data
│   └── mybot.db               # SQLite database
│
├── logs/                       # Application Logs
│
├── .env                        # Environment variables
├── .env.example               # Environment template
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── next.config.ts             # Next.js config
├── tailwind.config.js         # Tailwind config
└── README.md                  # Main README
```

---

## Code Architecture

### Agent Core

The agent is the brain of MyBot. It uses **Vercel AI SDK's** `generateText` with tool calling:

```typescript
// src/agent/agent.ts
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';

export async function runAgent(params: {
  message: string;
  conversationId: string;
  model: LanguageModel;
}) {
  const { message, conversationId, model } = params;
  
  // 1. Load conversation history
  const history = await getConversationHistory(conversationId);
  
  // 2. Get all available tools (built-in + skills + MCP)
  const tools = getAllAvailableTools();
  
  // 3. Load SOUL.md personality
  const systemPrompt = loadSoulPrompt();
  
  // 4. Run agent with tool loop
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [
      ...history,
      { role: 'user', content: message }
    ],
    tools,
    maxSteps: 10, // Allow up to 10 tool calls
  });
  
  // 5. Save conversation
  await saveMessage(conversationId, 'user', message);
  await saveMessage(conversationId, 'assistant', result.text);
  
  // 6. Log tool calls
  for (const toolCall of result.toolCalls || []) {
    await logToolCall(conversationId, toolCall);
  }
  
  return {
    response: result.text,
    toolsUsed: result.toolCalls?.map(tc => tc.toolName),
    usage: result.usage,
  };
}
```

### Tool System

Tools are defined using Vercel AI SDK's `tool` function:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const myTool = tool({
  description: 'What this tool does',
  parameters: z.object({
    param1: z.string().describe('Description'),
    param2: z.number().optional(),
  }),
  execute: async ({ param1, param2 }) => {
    // Tool implementation
    const result = await doSomething(param1, param2);
    
    return {
      success: true,
      result: result,
    };
  },
});
```

### Database Layer

We use **better-sqlite3** for synchronous database operations:

```typescript
// src/database/models/conversations.ts
import { db } from '../db';

export interface Conversation {
  id: string;
  interface: string;
  user_id: string;
  created_at: string;
}

export const conversationsModel = {
  create(conversation: Omit<Conversation, 'created_at'>) {
    const stmt = db.prepare(`
      INSERT INTO conversations (id, interface, user_id)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(conversation.id, conversation.interface, conversation.user_id);
    return this.findById(conversation.id);
  },
  
  findById(id: string): Conversation | null {
    const stmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
    return stmt.get(id) as Conversation | null;
  },
  
  // ... more methods
};
```

---

## Adding Custom Tools

### 1. Create Tool File

Create a new file in `src/agent/tools/`:

```typescript
// src/agent/tools/my-custom-tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const myCustomTool = tool({
  description: 'Does something amazing with your server',
  parameters: z.object({
    action: z.enum(['start', 'stop', 'status']).describe('Action to perform'),
    service: z.string().describe('Service name'),
  }),
  execute: async ({ action, service }) => {
    try {
      // Your implementation
      const { stdout, stderr } = await execAsync(`systemctl ${action} ${service}`);
      
      if (stderr) {
        return {
          success: false,
          error: stderr,
        };
      }
      
      return {
        success: true,
        output: stdout,
        message: `Service ${service} ${action}ed successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
```

### 2. Export from Index

Add to `src/agent/tools/index.ts`:

```typescript
// Add import
export { myCustomTool } from './my-custom-tool';

// Add to allTools object
export const allTools = {
  // ... existing tools
  myCustomTool,
};

// Add to categories (optional)
export const toolCategories = {
  // ... existing categories
  custom: ['myCustomTool'],
};

// Add description
export const toolDescriptions: Record<string, string> = {
  // ... existing descriptions
  myCustomTool: 'Manage system services',
};
```

### 3. Test Your Tool

```bash
# Start dev server
pnpm dev

# In another terminal, start bot
pnpm bot:dev

# Message your bot
"Use my custom tool to check nginx status"
```

### Tool Best Practices

✅ **DO:**
- Use descriptive parameter names
- Add `.describe()` to all parameters
- Return structured objects
- Handle errors gracefully
- Log important operations
- Validate inputs with Zod
- Keep tools focused (single responsibility)

❌ **DON'T:**
- Return raw error objects (use messages)
- Execute dangerous commands without confirmation
- Block for long periods (use async)
- Hard-code paths (use parameters)
- Ignore error cases

---

## Creating Skills

Skills are modular plugins that add specialized capabilities.

### 1. Create Skill Directory

```bash
mkdir skills/my-skill
cd skills/my-skill
```

### 2. Create Skill Manifest

`skills/my-skill/skill.json`:

```json
{
  "name": "My Skill",
  "description": "Does something specific",
  "version": "1.0.0",
  "author": "Your Name",
  "triggers": ["keyword1", "keyword2"],
  "system_prompt": "You are an expert in X. Help users with Y.",
  "tools": [
    {
      "name": "do_something",
      "description": "Performs a specific task",
      "parameters": {
        "type": "object",
        "properties": {
          "input": {
            "type": "string",
            "description": "Input parameter"
          }
        },
        "required": ["input"]
      },
      "execute": "index.ts:doSomething"
    }
  ],
  "config_schema": {
    "type": "object",
    "properties": {
      "api_key": {
        "type": "string",
        "description": "API key for service X"
      }
    }
  },
  "default_config": {
    "api_key": ""
  }
}
```

### 3. Implement Skill Functions

`skills/my-skill/index.ts`:

```typescript
/**
 * My Skill Implementation
 */

interface DoSomethingArgs {
  input: string;
}

interface SkillConfig {
  api_key?: string;
}

export async function doSomething(args: DoSomethingArgs): Promise<any> {
  const { input } = args;
  
  // Get skill config (if needed)
  const config: SkillConfig = {}; // Loaded by MyBot
  
  try {
    // Your implementation
    const result = await processInput(input, config.api_key);
    
    return {
      success: true,
      result: result,
      message: `Processed: ${input}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function processInput(input: string, apiKey?: string): Promise<string> {
  // Implementation details
  return `Processed: ${input}`;
}

// Export more functions as needed
export async function anotherFunction(args: any) {
  // ...
}
```

### 4. Sync Skills

```bash
# Restart the server to sync new skills
pnpm dev

# Or use the API
curl -X POST http://localhost:3000/api/skills/sync
```

### 5. Activate Skill

Via web admin:
1. Go to Settings → Skills
2. Find your skill
3. Configure if needed
4. Toggle active

Or via API:

```bash
curl -X PUT http://localhost:3000/api/skills/1 \
  -H "Content-Type: application/json" \
  -d '{"is_active": true}'
```

---

## Adding LLM Providers

MyBot supports 20+ providers via Vercel AI SDK. Here's how to add a new one:

### 1. Install Provider Package

```bash
pnpm add @ai-sdk/your-provider
```

### 2. Add Provider Info

Edit `src/agent/provider-info.ts`:

```typescript
export const PROVIDER_INFO: Record<ProviderName, ProviderInfo> = {
  // ... existing providers
  
  yourprovider: {
    displayName: "Your Provider",
    requiresKey: true,
    models: [
      "model-1",
      "model-2",
      "model-3"
    ],
    description: "Description of your provider",
    npm: "@ai-sdk/your-provider",
  },
};
```

### 3. Add Provider Creation

Edit `src/agent/providers.ts`:

```typescript
import { createYourProvider } from '@ai-sdk/your-provider';

export function createModel(config: ProviderConfig): LanguageModel {
  switch (config.name) {
    // ... existing providers
    
    case 'yourprovider': {
      const provider = createYourProvider({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(config.model);
    }
    
    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}
```

### 4. Test Provider

```typescript
// Test via code
import { testProvider } from './src/agent/providers';

const result = await testProvider({
  name: 'yourprovider',
  apiKey: 'your-api-key',
  model: 'model-1',
});

console.log(result); // { success: true, latencyMs: 234 }
```

---

## Database Operations

### Creating a New Table

1. **Define Schema** in `src/database/init.ts`:

```typescript
export function initializeDatabase() {
  // ... existing tables
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS my_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      data JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
```

2. **Create Model** in `src/database/models/my-table.ts`:

```typescript
import { db } from '../db';

export interface MyTableRow {
  id: number;
  name: string;
  data: string | null;
  created_at: string;
}

export const myTableModel = {
  create(name: string, data?: Record<string, any>) {
    const stmt = db.prepare(`
      INSERT INTO my_table (name, data)
      VALUES (?, ?)
    `);
    
    const result = stmt.run(name, data ? JSON.stringify(data) : null);
    return this.findById(result.lastInsertRowid as number);
  },
  
  findById(id: number): MyTableRow | null {
    const stmt = db.prepare('SELECT * FROM my_table WHERE id = ?');
    return stmt.get(id) as MyTableRow | null;
  },
  
  findAll(): MyTableRow[] {
    const stmt = db.prepare('SELECT * FROM my_table ORDER BY created_at DESC');
    return stmt.all() as MyTableRow[];
  },
  
  update(id: number, updates: Partial<MyTableRow>) {
    // Implementation
  },
  
  delete(id: number) {
    const stmt = db.prepare('DELETE FROM my_table WHERE id = ?');
    stmt.run(id);
  },
};
```

3. **Export Model** in `src/database/index.ts`:

```typescript
export { myTableModel } from './models/my-table';
```

### Migration Strategy

For schema changes:

```typescript
// src/database/migrations/001-add-column.ts
export function migrate001(db: Database) {
  db.exec(`
    ALTER TABLE my_table
    ADD COLUMN new_column TEXT DEFAULT NULL
  `);
}

// Run migrations on startup
if (needsMigration()) {
  migrate001(db);
}
```

---

## Testing

### Unit Tests (Coming Soon)

```typescript
// tests/tools/system-info.test.ts
import { describe, it, expect } from 'vitest';
import { systemInfo } from '@/agent/tools/system';

describe('systemInfo tool', () => {
  it('returns system information', async () => {
    const result = await systemInfo.execute({});
    
    expect(result).toHaveProperty('cpu');
    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('disk');
  });
});
```

### Integration Tests

```bash
# Test Telegram bot
curl -X POST https://api.telegram.org/bot<TOKEN>/sendMessage \
  -d "chat_id=123456789" \
  -d "text=Test message"

# Test API endpoints
curl http://localhost:3000/api/health
```

### Manual Testing Checklist

- [ ] Web admin loads
- [ ] Can login
- [ ] Can add provider
- [ ] Can send message via web
- [ ] Telegram bot responds
- [ ] Discord bot responds
- [ ] Tools execute correctly
- [ ] Skills load properly
- [ ] MCP servers connect

---

## Debugging

### Debug Logs

Enable debug logging:

```env
LOG_LEVEL=debug
```

View logs:

```bash
# Real-time logs
tail -f logs/mybot.log

# Systemd logs
sudo journalctl -u mybot-web -f

# PM2 logs
pm2 logs mybot-web
```

### VS Code Debugging

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Next.js",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["dev"],
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Telegram Bot",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["bot:dev"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Common Issues

**Problem**: `Database locked`
```bash
# Solution: Stop all processes using the database
pkill -f mybot
rm data/mybot.db-wal data/mybot.db-shm
```

**Problem**: `Tool not found`
```typescript
// Solution: Check tool is exported
import { getAllAvailableTools } from '@/agent/tools';
console.log(Object.keys(getAllAvailableTools()));
```

**Problem**: `Provider not working`
```typescript
// Solution: Test provider configuration
import { testProvider } from '@/agent/providers';
const result = await testProvider(config);
console.log(result);
```

---

## Building & Deployment

### Production Build

```bash
# Build Next.js app
pnpm build

# Test production build locally
pnpm start

# Build Docker image
docker build -t mybot:latest .
```

### Environment Variables

Production `.env`:

```env
NODE_ENV=production
APP_URL=https://mybot.example.com

# Use strong secrets in production!
ENCRYPTION_KEY=<64-char-hex>
SESSION_SECRET=<64-char-hex>
ADMIN_PASSWORD=<strong-password>

# Database
DATABASE_PATH=./data/mybot.db

# Logging
LOG_LEVEL=info
LOG_TO_FILE=true
```

---

## Best Practices

### Code Style

```typescript
// ✅ Good
export async function createConversation(params: {
  interface: string;
  userId: string;
}): Promise<Conversation> {
  const { interface: iface, userId } = params;
  
  const conversation = conversationsModel.create({
    id: generateId(),
    interface: iface,
    user_id: userId,
  });
  
  logger.info('Created conversation', { id: conversation.id });
  return conversation;
}

// ❌ Bad
export async function createConv(i, u) {
  return conversationsModel.create({ id: Math.random(), interface: i, user_id: u });
}
```

### Error Handling

```typescript
// ✅ Good
try {
  const result = await riskyOperation();
  return { success: true, result };
} catch (error) {
  logger.error('Operation failed', { error });
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

// ❌ Bad
const result = await riskyOperation(); // No error handling
```

### Security

```typescript
// ✅ Good
const sanitized = validator.escape(userInput);
const validated = schema.parse(userInput);

// ❌ Bad
db.exec(`SELECT * FROM users WHERE id = ${userId}`); // SQL injection
```

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full contribution guidelines.

### Quick Start

```bash
# 1. Fork repository
# 2. Create branch
git checkout -b feature/my-feature

# 3. Make changes
# 4. Test
pnpm typecheck
pnpm lint

# 5. Commit
git commit -m "feat: add my feature"

# 6. Push
git push origin feature/my-feature

# 7. Create PR
```

---

**Need help?** Join our [Discord](https://discord.gg/mybot) or [open an issue](https://github.com/yourusername/mybot/issues).
