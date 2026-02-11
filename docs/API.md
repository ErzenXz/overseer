# 📡 API Documentation

Complete REST API reference for Overseer.

## Table of Contents

- [Authentication](#authentication)
- [Base URL](#base-url)
- [Rate Limits](#rate-limits)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Authentication](#authentication-endpoints)
  - [Chat](#chat-endpoints)
  - [Providers](#providers-endpoints)
  - [Interfaces](#interfaces-endpoints)
  - [SOUL](#soul-endpoints)
  - [Settings](#settings-endpoints)
  - [Conversations](#conversations-endpoints)
  - [Tools](#tools-endpoints)
  - [Skills](#skills-endpoints)
  - [MCP Servers](#mcp-servers-endpoints)
  - [Health](#health-endpoints)
- [WebSocket](#websocket)
- [SDK Examples](#sdk-examples)

---

## Authentication

Overseer uses **cookie-based session authentication** for the web admin and **API keys** for programmatic access.

### Session Authentication (Web)

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

**Cookie:**
```
Set-Cookie: overseer-session=...; Path=/; HttpOnly; Secure; SameSite=Strict
```

### API Key Authentication (Coming Soon)

```http
Authorization: Bearer your-api-key
```

---

## Base URL

- **Production**: `https://your-domain.com/api`
- **Development**: `http://localhost:3000/api`

---

## Rate Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Authentication | 5 requests | 15 minutes |
| Chat | 100 requests | 1 minute |
| General API | 100 requests | 1 minute |

**Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1612345678
```

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "details": {}
  }
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

### Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Not authenticated |
| `FORBIDDEN` | Not authorized |
| `VALIDATION_ERROR` | Invalid input |
| `NOT_FOUND` | Resource not found |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `INTERNAL_ERROR` | Server error |

---

## Endpoints

### Authentication Endpoints

#### `POST /api/auth/login`

Login to web admin.

**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### `POST /api/auth/logout`

Logout from current session.

**Response:**
```json
{
  "success": true
}
```

#### `GET /api/auth/me`

Get current user info.

**Response:**
```json
{
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

---

### Chat Endpoints

#### `POST /api/chat`

Create new conversation and send message.

**Request:**
```json
{
  "message": "What's the server status?",
  "interface": "web",
  "userId": "user123"
}
```

**Response:**
```json
{
  "conversationId": "conv_abc123",
  "response": "The server is running well. CPU: 23%, Memory: 52%, Disk: 45%",
  "tools_used": ["systemInfo"],
  "usage": {
    "promptTokens": 150,
    "completionTokens": 45,
    "totalTokens": 195
  }
}
```

#### `POST /api/chat/:conversationId`

Continue existing conversation.

**Request:**
```json
{
  "message": "Show me the logs"
}
```

**Response:**
```json
{
  "conversationId": "conv_abc123",
  "response": "Here are the recent logs...",
  "tools_used": ["readFile"],
  "usage": {
    "promptTokens": 200,
    "completionTokens": 100,
    "totalTokens": 300
  }
}
```

#### `GET /api/chat/:conversationId`

Get conversation history.

**Response:**
```json
{
  "conversationId": "conv_abc123",
  "interface": "web",
  "userId": "user123",
  "created_at": "2024-01-01T10:00:00.000Z",
  "updated_at": "2024-01-01T10:05:00.000Z",
  "messages": [
    {
      "id": 1,
      "role": "user",
      "content": "What's the server status?",
      "timestamp": "2024-01-01T10:00:00.000Z"
    },
    {
      "id": 2,
      "role": "assistant",
      "content": "The server is running well...",
      "timestamp": "2024-01-01T10:00:05.000Z",
      "tools_used": ["systemInfo"]
    }
  ]
}
```

#### `DELETE /api/chat/:conversationId`

Delete conversation.

**Response:**
```json
{
  "success": true
}
```

---

### Providers Endpoints

#### `GET /api/providers`

List all LLM providers.

**Response:**
```json
{
  "providers": [
    {
      "id": 1,
      "name": "openai",
      "model": "gpt-4o",
      "is_default": true,
      "is_active": true,
      "max_tokens": 4096,
      "temperature": 0.7,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### `POST /api/providers`

Add new LLM provider.

**Request:**
```json
{
  "name": "anthropic",
  "model": "claude-3-5-sonnet-latest",
  "apiKey": "sk-ant-...",
  "maxTokens": 8192,
  "temperature": 0.7,
  "isDefault": false
}
```

**Response:**
```json
{
  "id": 2,
  "name": "anthropic",
  "model": "claude-3-5-sonnet-latest",
  "is_default": false,
  "is_active": true
}
```

#### `PUT /api/providers/:id`

Update provider configuration.

**Request:**
```json
{
  "model": "claude-3-opus-latest",
  "temperature": 0.8,
  "isDefault": true
}
```

**Response:**
```json
{
  "success": true
}
```

#### `DELETE /api/providers/:id`

Delete provider.

**Response:**
```json
{
  "success": true
}
```

#### `POST /api/providers/:id/test`

Test provider connection.

**Response:**
```json
{
  "success": true,
  "latencyMs": 234,
  "model": "gpt-4o"
}
```

---

### Interfaces Endpoints

#### `GET /api/interfaces`

List configured chat interfaces.

**Response:**
```json
{
  "interfaces": [
    {
      "id": 1,
      "name": "telegram",
      "is_active": true,
      "config": {
        "bot_token": "***",
        "allowed_users": ["123456789"]
      }
    },
    {
      "id": 2,
      "name": "discord",
      "is_active": true,
      "config": {
        "bot_token": "***",
        "allowed_guilds": ["server123"]
      }
    }
  ]
}
```

#### `POST /api/interfaces`

Add chat interface.

**Request:**
```json
{
  "name": "telegram",
  "config": {
    "bot_token": "123456:ABC-DEF...",
    "allowed_users": ["123456789"]
  }
}
```

**Response:**
```json
{
  "id": 1,
  "name": "telegram",
  "is_active": true
}
```

#### `PUT /api/interfaces/:id`

Update interface configuration.

**Request:**
```json
{
  "config": {
    "allowed_users": ["123456789", "987654321"]
  },
  "is_active": true
}
```

**Response:**
```json
{
  "success": true
}
```

#### `DELETE /api/interfaces/:id`

Delete interface.

**Response:**
```json
{
  "success": true
}
```

---

### SOUL Endpoints

#### `GET /api/soul`

Get current SOUL.md content.

**Response:**
```json
{
  "content": "# SOUL.md\n\nYou are a helpful VPS assistant..."
}
```

#### `PUT /api/soul`

Update SOUL.md content.

**Request:**
```json
{
  "content": "# SOUL.md\n\nYou are a senior DevOps engineer..."
}
```

**Response:**
```json
{
  "success": true
}
```

---

### Settings Endpoints

#### `GET /api/settings`

Get system settings.

**Response:**
```json
{
  "settings": {
    "app_name": "Overseer",
    "version": "1.0.0",
    "default_provider_id": 1,
    "log_level": "info",
    "max_conversation_length": 50
  }
}
```

#### `PUT /api/settings`

Update settings.

**Request:**
```json
{
  "default_provider_id": 2,
  "log_level": "debug"
}
```

**Response:**
```json
{
  "success": true
}
```

---

### Conversations Endpoints

#### `GET /api/conversations`

List all conversations.

**Query Parameters:**
- `interface` - Filter by interface (telegram, discord, web)
- `userId` - Filter by user ID
- `limit` - Results per page (default: 50)
- `offset` - Pagination offset

**Response:**
```json
{
  "conversations": [
    {
      "id": "conv_abc123",
      "interface": "telegram",
      "userId": "123456789",
      "message_count": 15,
      "created_at": "2024-01-01T10:00:00.000Z",
      "updated_at": "2024-01-01T10:30:00.000Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### `GET /api/conversations/stats`

Get conversation statistics.

**Response:**
```json
{
  "total_conversations": 250,
  "total_messages": 5000,
  "active_today": 15,
  "by_interface": {
    "telegram": 150,
    "discord": 80,
    "web": 20
  },
  "top_users": [
    {
      "userId": "123456789",
      "conversation_count": 50,
      "message_count": 500
    }
  ]
}
```

---

### Tools Endpoints

#### `GET /api/tools`

List all available tools.

**Response:**
```json
{
  "tools": {
    "builtin": [
      {
        "name": "systemInfo",
        "category": "system",
        "description": "Get system information",
        "usage_count": 150
      }
    ],
    "skills": [
      {
        "name": "security-audit_scan",
        "skill": "security-audit",
        "description": "Scan for security vulnerabilities"
      }
    ],
    "mcp": [
      {
        "name": "filesystem_read",
        "server": "filesystem",
        "description": "Read file via MCP"
      }
    ]
  },
  "counts": {
    "builtin": 35,
    "skills": 8,
    "mcp": 5,
    "total": 48
  }
}
```

#### `GET /api/tools/stats`

Get tool usage statistics.

**Response:**
```json
{
  "total_calls": 10000,
  "by_tool": {
    "systemInfo": 1500,
    "readFile": 1200,
    "executeShellCommand": 800
  },
  "by_category": {
    "system": 3000,
    "files": 2500,
    "git": 1500
  }
}
```

---

### Skills Endpoints

#### `GET /api/skills`

List all skills.

**Response:**
```json
{
  "skills": [
    {
      "id": 1,
      "skill_id": "security-audit",
      "name": "Security Audit",
      "description": "Scan for security vulnerabilities",
      "version": "1.0.0",
      "is_active": true,
      "is_builtin": true,
      "tools": ["scan", "report"],
      "use_count": 45
    }
  ]
}
```

#### `POST /api/skills`

Install skill from GitHub.

**Request:**
```json
{
  "source": "github",
  "url": "https://github.com/user/overseer-skill-example"
}
```

**Response:**
```json
{
  "id": 5,
  "skill_id": "user_overseer-skill-example",
  "name": "Example Skill",
  "is_active": false
}
```

#### `PUT /api/skills/:id`

Update skill configuration.

**Request:**
```json
{
  "is_active": true,
  "config": {
    "api_key": "..."
  }
}
```

**Response:**
```json
{
  "success": true
}
```

#### `DELETE /api/skills/:id`

Uninstall skill.

**Response:**
```json
{
  "success": true
}
```

---

### MCP Servers Endpoints

#### `GET /api/mcp/servers`

List MCP servers.

**Response:**
```json
{
  "servers": [
    {
      "id": 1,
      "name": "filesystem",
      "server_type": "stdio",
      "is_active": true,
      "connected": true,
      "tool_count": 5,
      "last_connected_at": "2024-01-01T10:00:00.000Z"
    }
  ]
}
```

#### `POST /api/mcp/servers`

Add MCP server.

**Request (stdio):**
```json
{
  "name": "filesystem",
  "server_type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
  "auto_connect": true
}
```

**Request (SSE):**
```json
{
  "name": "remote-mcp",
  "server_type": "sse",
  "url": "https://mcp.example.com",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

**Response:**
```json
{
  "id": 2,
  "name": "filesystem",
  "is_active": true
}
```

#### `POST /api/mcp/servers/:id/connect`

Connect to MCP server.

**Response:**
```json
{
  "success": true,
  "tool_count": 5
}
```

#### `POST /api/mcp/servers/:id/disconnect`

Disconnect from MCP server.

**Response:**
```json
{
  "success": true
}
```

#### `DELETE /api/mcp/servers/:id`

Delete MCP server.

**Response:**
```json
{
  "success": true
}
```

---

### Health Endpoints

#### `GET /api/health`

Check API health.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "database": "connected",
  "providers": {
    "total": 3,
    "active": 2
  },
  "memory": {
    "used": "256 MB",
    "total": "4 GB"
  }
}
```

---

## WebSocket

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/api/ws');

ws.onopen = () => {
  console.log('Connected');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

### Events

#### Subscribe to Conversation

```json
{
  "type": "subscribe",
  "conversationId": "conv_abc123"
}
```

#### Message Events

```json
{
  "type": "message",
  "conversationId": "conv_abc123",
  "message": {
    "role": "assistant",
    "content": "Analyzing system...",
    "delta": true
  }
}
```

#### Tool Call Events

```json
{
  "type": "tool_call",
  "conversationId": "conv_abc123",
  "tool": "systemInfo",
  "args": {},
  "result": "..."
}
```

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Using fetch
async function sendMessage(message: string) {
  const response = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'overseer-session=...'
    },
    body: JSON.stringify({
      message,
      interface: 'api',
      userId: 'user123'
    })
  });

  const data = await response.json();
  return data;
}

// Using axios
import axios from 'axios';

const client = axios.create({
  baseURL: 'http://localhost:3000/api',
  withCredentials: true
});

async function login(username: string, password: string) {
  const response = await client.post('/auth/login', {
    username,
    password
  });
  return response.data;
}

async function chat(message: string) {
  const response = await client.post('/chat', {
    message,
    interface: 'api',
    userId: 'user123'
  });
  return response.data;
}
```

### Python

```python
import requests

class OverseerClient:
    def __init__(self, base_url='http://localhost:3000/api'):
        self.base_url = base_url
        self.session = requests.Session()
    
    def login(self, username, password):
        response = self.session.post(
            f'{self.base_url}/auth/login',
            json={'username': username, 'password': password}
        )
        return response.json()
    
    def chat(self, message, conversation_id=None):
        url = f'{self.base_url}/chat'
        if conversation_id:
            url += f'/{conversation_id}'
        
        response = self.session.post(
            url,
            json={'message': message}
        )
        return response.json()
    
    def get_providers(self):
        response = self.session.get(f'{self.base_url}/providers')
        return response.json()

# Usage
client = OverseerClient()
client.login('admin', 'password')
result = client.chat('What is the server status?')
print(result['response'])
```

### cURL

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' \
  -c cookies.txt

# Send message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"message":"What is the server status?","interface":"api","userId":"user123"}'

# Get providers
curl -X GET http://localhost:3000/api/providers \
  -b cookies.txt

# Add provider
curl -X POST http://localhost:3000/api/providers \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name":"openai",
    "model":"gpt-4o",
    "apiKey":"sk-...",
    "isDefault":true
  }'
```

### Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/cookiejar"
)

type OverseerClient struct {
    baseURL string
    client  *http.Client
}

func NewClient(baseURL string) *OverseerClient {
    jar, _ := cookiejar.New(nil)
    return &OverseerClient{
        baseURL: baseURL,
        client:  &http.Client{Jar: jar},
    }
}

func (c *OverseerClient) Login(username, password string) error {
    payload := map[string]string{
        "username": username,
        "password": password,
    }
    
    body, _ := json.Marshal(payload)
    resp, err := c.client.Post(
        c.baseURL+"/auth/login",
        "application/json",
        bytes.NewBuffer(body),
    )
    
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    
    return nil
}

func (c *OverseerClient) Chat(message string) (map[string]interface{}, error) {
    payload := map[string]string{
        "message": message,
        "interface": "api",
        "userId": "user123",
    }
    
    body, _ := json.Marshal(payload)
    resp, err := c.client.Post(
        c.baseURL+"/chat",
        "application/json",
        bytes.NewBuffer(body),
    )
    
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    
    return result, nil
}

func main() {
    client := NewClient("http://localhost:3000/api")
    client.Login("admin", "password")
    
    result, _ := client.Chat("What is the server status?")
    fmt.Println(result["response"])
}
```

---

## Webhooks (Coming Soon)

Subscribe to events via webhooks:

```json
{
  "url": "https://your-app.com/webhook",
  "events": ["message.created", "tool.executed"],
  "secret": "your-webhook-secret"
}
```

---

## API Versioning

Current version: **v1**

All endpoints are prefixed with `/api` (v1 is default). Future versions will use `/api/v2`, etc.

---

**Need help?** See the [User Guide](USER_GUIDE.md) or [open an issue](https://github.com/ErzenXz/overseer/issues).
