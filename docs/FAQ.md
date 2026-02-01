# ❓ Frequently Asked Questions

Common questions and answers about MyBot.

## Table of Contents

- [General](#general)
- [Installation & Setup](#installation--setup)
- [Usage](#usage)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Performance](#performance)
- [Security](#security)
- [Cost & Pricing](#cost--pricing)
- [Advanced Topics](#advanced-topics)

---

## General

### What is MyBot?

MyBot is a **self-hosted AI agent platform** that gives you complete control over your server through natural language. It combines:
- **Chat interfaces** (Telegram, Discord, Web)
- **35+ built-in tools** for server management
- **20+ LLM providers** (OpenAI, Claude, Gemini, local models)
- **Extensible architecture** (skills, MCP servers, sub-agents)

### How is MyBot different from ChatGPT or Claude?

| Feature | MyBot | ChatGPT | Claude |
|---------|-------|---------|--------|
| **Server Control** | ✅ Full VPS access | ❌ No | ❌ No |
| **Self-Hosted** | ✅ Your infrastructure | ❌ Cloud only | ❌ Cloud only |
| **Data Privacy** | ✅ Complete | ⚠️ Sent to OpenAI | ⚠️ Sent to Anthropic |
| **Customization** | ✅ Full (SOUL.md, tools) | ⚠️ Limited | ⚠️ Limited |
| **Cost** | 💰 API usage only | 💰💰 $20+/month | 💰💰 $20+/month |
| **Provider Choice** | ✅ 20+ providers | ❌ OpenAI only | ❌ Anthropic only |

### What can MyBot do?

**Server Management:**
- Monitor system resources (CPU, memory, disk)
- Manage processes and services
- Execute shell commands
- File operations (read, write, search)

**Development:**
- Git operations (status, commit, push)
- Code deployment
- Docker container management
- Database queries

**Automation:**
- Scheduled tasks
- Workflow automation
- Multi-step operations
- Integration with external services (via MCP)

### Is MyBot production-ready?

**Yes**, MyBot is production-ready for:
- ✅ Personal VPS management
- ✅ Small team server administration
- ✅ Development environment automation
- ✅ Internal tools and workflows

**For enterprise use**, consider:
- Load balancing (if needed)
- Database migration to PostgreSQL
- Additional security hardening
- Professional support

### Is MyBot open source?

**Yes!** MyBot is MIT licensed. You can:
- ✅ Use commercially
- ✅ Modify source code
- ✅ Create derivative works
- ✅ Distribute copies

---

## Installation & Setup

### What are the system requirements?

**Minimum:**
- OS: Ubuntu 20.04+, Debian 11+, Windows Server 2019+, macOS 12+
- RAM: 2GB
- CPU: 1 core
- Disk: 5GB
- Node.js: 20.0.0+

**Recommended:**
- RAM: 4GB
- CPU: 2 cores
- Disk: 10GB
- Dedicated server or VPS

### Which VPS provider should I use?

**Cost-effective:**
- **Hetzner** CX21: €5.83/month (2 vCPU, 4GB RAM) - Best value
- **Linode** Shared 4GB: $24/month

**Premium:**
- **DigitalOcean** Basic Droplet: $24/month
- **AWS** t3.medium: ~$30/month (more features)

**Free tier:**
- **Oracle Cloud** Always Free: 1GB RAM (limited but free)

### Do I need a domain name?

**Optional, but recommended** for:
- SSL/TLS certificates (Let's Encrypt)
- Professional appearance
- Easy access to web admin

Without domain:
- Access via IP: `http://YOUR_IP:3000`
- Self-signed SSL certificate
- Works fine for personal use

### How do I get a Telegram bot token?

1. Open Telegram
2. Message [@BotFather](https://t.me/BotFather)
3. Send `/newbot`
4. Follow prompts to choose name and username
5. Copy the token (format: `123456:ABC-DEF...`)
6. Add to MyBot Settings → Interfaces

**Find your user ID:**
1. Message [@userinfobot](https://t.me/userinfobot)
2. Copy your numeric user ID
3. Add to `TELEGRAM_ALLOWED_USERS`

### Can I use MyBot without a bot? Just the web interface?

**Yes!** The Telegram/Discord bots are optional. You can:
1. Install MyBot
2. Configure LLM provider
3. Use only the web admin chat interface
4. Skip bot configuration entirely

---

## Usage

### Which LLM provider should I use?

Depends on your priorities:

**Best Overall:**
- **OpenAI GPT-4o**: Great balance of speed, quality, cost
- **Anthropic Claude 3.5 Sonnet**: Best for complex reasoning

**Fastest:**
- **Groq** (llama-3.3-70b): Ultra-fast, good quality, cheap
- **Google Gemini Flash**: Very fast, good for simple tasks

**Cheapest:**
- **Ollama** (local): Free! But requires more RAM
- **Groq**: $0.59/M tokens (very cheap)

**Best Quality:**
- **OpenAI O1**: Best reasoning, slow, expensive
- **Claude 3.5 Opus**: Very capable, expensive

**Privacy-Focused:**
- **Ollama** (local): Data never leaves your server
- **Azure OpenAI**: Enterprise compliance

### Can I use local models (Ollama)?

**Yes!** MyBot supports Ollama:

1. **Install Ollama:**
   ```bash
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. **Pull a model:**
   ```bash
   ollama pull llama3.2
   ```

3. **Add to MyBot:**
   - Provider: Ollama
   - Model: llama3.2
   - Base URL: http://localhost:11434
   - No API key needed

**Pros:**
- ✅ Free (no API costs)
- ✅ Private (data stays local)
- ✅ Fast (local inference)

**Cons:**
- ❌ Requires more RAM (8GB+ recommended)
- ❌ Lower quality than GPT-4/Claude
- ❌ Limited tool calling (depends on model)

### How do I customize the agent's personality?

Edit **SOUL.md** via web admin:

1. Go to Settings → SOUL
2. Edit the markdown content
3. Save changes
4. Agent uses new personality immediately

**Example customizations:**
- Professional vs casual tone
- Domain expertise (DevOps, developer, sysadmin)
- Safety preferences (cautious vs permissive)
- Response format (concise vs detailed)

See [User Guide - SOUL.md](USER_GUIDE.md#customizing-soulmd) for examples.

### Can MyBot send me notifications?

**Via Telegram:** Yes, the bot can proactively message you:
```typescript
// In a skill or tool
await telegramBot.sendMessage(userId, 'Server CPU is at 95%!');
```

**Via Discord:** Yes, with mentions or DMs

**Via Email:** Not built-in, but you can:
- Create a skill that sends emails
- Use MCP server for email
- Integrate with external service (SendGrid, etc.)

### How do I update MyBot?

```bash
# 1. Backup database
cp data/mybot.db data/mybot.db.backup

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
npm install

# 4. Rebuild
npm run build

# 5. Restart services
systemctl restart mybot-web mybot-telegram mybot-discord
```

**Check for updates:**
```bash
git fetch origin
git log HEAD..origin/main --oneline
```

---

## Configuration

### How many conversations can MyBot handle?

**Tested capacity:**
- 1,000 conversations/day on 2GB RAM server
- 10,000+ messages/day

**Database size:**
- ~100KB per conversation (with 20 messages)
- 10GB disk can store ~100,000 conversations

For higher loads, consider:
- Periodic conversation cleanup
- Database archiving
- Migration to PostgreSQL
- Horizontal scaling

### Can I use multiple LLM providers simultaneously?

**Yes!** You can:
1. Configure multiple providers
2. Set one as default
3. Switch per-conversation (via `/switch` command)
4. Use different providers for different skills

**Use cases:**
- GPT-4o for complex tasks, GPT-4o-mini for simple
- Claude for writing, GPT-4 for code
- Ollama for privacy-sensitive operations
- Groq for speed-critical tasks

### How do I whitelist multiple Telegram users?

**Method 1: Environment variable**
```env
TELEGRAM_ALLOWED_USERS=123456789,987654321,111222333
```

**Method 2: Web admin**
1. Settings → Interfaces → Telegram
2. Allowed Users: `123456789, 987654321`
3. Save

### Can I run multiple bots (Telegram + Discord) simultaneously?

**Yes!** Run all services:

```bash
# Using systemd
systemctl start mybot-web mybot-telegram mybot-discord

# Or manually
npm run dev         # Terminal 1: Web
npm run bot         # Terminal 2: Telegram
npm run discord     # Terminal 3: Discord

# Or with concurrently
npm run bots        # Starts both bots
```

Each interface maintains separate conversations.

---

## Troubleshooting

### Bot doesn't respond to messages

**Checklist:**
1. ✅ Bot service is running: `systemctl status mybot-telegram`
2. ✅ Your user ID is in `TELEGRAM_ALLOWED_USERS`
3. ✅ Bot token is correct
4. ✅ LLM provider is configured and has credits
5. ✅ No errors in logs: `journalctl -u mybot-telegram -f`

**Common causes:**
- Typo in user ID
- Bot token expired/invalid
- LLM API key issues
- Network connectivity

### "Database is locked" error

**Cause:** Multiple processes accessing database simultaneously

**Solution:**
```bash
# Stop all services
systemctl stop mybot-web mybot-telegram mybot-discord

# Remove lock files
rm data/mybot.db-wal data/mybot.db-shm

# Start services one by one
systemctl start mybot-web
systemctl start mybot-telegram
```

**Prevention:**
- Use WAL mode (already default)
- Don't run multiple instances
- Proper service dependencies

### High memory usage

**Normal usage:**
- Web admin: 200-300 MB
- Telegram bot: 150-200 MB
- Total: ~500-700 MB

**If higher:**
1. Check conversation count: `SELECT COUNT(*) FROM conversations`
2. Clean old conversations
3. Restart services
4. Reduce Node.js memory: `NODE_OPTIONS="--max-old-space-size=1024"`

### Slow responses

**Possible causes:**
1. **Slow LLM provider**: Try Groq or Gemini Flash
2. **Large context**: Reduce conversation history length
3. **Complex tools**: Some tools take time
4. **Network latency**: Check connectivity

**Solutions:**
- Use faster model (gpt-4o-mini, gemini-flash)
- Reduce `maxSteps` in agent config
- Optimize tool implementations
- Increase server resources

---

## Performance

### How much does it cost to run MyBot?

**Server costs:**
- VPS: $6-30/month (depends on provider)
- Domain: $10-15/year (optional)
- SSL: Free (Let's Encrypt)

**LLM API costs:**
Varies by usage and provider:

| Usage | Model | Est. Cost |
|-------|-------|-----------|
| **Light** (100 msg/day) | GPT-4o-mini | $3/month |
| **Medium** (500 msg/day) | GPT-4o | $30/month |
| **Heavy** (2000 msg/day) | GPT-4o | $120/month |
| **Any** | Ollama (local) | $0 (free!) |

**Cost optimization:**
- Use Ollama for simple tasks
- Use GPT-4o-mini instead of GPT-4o
- Use Groq (very cheap)
- Set conversation limits

### Can I limit API usage to control costs?

**Currently:** Not built-in

**Workarounds:**
1. **LLM provider limits**: Set budgets in OpenAI/Anthropic dashboard
2. **Message limits**: Track usage in database
3. **Rate limiting**: Limit messages per user/day
4. **Model selection**: Use cheaper models by default

**Coming soon:**
- Per-user quotas
- Monthly spending limits
- Usage alerts

### How can I improve response speed?

1. **Use faster models:**
   - Groq: Ultra-fast
   - Gemini Flash: Very fast
   - GPT-4o-mini: Fast and cheap

2. **Optimize configuration:**
   ```env
   MAX_TOKENS=1000  # Reduce for faster responses
   TEMPERATURE=0.5  # Slightly faster
   ```

3. **Reduce tool steps:**
   - Simpler SOUL.md instructions
   - Fewer enabled skills
   - Optimize tool implementations

4. **Server optimization:**
   - More RAM/CPU
   - Closer to LLM provider (region)
   - SSD storage

---

## Security

### Is MyBot secure?

**Yes**, when configured properly:
- ✅ AES-256 encryption for secrets
- ✅ Bcrypt password hashing
- ✅ Session security (HttpOnly cookies)
- ✅ User whitelisting
- ✅ Command confirmation
- ✅ Audit logging

**You must:**
- Use strong passwords
- Keep encryption keys secret
- Use HTTPS/SSL
- Regularly update
- Review audit logs

See [Security Guide](SECURITY.md) for details.

### Can MyBot access my entire server?

**Yes**, MyBot runs with the permissions of its user.

**Best practice:**
- Run as dedicated user (not root)
- Limit file permissions
- Use command confirmation
- Review SOUL.md carefully
- Monitor audit logs

**For maximum security:**
- Run in Docker container
- Use AppArmor/SELinux
- Sandbox dangerous operations
- Restrict network access

### What data does MyBot store?

**Stored locally (in your database):**
- Conversations and messages
- Tool execution history
- LLM API keys (encrypted)
- User authentication data
- System settings

**Sent to LLM providers:**
- Your messages
- Conversation context
- Tool call results
- SOUL.md system prompt

**Not stored:**
- LLM API responses are not logged (by default)
- Passwords are never logged
- Encryption keys are never logged

### How do I back up MyBot?

**Automated backup:**
```bash
#!/bin/bash
# backup.sh
cp data/mybot.db backups/mybot_$(date +%Y%m%d).db
cp .env backups/.env_$(date +%Y%m%d)

# Keep last 30 days
find backups/ -mtime +30 -delete
```

**Add to crontab:**
```bash
0 2 * * * /path/to/backup.sh
```

**What to backup:**
- ✅ `data/mybot.db` (database)
- ✅ `.env` (configuration)
- ✅ `src/agent/soul.md` (if customized)
- ✅ `skills/` (if custom skills)

---

## Cost & Pricing

### Is MyBot free?

**The software is free** (MIT licensed), but you pay for:
- **VPS/hosting**: $6-30/month
- **LLM API usage**: Varies ($0-100+/month)
- *(Optional) Domain*: ~$10/year

**Total:** $10-150/month depending on usage

**Free options:**
- Ollama (local models) = $0 API costs
- Oracle Cloud free tier = $0 hosting
- **Total: $0/month!** (but requires 8GB+ RAM server)

### Which is cheaper: OpenAI or Anthropic?

**For GPT-4o vs Claude 3.5 Sonnet:**

| Model | Input | Output | 1M tokens |
|-------|-------|--------|-----------|
| GPT-4o | $2.50 | $10.00 | ~$12.50 |
| Claude 3.5 Sonnet | $3.00 | $15.00 | ~$18.00 |
| GPT-4o-mini | $0.15 | $0.60 | ~$0.75 |
| Gemini Flash | $0.075 | $0.30 | ~$0.375 |
| Groq (Llama 3.3) | $0.59 | $0.79 | ~$0.69 |

**Cheapest: Groq or Gemini Flash**

### Can I use MyBot commercially?

**Yes!** MIT license allows:
- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use

**You must:**
- Include original license
- Include copyright notice

**No warranty** (use at your own risk)

---

## Advanced Topics

### Can I extend MyBot with custom tools?

**Yes!** See [Developer Guide - Adding Tools](DEVELOPMENT.md#adding-custom-tools)

**Example:**
```typescript
// src/agent/tools/my-tool.ts
export const myTool = tool({
  description: 'My custom tool',
  parameters: z.object({
    input: z.string(),
  }),
  execute: async ({ input }) => {
    return { result: `Processed: ${input}` };
  },
});
```

### How do I create a custom skill?

See [Developer Guide - Creating Skills](DEVELOPMENT.md#creating-skills)

**Quick steps:**
1. Create `skills/my-skill/` directory
2. Add `skill.json` manifest
3. Implement functions in `index.ts`
4. Restart MyBot
5. Enable skill in settings

### Can I integrate with other services (Slack, email, etc.)?

**Yes, via:**

**1. MCP Servers:**
- Install MCP server for service
- Connect via Settings → MCP Servers
- Use new tools automatically

**2. Custom Skills:**
- Create skill with API integration
- Install and enable
- Use via natural language

**3. Webhooks (planned):**
- Subscribe to events
- Send to external service
- Receive webhooks from services

### Can I run MyBot in a Docker container?

**Yes!** See [Deployment Guide - Docker](DEPLOYMENT.md#docker-deployment)

```bash
docker-compose up -d
```

**Benefits:**
- Isolated environment
- Easy deployment
- Reproducible builds
- Resource limits

### How do I scale MyBot for high traffic?

**Current architecture:** Single server, good for 1000+ conversations/day

**For higher scale:**

1. **Horizontal scaling:**
   - Multiple web instances behind load balancer
   - Shared database (PostgreSQL)
   - Redis for sessions/cache

2. **Vertical scaling:**
   - More RAM/CPU
   - SSD storage
   - Optimize database queries

3. **Optimize:**
   - Enable caching
   - Reduce conversation history
   - Use faster LLM models
   - Async job queue

See [Architecture - Scalability](ARCHITECTURE.md#scalability-considerations)

---

## Still Have Questions?

- 📖 **Read the docs**: [/docs](/docs)
- 💬 **Join Discord**: [discord.gg/mybot](https://discord.gg/mybot)
- 🐛 **Report issues**: [GitHub Issues](https://github.com/yourusername/mybot/issues)
- 📧 **Email**: support@mybot.io
- 🐦 **Twitter**: [@mybot](https://twitter.com/mybot)

---

**Contributing**: Know the answer to a common question? Add it to this FAQ via pull request!
