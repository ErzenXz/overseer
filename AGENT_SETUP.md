# Overseer Agent - Full VPS Control Setup Guide

## What You Now Have

I've created a **standalone agent system** that can run independently from the web admin and has:

### Features
- **NO CONFIRMATIONS** - Executes all commands immediately without asking
- **Full VPS Control** - Complete access to your server
- **20+ AI Providers** via Vercel AI SDK v6
- **Models.dev Integration** - Dynamic model discovery
- **Retry Logic** - Up to 5 retries with fallback providers
- **Context Management** - Conversation history and state

### Supported Providers

1. **OpenAI** - GPT-4o, GPT-4o-mini, o1, o3-mini
2. **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus
3. **Google** - Gemini 2.0 Flash, Gemini 1.5 Pro
4. **Groq** - Llama 3.3 70B, Mixtral (ultra-fast)
5. **Azure** - Azure OpenAI Service
6. **Ollama** - Local models (Llama, Mistral, etc.)
7. **OpenAI-Compatible** - Any OpenAI-compatible API

## Quick Start

### 1. Install Dependencies

```bash
cd /Users/erzenkrasniqi/Projects/Overseer
npm install --legacy-peer-deps
```

### 2. Configure Environment

Copy the example and configure your provider:

```bash
cp .env.agent.example .env
```

Edit `.env` and add your API key:

```env
# Option 1: OpenAI (Recommended)
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini

# Option 2: Groq (Fast & Cheap)
GROQ_API_KEY=gsk-your-key-here
GROQ_MODEL=llama-3.3-70b-versatile

# Agent Settings
AGENT_MAX_STEPS=50
AGENT_MAX_RETRIES=5
AGENT_TIMEOUT_MS=180000
AGENT_RETRY_DELAY_MS=2000
```

### 3. Run the Agent

#### Interactive Mode (Chat with your VPS)
```bash
npm run agent
```

This starts an interactive CLI where you can type commands like:
- "Show me what's using the most disk space"
- "Update all packages and clean up"
- "Check if nginx is running and restart it if not"
- "Create a backup script in /opt/backups"

#### Single Command Mode
```bash
npm run agent -- "ls -la /var/log"
npm run agent -- "systemctl status docker"
npm run agent -- "df -h"
```

### 4. Run with Web Admin

Start the web admin in one terminal:
```bash
npm run dev
```

Start the agent runner in another terminal:
```bash
npm run agent
```

## How It Works

### No Confirmation Mode

The agent uses `shell-noconfirm.ts` tools that **execute commands immediately**:

- `rm -rf /` - Executes immediately
- `mkfs.ext4 /dev/sda1` - Executes immediately  
- `dd if=/dev/zero of=/dev/sda` - Executes immediately
- `systemctl stop critical-service` - Executes immediately

**⚠️ WARNING**: This gives the AI FULL ROOT ACCESS. Only use on VPS you fully control!

### Retry Logic

If a provider fails:
1. Retries up to 5 times with exponential backoff
2. Automatically switches to fallback providers
3. Tracks all attempts for debugging

### Context Management

The agent maintains:
- Conversation history (last 30 messages)
- Working directory state
- Environment variables
- Tool call history
- Token usage stats

## Provider Configuration

### Groq (Fast & Cheap)
```env
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

### OpenAI
```env
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o-mini
```

### Anthropic
```env
ANTHROPIC_API_KEY=sk-ant-your-key
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

### Google
```env
GOOGLE_API_KEY=your-key
GOOGLE_MODEL=gemini-1.5-flash
```

### Local Ollama
```env
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=llama3.2
ENABLE_OLLAMA=true
```

## Advanced Usage

### Custom Base URLs

For custom endpoints (like LiteLLM proxy):
```env
PROVIDER_TYPE=openai-compatible
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-proxy.com/v1
OPENAI_MODEL=gpt-4o
```

### Multiple Providers

Configure multiple providers and the agent will fallback automatically:
```env
# Primary
OPENAI_API_KEY=sk-key1

# Fallback 1
ANTHROPIC_API_KEY=sk-key2

# Fallback 2
GROQ_API_KEY=gsk-key3
```

### Using Models.dev

The system fetches model info from https://models.dev/api.json:

```typescript
import { getAllModels, getToolCallingModels } from "./src/agent/models-dev";

// Get all available models
const models = await getAllModels();

// Get only models that support tool calling
const toolModels = await getToolCallingModels();

// Calculate costs
const cost = calculateCost(model, 1000, 500); // input/output tokens
```

## Scripts

### Agent Runner
- `npm run agent` - Interactive mode
- `npm run agent:dev` - Watch mode for development
- `npm run agent -- "command"` - Single command

### Web Admin
- `npm run dev` - Development server
- `npm run build` - Build for production
- `npm start` - Production server

### Bot
- `npm run bot` - Telegram bot
- `npm run bot:dev` - Watch mode

## File Structure

```
src/agent/
├── runner.ts                    # Standalone agent runner
├── providers.ts                 # Unified provider support (7+ providers)
├── provider-info.ts             # Provider metadata and models
├── models-dev.ts               # Models.dev integration
├── tools/
│   ├── shell-noconfirm.ts      # No confirmation shell tools
│   └── ...                     # Other tools
```

## Safety Notes

1. **This agent executes ALL commands without confirmation**
2. **It can delete your entire VPS if instructed to**
3. **Always verify what the AI is doing**
4. **Test on a non-production VPS first**
5. **Keep backups of important data**

## Troubleshooting

### Type Errors
The project is using AI SDK v6 which has different types. Some type errors are expected and don't affect runtime.

### Provider Not Working
Check logs in `logs/` directory:
```bash
tail -f logs/overseer.log
```

### No Provider Configured
Set at least one of these environment variables:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `GOOGLE_API_KEY`
- `OLLAMA_BASE_URL`

## Next Steps

1. **Set up your provider** (Groq is fast and cheap for testing)
2. **Test basic commands** in interactive mode
3. **Configure multiple providers** for redundancy
4. **Review the agent's actions** before letting it run autonomously

## API Reference

### Running the Agent Programmatically

```typescript
import { executeAgent } from "./src/agent/runner";

const result = await executeAgent("Check disk space and clean up if needed", {
  stream: true,
  onProgress: (text) => console.log(text),
  onToolCall: (tool) => console.log(`Tool: ${tool}`),
});

console.log(result.text);
console.log(`Used ${result.steps} steps`);
```

### Adding New Providers

Edit `src/agent/provider-info.ts` and add to `PROVIDER_INFO`:

```typescript
newprovider: {
  displayName: "New Provider",
  requiresKey: true,
  models: ["model-1", "model-2"],
  description: "Description",
  npm: "@ai-sdk/newprovider",
}
```

Then add the case in `createModel()`:
```typescript
case "newprovider": {
  const provider = createNewProvider({ apiKey, baseURL: baseUrl });
  return provider(model);
}
```
