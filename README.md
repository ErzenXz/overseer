# Overseer - Self-Hosted AI Agent Platform

<div align="center">

![Overseer Banner](https://via.placeholder.com/800x200/1e293b/ffffff?text=Overseer+-+Your+Intelligent+VPS+Assistant)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**A self-hosted AI assistant for your own server, files, and tools**

> Note: This project is newly renamed and hasn't been promoted yet, so the star history is effectively flat for now.

[Quick Start](https://github.com/Quad-Labs-LLC/overseer#-quick-start) • [Features](#-features) • [Documentation](#-documentation) • [Demo](#-demo) • [Repo](https://github.com/Quad-Labs-LLC/overseer)

</div>

---

## 🌟 Why Overseer?

Overseer helps you manage your own server with a chat interface.

If you are not technical, the short version is:

- you open the app in your browser
- you connect an AI provider like OpenAI
- you ask questions or give tasks in plain English
- Overseer works inside your own setup instead of a hosted third-party workspace

You can use the web chat on its own, or later connect Telegram and Discord.

### ✨ What Makes Overseer Different?

- **🎯 True Agentic Behavior**: Uses Vercel AI SDK's Tool Loop for complex, multi-step reasoning
- **🔧 Minimal Built-in Tools**: Shell execution and core file utilities for safe, flexible automation
- **🧩 Extensible Architecture**: Add skills, connect MCP servers, spawn sub-agents
- **🔐 Enterprise Security**: AES-256 encryption, user authentication, command confirmation
- **🌍 Cross-Platform**: App runs on Windows, Linux, and macOS. The bash `install.sh`/`update.sh` scripts are supported on Linux/macOS; on Windows use WSL2 (or follow the Windows Server section in the deployment docs).
- **🎨 Beautiful Admin Panel**: Modern Next.js web interface for configuration and monitoring
- **🤖 20+ LLM Providers**: OpenAI, Anthropic, Google, Groq, Ollama, and more

## 🙋 Who This Is For

- People who want a private AI workspace they control themselves
- Teams who need multiple users, permissions, and separate file areas
- Developers and operators who want chat, files, tools, and automation in one place

If you only want the shortest setup path, jump to [Quick Start](#-quick-start).

---

## 🚀 Features

### 💬 Multi-Platform Chat Interfaces

| Interface | Status | Features |
|-----------|--------|----------|
| **Telegram Bot** | ✅ Ready | Full streaming responses, rich formatting, file uploads |
| **Discord Bot** | ✅ Ready | Server integration, slash commands, role-based access |
| **Web Admin** | ✅ Ready | Real-time chat, conversation history, tool browser |
| **API** | ✅ Ready | RESTful API for custom integrations |

### 🛠️ Built-in Tools (Minimal & focused)

<details>
<summary><b>📂 File Operations</b></summary>

- Read and write files
- List directories
- Cross-platform path handling

</details>

<details>
<summary><b>📦 Shell Execution</b></summary>

- Run shell commands safely
- Optional confirmed execution mode

</details>

<details>
<summary><b>🖥️ System & Admin Tasks</b></summary>

- CPU, memory, disk monitoring (via shell)
- Process management (via shell)
- Network diagnostics (via shell)
- Service management (via shell)

</details>

<details>
<summary><b>🔍 Search & Analysis</b></summary>

- Find files by pattern
- Search in files
- Regular expression support

</details>

### 🎨 Web Admin Dashboard

```
┌─────────────────────────────────────────┐
│  🏠 Dashboard                            │
│  ├─ 📊 Conversation Statistics          │
│  ├─ 🔧 Tool Usage Charts                │
│  ├─ 💬 Recent Conversations             │
│  └─ 📈 System Metrics                   │
│                                          │
│  ⚙️ Settings                             │
│  ├─ 🤖 LLM Providers (20+ supported)    │
│  ├─ 💬 Chat Interfaces (Telegram/Discord)│
│  ├─ 🧠 SOUL.md Personality Editor       │
│  ├─ 🧩 Skills Marketplace               │
│  └─ 🔌 MCP Server Connections           │
│                                          │
│  📚 Management                           │
│  ├─ 💭 Conversation History             │
│  ├─ 🔧 Tool Browser & Stats             │
│  ├─ 📝 System Logs (Real-time)          │
│  └─ 👥 User Management                  │
└─────────────────────────────────────────┘
```

### 🧩 Advanced Features

#### **Skills System** (Inspired by Vercel's Skills.sh)
Install pre-built skills or create custom ones:
- 🔐 **Security Audit** - Scan for vulnerabilities
- 🚀 **Deploy Assistant** - Automated deployment workflows
- 🗄️ **Database Helper** - SQL query assistance
- 🐳 **Docker Helper** - Container management
- 🔍 **Code Review** - Automated code analysis
- 🌐 **Web Search** - Internet search capabilities
- ⚡ **Performance Optimizer** - System optimization
- 🎯 **API Tester** - API testing and monitoring
- 🔧 **Git Helper** - Advanced Git workflows

#### **MCP (Model Context Protocol) Integration**
Connect to MCP servers for unlimited tool expansion:
```bash
# Connect to filesystem MCP server
overseer mcp connect npx -y @modelcontextprotocol/server-filesystem /path

# Connect to GitHub MCP server
overseer mcp connect npx -y @modelcontextprotocol/server-github

# Connect to custom MCP servers via stdio or SSE
```

#### **Sub-Agents**
Spawn specialized agents for complex tasks:
```typescript
// Automatically spawns expert agents when needed
"Deploy my app" → Spawns DeployAgent
"Audit security" → Spawns SecurityAgent
"Optimize database" → Spawns DatabaseAgent
```

#### **SOUL.md Personality System**
Customize your agent's behavior, tone, and expertise:
```markdown
# SOUL.md
You are a senior DevOps engineer with expertise in:
- Cloud infrastructure (AWS, GCP, Azure)
- Container orchestration (Kubernetes, Docker)
- CI/CD pipelines (GitHub Actions, GitLab CI)

Personality: Professional, proactive, security-conscious
Always: Explain what you're doing and why
Never: Execute destructive commands without confirmation
```

### 🔐 Security Features

- **🔒 Encrypted Storage**: AES-256-GCM for all API keys and secrets
- **👤 User Authentication**: Bcrypt password hashing, session management
- **✅ Whitelist Control**: Only approved users can interact with the bot
- **⚠️ Dangerous Command Detection**: Requires confirmation for risky operations
- **📝 Audit Logging**: Complete history of all actions and decisions
- **🛡️ Rate Limiting**: Protection against abuse (coming soon)

### 🌍 Supported LLM Providers (20+)

| Provider | Models | Status |
|----------|--------|--------|
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5, O1, O3-mini | ✅ |
| **Anthropic** | Claude 3.5 Sonnet, Opus, Haiku | ✅ |
| **Google** | Gemini 2.0 Flash, 1.5 Pro/Flash | ✅ |
| **Groq** | Llama 3.3, Mixtral, Gemma | ✅ |
| **Ollama** | Any local model | ✅ |
| **Azure OpenAI** | GPT-4, GPT-3.5 | ✅ |
| **AWS Bedrock** | Claude, Llama | ✅ |
| **Mistral** | Mistral Large, Medium, Small | ✅ |
| **Cohere** | Command R+, Command | ✅ |
| **Together AI** | Llama, Mixtral | ✅ |
| **DeepSeek** | DeepSeek Chat | ✅ |
| **Perplexity** | Sonar Models | ✅ |
| **Fireworks** | Llama, Mixtral | ✅ |
| **xAI** | Grok | ✅ |
| **DeepInfra** | Various | ✅ |
| _...and more via OpenAI-compatible API_ | | |

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| **[Quick Start Guide](#-quick-start)** | Get started in 5 minutes |
| **[User Guide](https://docs.overseer.sh/guides/user-guide)** | Complete usage guide |
| **[Deployment Guide](https://docs.overseer.sh/guides/deployment)** | Production deployment |
| **[Developer Guide](https://docs.overseer.sh/guides/development)** | Build and extend Overseer |
| **[API Documentation](https://docs.overseer.sh/api-reference/overview)** | REST API reference |
| **[Architecture](https://docs.overseer.sh/concepts/architecture)** | System design & internals |
| **[Security Guide](https://docs.overseer.sh/guides/security)** | Security best practices |
| **[FAQ](https://docs.overseer.sh/guides/faq)** | Common questions |
| **[Changelog](https://docs.overseer.sh/changelog)** | Version history |
| **[Contributing](CONTRIBUTING.md)** | How to contribute |

---

## ⚡ Quick Start

This is the easiest path for first-time users.

### Prerequisites

- **Node.js** 20+ ([Download](https://nodejs.org))
- **npm** or **pnpm**

You do **not** need Telegram or Discord to try Overseer. The web chat works on its own.

### Installation

#### Option 1: One-Line Install (Recommended)

> Windows note: `install.sh`/`update.sh` are supported via **WSL2** (Ubuntu/Debian/etc). Git-Bash/MSYS/Cygwin are not supported for these scripts. For native Windows Server deployment, see [Deployment Guide](https://docs.overseer.sh/guides/deployment) (Windows Server section).

```bash
curl -fsSL https://raw.githubusercontent.com/Quad-Labs-LLC/overseer/main/scripts/install.sh | bash
```

#### Option 2: Manual Install

```bash
# 1. Clone the repository
git clone https://github.com/Quad-Labs-LLC/overseer.git
cd overseer

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
nano .env  # Edit with your settings

# 4. Initialize database
pnpm run db:init

# 5. Start services
pnpm run dev          # Web admin (http://localhost:3000)
pnpm run bot          # Telegram bot (in another terminal)
pnpm run discord      # Discord bot (optional, in another terminal)
```

### Configuration

For the smallest working setup, edit `.env` and fill in:

```env
# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# Security Keys
ENCRYPTION_KEY=your-64-char-hex-key  # Generate: openssl rand -hex 32
SESSION_SECRET=your-session-secret   # Generate: openssl rand -hex 32

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_USERS=123456789,987654321

# Discord Bot (optional)
DISCORD_BOT_TOKEN=your-discord-token
DISCORD_ALLOWED_GUILDS=server-id-1,server-id-2

# Default LLM Provider (configure via web admin or env)
DEFAULT_PROVIDER=openai
DEFAULT_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

Telegram and Discord are optional. You can add them later.

### First Steps

1. **Open the app**: visit `http://localhost:3000`
2. **Log in**: use the admin username and password you set
3. **Add an AI provider**: go to `Settings -> Providers`
4. **Test the web chat**: ask “What can you do?”
5. **Add bots later if you want**: go to `Settings -> Interfaces`

---

## 🎬 Demo

### Telegram Bot Example

```
You: Show me what's in the /var/log directory

Bot: 📂 Listing /var/log directory...
     
     Found 15 files:
     📄 syslog (2.3 MB, modified 2 min ago)
     📄 auth.log (156 KB, modified 5 min ago)
     📄 nginx-access.log (45 MB, modified 1 min ago)
     📁 nginx/ (directory)
     ...

You: What's using the most CPU?

Bot: 🔍 Checking system processes...
     
     Top 5 CPU consumers:
     1. node (12.5%) - PID 1234
     2. nginx (3.2%) - PID 5678
     3. postgres (2.1%) - PID 9012
     
     System load: 0.45, 0.52, 0.48
     CPU usage: 23%
     Memory: 4.2GB / 8GB (52%)

You: Commit my changes with a good message

Bot: 🔍 Checking git status...
     
     Modified files:
     - src/agent/agent.ts
     - src/tools/system.ts
     
     📝 Creating commit...
     ✅ Committed: "feat: add system monitoring tools"
     
     Would you like me to push to origin?
```

### Web Admin Dashboard

![Dashboard Screenshot](https://via.placeholder.com/800x400/1e293b/ffffff?text=Dashboard+Screenshot)

---

## 🆚 Comparison with Alternatives

| Feature | Overseer | OpenClaw | AutoGPT | LangChain Bots |
|---------|-------|----------|---------|----------------|
| **Self-Hosted** | ✅ | ✅ | ✅ | ⚠️ Depends |
| **VPS Tools** | Focused set | Limited | Plugin-based | Custom |
| **Multi-Platform Chat** | Telegram + Discord | CLI only | Web UI | Varies |
| **Web Admin** | ✅ Full-featured | ❌ | ⚠️ Basic | ❌ |
| **Skills System** | ✅ Marketplace | ❌ | ✅ Plugins | ⚠️ Custom |
| **MCP Support** | ✅ Native | ❌ | ❌ | ❌ |
| **Sub-Agents** | ✅ Dynamic | ❌ | ⚠️ Limited | ✅ |
| **20+ LLM Providers** | ✅ | ⚠️ Few | ⚠️ Few | ✅ |
| **Cross-Platform** | ✅ Win/Linux/Mac | ⚠️ Linux | ✅ | ✅ |
| **Production-Ready** | ✅ | ⚠️ Beta | ⚠️ Experimental | Varies |

---

## 🏗️ Architecture

```mermaid
graph TB
    subgraph "Chat Interfaces"
        TG[Telegram Bot]
        DC[Discord Bot]
        WEB[Web Admin]
    end
    
    subgraph "Core Agent"
        AGENT[AI Agent<br/>Vercel AI SDK]
        SOUL[SOUL.md<br/>Personality]
        TOOLS[Built-in Tools<br/>Minimal set]
    end
    
    subgraph "Extensions"
        SKILLS[Skills System<br/>9+ skills]
        MCP[MCP Servers<br/>Dynamic tools]
        SUBAGENT[Sub-Agents<br/>Specialized tasks]
    end
    
    subgraph "LLM Providers"
        OPENAI[OpenAI]
        ANTHROPIC[Anthropic]
        GOOGLE[Google]
        OLLAMA[Ollama]
        OTHER[15+ more...]
    end
    
    subgraph "Data Layer"
        DB[(SQLite DB)]
        CRYPTO[Encryption<br/>AES-256]
        LOGS[Audit Logs]
    end
    
    TG --> AGENT
    DC --> AGENT
    WEB --> AGENT
    
    AGENT --> SOUL
    AGENT --> TOOLS
    AGENT --> SKILLS
    AGENT --> MCP
    AGENT --> SUBAGENT
    
    AGENT --> OPENAI
    AGENT --> ANTHROPIC
    AGENT --> GOOGLE
    AGENT --> OLLAMA
    AGENT --> OTHER
    
    AGENT --> DB
    DB --> CRYPTO
    AGENT --> LOGS
```

**Learn more**: [Architecture Documentation](https://docs.overseer.sh/concepts/architecture-deep-dive)

---

## 🛠️ Development

### Project Structure

```
overseer/
├── src/
│   ├── agent/              # AI agent core
│   │   ├── agent.ts        # Main agent with Vercel AI SDK
│   │   ├── providers.ts    # LLM provider registry (20+)
│   │   ├── soul.ts         # Personality system
│   │   ├── tools/          # Built-in tools (minimal)
│   │   ├── skills/         # Skills system
│   │   ├── mcp/            # MCP client
│   │   └── subagents/      # Sub-agent manager
│   ├── bot/                # Chat interfaces
│   │   ├── index.ts        # Telegram bot
│   │   └── discord.ts      # Discord bot
│   ├── app/                # Next.js web admin
│   │   ├── api/            # API routes
│   │   ├── (dashboard)/    # Dashboard pages
│   │   └── login/          # Authentication
│   ├── database/           # SQLite database layer
│   ├── components/         # React components
│   └── lib/                # Shared utilities
├── skills/                 # Built-in skills
│   ├── security-audit/
│   ├── deploy-assistant/
│   ├── database-helper/
│   └── ...
├── apps/docs/              # Fumadocs documentation app
├── scripts/                # Installation & setup scripts
└── systemd/                # Production service files
```

### Adding Custom Tools

Create a new tool in `src/agent/tools/`:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const myCustomTool = tool({
  description: 'Description of what this tool does',
  parameters: z.object({
    param1: z.string().describe('Parameter description'),
  }),
  execute: async ({ param1 }) => {
    // Your tool implementation
    return { success: true, result: 'Done!' };
  },
});
```

**Learn more**: [Developer Guide](https://docs.overseer.sh/guides/development)

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Ways to Contribute

- 🐛 **Report Bugs**: [Open an issue](https://github.com/Quad-Labs-LLC/overseer/issues)
- 💡 **Request Features**: [Start a discussion](https://github.com/Quad-Labs-LLC/overseer/discussions)
- 🔧 **Submit PRs**: Fix bugs or add features
- 📚 **Improve Docs**: Help make documentation better
- 🧩 **Create Skills**: Build and share custom skills
- ⭐ **Star the repo**: Show your support!

---

## 📜 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Overseer is built on the shoulders of giants:

- [Vercel AI SDK](https://sdk.vercel.ai/) - AI framework and tool loop
- [Next.js](https://nextjs.org/) - React framework for web admin
- [Telegraf](https://telegraf.js.org/) - Telegram bot framework
- [Discord.js](https://discord.js.org/) - Discord bot library
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite driver
- [Model Context Protocol](https://modelcontextprotocol.io/) - Tool extension standard

---

## 🔗 Links

- **Documentation App**: [apps/docs/](apps/docs/)
- **Issues**: [GitHub Issues](https://github.com/Quad-Labs-LLC/overseer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Quad-Labs-LLC/overseer/discussions)
- **Twitter**: [@overseer](https://twitter.com/overseer)
- **Discord Community**: [Join Server](https://discord.gg/overseer)

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Quad-Labs-LLC/overseer&type=Date)](https://star-history.com/#Quad-Labs-LLC/overseer&Date)

---

<div align="center">

**Made with ❤️ by the Overseer community**

[⬆ Back to Top](#overseer---self-hosted-ai-agent-platform)

</div>
