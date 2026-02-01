# 📘 User Guide

Complete guide for using MyBot - from first steps to advanced features.

## Table of Contents

- [Getting Started](#getting-started)
- [Using Telegram Bot](#using-telegram-bot)
- [Using Discord Bot](#using-discord-bot)
- [Web Admin Panel](#web-admin-panel)
- [Managing LLM Providers](#managing-llm-providers)
- [Customizing SOUL.md](#customizing-soulmd)
- [Installing Skills](#installing-skills)
- [Connecting MCP Servers](#connecting-mcp-servers)
- [User Management](#user-management)
- [Tips & Tricks](#tips--tricks)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Getting Started

### First Login

1. **Access Web Admin**: http://your-server:3000
2. **Login** with credentials from `.env`:
   - Username: Value of `ADMIN_USERNAME`
   - Password: Value of `ADMIN_PASSWORD`

3. **Add LLM Provider**:
   - Go to **Settings → Providers**
   - Click **Add Provider**
   - Choose provider (OpenAI, Anthropic, etc.)
   - Enter API key
   - Select model
   - Click **Save**

4. **Configure Chat Interface**:
   - Go to **Settings → Interfaces**
   - Enable **Telegram** or **Discord**
   - Enter bot token
   - Add allowed users
   - Click **Save**

### Quick Setup Checklist

- [ ] Login to web admin
- [ ] Add at least one LLM provider
- [ ] Set default provider
- [ ] Configure Telegram or Discord
- [ ] Send test message
- [ ] Customize SOUL.md (optional)
- [ ] Install skills (optional)

---

## Using Telegram Bot

### Initial Setup

1. **Create Bot**:
   - Open Telegram
   - Message [@BotFather](https://t.me/BotFather)
   - Send `/newbot`
   - Follow prompts
   - Save bot token

2. **Get Your User ID**:
   - Message [@userinfobot](https://t.me/userinfobot)
   - Save your user ID

3. **Configure MyBot**:
   - Add token to Settings → Interfaces
   - Add your user ID to allowed users
   - Save and restart bot service

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Start conversation |
| `/help` | Show help message |
| `/reset` | Clear conversation history |
| `/status` | Show bot and system status |
| `/model` | Show current LLM model |
| `/switch [provider]` | Switch LLM provider |

### Conversation Examples

#### **System Monitoring**

```
You: How's my server doing?

Bot: 🖥️ System Status:
     
     CPU: 23% (2 cores)
     Memory: 4.2GB / 8GB (52%)
     Disk: 45GB / 100GB (45%)
     Uptime: 14 days, 3 hours
     Load: 0.45, 0.52, 0.48
     
     Everything looks healthy! ✅
```

#### **File Operations**

```
You: Show me the contents of /etc/nginx/nginx.conf

Bot: 📄 /etc/nginx/nginx.conf (1.2 KB)
     
     user www-data;
     worker_processes auto;
     pid /run/nginx.pid;
     
     [... file contents ...]
     
You: Create a backup of that file

Bot: ✅ Backup created: /etc/nginx/nginx.conf.backup
     Timestamp: 2024-02-01 10:30:45
```

#### **Git Operations**

```
You: What's the status of my project?

Bot: 📦 Git Status - /home/user/myproject
     
     Branch: main
     
     Modified:
     - src/app.ts
     - README.md
     
     Untracked:
     - new-feature.ts
     
     Would you like me to show the diff?
     
You: Yes, show diff for app.ts

Bot: 📝 Diff for src/app.ts:
     
     +++ Added lines
     --- Removed lines
     [... diff output ...]
```

#### **Database Queries** (with database-helper skill)

```
You: Show me recent user registrations

Bot: 🗄️ Querying database...
     
     Recent registrations (last 7 days):
     1. user@example.com - 2024-02-01
     2. another@example.com - 2024-01-30
     3. test@example.com - 2024-01-28
     
     Total: 3 new users
```

### Features

#### **Streaming Responses**
Messages are streamed in real-time as the agent thinks and executes tools.

#### **Rich Formatting**
- **Bold**, *italic*, `code`
- Lists and tables
- Emojis for better UX
- Code blocks with syntax highlighting

#### **File Uploads/Downloads**
```
You: Send me the server logs

Bot: 📎 [server.log] (2.3 MB)
     
     Downloaded from: /var/log/myapp/server.log
```

Upload files to server:
```
[Upload file via Telegram]

Bot: ✅ File received: document.pdf
     Saved to: /home/user/uploads/document.pdf
     Size: 1.5 MB
```

#### **Multi-Step Tasks**
```
You: Deploy my app to production

Bot: 🚀 Deploying application...
     
     Step 1/5: Running tests... ✅
     Step 2/5: Building application... ✅
     Step 3/5: Pushing to Docker registry... ✅
     Step 4/5: Updating k8s deployment... ✅
     Step 5/5: Verifying health checks... ✅
     
     Deployment successful! 🎉
     URL: https://app.example.com
```

---

## Using Discord Bot

### Initial Setup

1. **Create Discord Application**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click **New Application**
   - Go to **Bot** tab
   - Click **Add Bot**
   - Save bot token

2. **Invite Bot to Server**:
   - Go to **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
   - Copy generated URL
   - Open URL to invite bot

3. **Configure MyBot**:
   - Add token to Settings → Interfaces
   - Add server ID to allowed guilds
   - Save and restart bot service

### Slash Commands

| Command | Description |
|---------|-------------|
| `/chat [message]` | Send message to agent |
| `/status` | Show bot status |
| `/model` | Show current model |
| `/reset` | Clear conversation |
| `/help` | Show help |

### Thread-Based Conversations

Each user gets their own thread for conversations:

```
User: /chat What's the server status?

Bot: [Creates thread "Conversation with @User"]
     🖥️ System Status:
     CPU: 23%, Memory: 52%, Disk: 45%
```

### Features

- **Slash Commands**: Native Discord commands
- **Embeds**: Rich message formatting
- **Role-Based Access**: Restrict by Discord roles
- **Server-Specific**: Different configurations per server
- **Thread Support**: Organized conversations

---

## Web Admin Panel

### Dashboard

The main dashboard shows:

```
┌─────────────────────────────────────────┐
│  📊 Overview                            │
├─────────────────────────────────────────┤
│  Total Conversations: 250               │
│  Messages Today: 145                    │
│  Active Users: 23                       │
│  Tools Used (24h): 89                   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  💬 Recent Conversations                │
├─────────────────────────────────────────┤
│  user123 (Telegram) - 5 min ago         │
│  "Deploy my app to production"          │
│                                         │
│  admin (Web) - 15 min ago               │
│  "Show server logs"                     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  🔧 Top Tools (Today)                   │
├─────────────────────────────────────────┤
│  systemInfo: 45 calls                   │
│  readFile: 32 calls                     │
│  gitStatus: 18 calls                    │
└─────────────────────────────────────────┘
```

### Conversations Page

View and search all conversations:

- **Filter** by interface, user, date
- **Search** message content
- **View** full conversation history
- **Export** conversations (CSV, JSON)
- **Delete** old conversations

### Settings

#### **Providers Tab**

Manage LLM providers:
- Add new providers
- Test connection
- Set default
- Configure parameters (temperature, max tokens)
- View usage statistics

#### **Interfaces Tab**

Configure chat interfaces:
- Telegram bot settings
- Discord bot settings
- Allowed users/servers
- Enable/disable interfaces

#### **SOUL Tab**

Edit agent personality:
- Live editor with syntax highlighting
- Preview changes
- Restore defaults
- Version history (coming soon)

#### **Skills Tab**

Manage skills:
- Browse installed skills
- Install from marketplace
- Install from GitHub
- Configure skill settings
- Enable/disable skills
- View skill usage

#### **MCP Servers Tab**

Manage MCP connections:
- Add MCP servers (stdio/SSE)
- Connect/disconnect
- View available tools
- Configure server settings

### Tools Browser

View all available tools:

```
┌─────────────────────────────────────────┐
│  Category: System (9 tools)             │
├─────────────────────────────────────────┤
│  systemInfo                             │
│  "Get system information"               │
│  Used: 150 times                        │
│                                         │
│  processInfo                            │
│  "List running processes"               │
│  Used: 45 times                         │
└─────────────────────────────────────────┘
```

Filter by:
- Category (system, files, git, etc.)
- Source (built-in, skill, MCP)
- Usage
- Name

### Chat Interface

Built-in web chat:

1. Click **Chat** in sidebar
2. Type message
3. Press Enter or click Send
4. View real-time streaming response
5. See tool calls in sidebar

Features:
- Markdown rendering
- Code syntax highlighting
- Tool call visualization
- Export conversation
- Share conversation (coming soon)

---

## Managing LLM Providers

### Adding a Provider

1. **Go to Settings → Providers**
2. **Click "Add Provider"**
3. **Fill in details**:
   - Provider: Choose from dropdown
   - Model: Select model
   - API Key: Enter key (encrypted at rest)
   - Base URL: (optional) Custom endpoint
   - Max Tokens: (optional) Override default
   - Temperature: 0.0 - 2.0 (default: 0.7)
4. **Test Connection** (recommended)
5. **Set as Default** (optional)
6. **Save**

### Supported Providers

See [README](../README.md#-supported-llm-providers-20) for full list.

### Provider-Specific Setup

#### **OpenAI**

```
Provider: OpenAI
Model: gpt-4o
API Key: sk-...
Base URL: (leave empty)
```

Get API key: https://platform.openai.com/api-keys

#### **Anthropic (Claude)**

```
Provider: Anthropic
Model: claude-3-5-sonnet-latest
API Key: sk-ant-...
```

Get API key: https://console.anthropic.com/

#### **Google (Gemini)**

```
Provider: Google
Model: gemini-2.0-flash
API Key: ...
```

Get API key: https://makersuite.google.com/app/apikey

#### **Ollama (Local)**

```
Provider: Ollama
Model: llama3.2
Base URL: http://localhost:11434
API Key: (leave empty)
```

Install Ollama: https://ollama.ai

#### **Groq**

```
Provider: Groq
Model: llama-3.3-70b-versatile
API Key: gsk_...
```

Get API key: https://console.groq.com/

### Switching Providers

**Via Web Admin:**
1. Go to Providers
2. Click star icon on desired provider
3. "Set as Default"

**Via Telegram:**
```
/switch anthropic
```

**Via API:**
```bash
curl -X PUT http://localhost:3000/api/providers/2 \
  -d '{"isDefault": true}'
```

---

## Customizing SOUL.md

SOUL.md defines your agent's personality, expertise, and behavior.

### Editing SOUL.md

1. **Go to Settings → SOUL**
2. **Edit** in the editor
3. **Save** changes
4. Agent uses new personality immediately

### SOUL.md Structure

```markdown
# SOUL.md

## Identity
Who is the agent? What's its name and purpose?

## Expertise
What domains is the agent expert in?

## Personality Traits
How should the agent communicate?

## Behavior Rules
What should the agent always/never do?

## Example Interactions
How should the agent respond to common queries?
```

### Example SOUL.md

```markdown
# SOUL.md

## Identity
You are **DevOpsBot**, a senior DevOps engineer with 10+ years of experience. You specialize in:
- Cloud infrastructure (AWS, GCP, Azure)
- Container orchestration (Kubernetes, Docker)
- CI/CD pipelines (GitHub Actions, GitLab CI)
- Infrastructure as Code (Terraform, CloudFormation)
- Monitoring & observability (Prometheus, Grafana)

## Personality Traits
- **Professional**: Clear, concise communication
- **Proactive**: Suggest improvements and best practices
- **Security-Conscious**: Always consider security implications
- **Educational**: Explain what you're doing and why
- **Careful**: Never execute destructive commands without confirmation

## Behavior Rules

### Always
- Explain what commands do before executing them
- Suggest safer alternatives for risky operations
- Follow the principle of least privilege
- Document changes you make
- Consider performance and cost implications

### Never
- Execute `rm -rf /` or similar destructive commands
- Share API keys or secrets in responses
- Make assumptions about production systems
- Skip confirmation for database operations
- Ignore error messages

## Communication Style
- Use emojis sparingly (🚀 ✅ ⚠️ ❌)
- Format code in ```language blocks
- Use bullet points for lists
- Be concise but thorough
- Ask for clarification when needed

## Example Interactions

**User**: "Deploy my app"

**You**:
1. First, let me check the current deployment status
2. I'll run tests to ensure everything passes
3. Then I'll create a new deployment
4. Finally, I'll verify the deployment is healthy

Would you like me to proceed?

**User**: "Delete all logs"

**You**: 
⚠️ Warning: This will permanently delete all logs.

Instead, I recommend:
1. Archive logs older than 30 days
2. Compress and move to cold storage
3. Keep recent logs for debugging

Which approach would you prefer?
```

### Tips for Great SOUL.md

1. **Be Specific**: Clear identity and expertise
2. **Set Boundaries**: Define what the agent can/can't do
3. **Give Examples**: Show desired behavior patterns
4. **Consider Context**: Tailor to your use case
5. **Iterate**: Refine based on actual usage

---

## Installing Skills

Skills add specialized capabilities to MyBot.

### Built-in Skills

MyBot comes with 9+ built-in skills:

| Skill | Description |
|-------|-------------|
| **security-audit** | Scan for security vulnerabilities |
| **deploy-assistant** | Automated deployment workflows |
| **database-helper** | SQL query assistance |
| **docker-helper** | Container management |
| **git-helper** | Advanced Git workflows |
| **code-review** | Automated code analysis |
| **web-search** | Internet search capabilities |
| **performance-optimizer** | System optimization |
| **api-tester** | API testing and monitoring |

### Installing Skills

#### **From Web Admin**

1. Go to **Settings → Skills**
2. Click **Browse Marketplace** (coming soon)
3. Or click **Install from GitHub**
4. Enter GitHub URL:
   ```
   https://github.com/user/mybot-skill-name
   ```
5. Click **Install**
6. Configure skill settings
7. **Enable** skill

#### **Manual Installation**

1. Clone skill to `skills/` directory:
   ```bash
   cd skills/
   git clone https://github.com/user/skill-name
   ```

2. Restart MyBot:
   ```bash
   systemctl restart mybot-web
   ```

3. Skill appears in Settings → Skills

### Configuring Skills

Some skills require configuration:

1. Go to skill settings
2. Fill in required fields (API keys, etc.)
3. Save configuration
4. Enable skill

**Example** (web-search skill):
```json
{
  "search_api_key": "your-api-key",
  "max_results": 5,
  "safe_search": true
}
```

### Using Skills

Skills are automatically activated based on triggers:

```
You: Search the web for "latest Node.js features"

Bot: 🔍 Using web-search skill...
     
     Top results:
     1. Node.js 22 New Features
        https://nodejs.org/...
     
     2. What's New in Node.js
        https://blog.nodejs.org/...
```

Or explicitly:

```
You: Use the security audit skill to scan my app

Bot: 🔐 Running security scan...
     [... security audit results ...]
```

---

## Connecting MCP Servers

MCP (Model Context Protocol) allows connecting external tool servers.

### Adding MCP Server

#### **stdio Server** (Local)

1. Go to **Settings → MCP Servers**
2. Click **Add Server**
3. Fill in:
   - Name: `filesystem`
   - Type: `stdio`
   - Command: `npx`
   - Args: `-y @modelcontextprotocol/server-filesystem /path`
   - Auto Connect: ✓
4. Click **Save & Connect**

#### **SSE Server** (Remote)

```
Name: remote-mcp
Type: SSE
URL: https://mcp.example.com
Headers: {"Authorization": "Bearer token"}
Auto Connect: ✓
```

### Available MCP Servers

- **@modelcontextprotocol/server-filesystem**: File operations
- **@modelcontextprotocol/server-github**: GitHub integration
- **@modelcontextprotocol/server-postgres**: PostgreSQL queries
- **@modelcontextprotocol/server-slack**: Slack integration
- Custom MCP servers

### Using MCP Tools

MCP tools appear alongside built-in tools:

```
You: List files in the project directory

Bot: 📂 Using filesystem MCP server...
     
     Files in /project:
     - README.md
     - package.json
     - src/
     - tests/
```

---

## User Management

### Adding Users (Coming Soon)

Currently MyBot supports single-user admin access.

Multi-user support planned for v2.0:
- User roles (admin, user, read-only)
- User permissions
- Activity tracking
- User-specific settings

### Telegram User Whitelist

Configure in `.env`:

```env
TELEGRAM_ALLOWED_USERS=123456789,987654321,111222333
```

Or via Settings → Interfaces:
```
Allowed Users: 123456789, 987654321
```

### Discord Server Whitelist

```env
DISCORD_ALLOWED_GUILDS=server-id-1,server-id-2
```

---

## Tips & Tricks

### Power User Tips

1. **Combine Commands**:
   ```
   Check server status, show recent logs, and list running Docker containers
   ```

2. **Use Natural Language**:
   ```
   Instead of: "Execute systemctl status nginx"
   Use: "Is nginx running?"
   ```

3. **Request Explanations**:
   ```
   You: Why is my server slow?
   
   Bot: I'll investigate:
        1. Check CPU usage
        2. Check memory usage
        3. Look for resource-heavy processes
        4. Analyze recent logs
   ```

4. **Multi-Step Workflows**:
   ```
   Set up a new website: install nginx, configure SSL, create vhost, restart service
   ```

### Keyboard Shortcuts (Web Admin)

- `Ctrl+K`: Focus search
- `Ctrl+N`: New conversation
- `Ctrl+/`: Toggle sidebar
- `Ctrl+Enter`: Send message

### Conversation Context

The agent remembers context within a conversation:

```
You: Show me the nginx config

Bot: [shows config]

You: Create a backup of that

Bot: ✅ Created backup: nginx.conf.backup
     (remembers which file)

You: Now check if the service is running

Bot: ✅ nginx is active and running
```

---

## Best Practices

### Security

1. **Strong Passwords**: Use strong admin password
2. **Whitelist Users**: Only allow trusted Telegram/Discord users
3. **API Key Rotation**: Rotate LLM API keys regularly
4. **SSL/TLS**: Use HTTPS for web admin
5. **Confirm Dangerous Commands**: Always review before executing

### Performance

1. **Choose Right Model**: Use faster models for simple tasks
2. **Clear Old Conversations**: Delete unnecessary conversation history
3. **Monitor Usage**: Check token usage to control costs
4. **Use Caching**: Enable result caching for repeated queries

### Organization

1. **Use Descriptive Names**: Name conversations clearly
2. **Regular Backups**: Backup database regularly
3. **Monitor Logs**: Check logs for errors
4. **Update Regularly**: Keep MyBot updated

---

## Troubleshooting

### Bot Not Responding

**Check**:
1. Bot service is running: `systemctl status mybot-telegram`
2. Your user ID is in allowed users
3. Bot token is correct
4. LLM provider is configured
5. Check logs: `journalctl -u mybot-telegram -f`

### Slow Responses

**Possible causes**:
1. Slow LLM provider (try Groq for speed)
2. Complex multi-step task
3. Large file operations
4. Network latency

**Solutions**:
- Use faster model (e.g., gpt-4o-mini, gemini-flash)
- Break complex tasks into steps
- Increase timeout settings

### "Not Authorized" Errors

**Fix**:
1. Login to web admin
2. Check session hasn't expired
3. Clear cookies and login again

### Database Locked

**Fix**:
```bash
systemctl stop mybot-web mybot-telegram
rm data/mybot.db-wal data/mybot.db-shm
systemctl start mybot-web mybot-telegram
```

### Tools Not Working

**Check**:
1. Tool is enabled
2. Permissions are correct
3. Dependencies are installed
4. Check tool logs

---

## Need More Help?

- 📖 [API Documentation](API.md)
- 🏗️ [Architecture Guide](ARCHITECTURE.md)
- 👨‍💻 [Developer Guide](DEVELOPMENT.md)
- 🔒 [Security Guide](SECURITY.md)
- ❓ [FAQ](FAQ.md)
- 💬 [Discord Community](https://discord.gg/mybot)
- 🐛 [Report Issues](https://github.com/yourusername/mybot/issues)

---

**Happy automating!** 🚀
