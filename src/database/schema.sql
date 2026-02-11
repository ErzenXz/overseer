-- Overseer Database Schema
-- SQLite Database for storing all application data

-- =====================================================
-- USERS (Web Admin Authentication)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- =====================================================
-- SESSIONS (Web Admin Sessions)
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- PROVIDERS (LLM Provider Configuration)
-- =====================================================
CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                    -- 'openai', 'anthropic', 'google', 'ollama'
    display_name TEXT NOT NULL,            -- 'OpenAI', 'Anthropic', etc.
    api_key_encrypted TEXT,                -- Encrypted API key
    base_url TEXT,                         -- Custom base URL (for Ollama, etc.)
    model TEXT NOT NULL,                   -- 'gpt-4o', 'claude-3-opus', etc.
    is_active BOOLEAN DEFAULT 1,
    is_default BOOLEAN DEFAULT 0,
    priority INTEGER DEFAULT 0,            -- For fallback ordering
    max_tokens INTEGER DEFAULT 4096,
    temperature REAL DEFAULT 0.7,
    config TEXT,                           -- JSON for additional config
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INTERFACES (Chat Interface Configuration)
-- =====================================================
CREATE TABLE IF NOT EXISTS interfaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('telegram', 'discord', 'slack', 'web')),
    name TEXT NOT NULL,                    -- User-friendly name
    config TEXT NOT NULL,                  -- JSON config (bot token, etc.)
    is_active BOOLEAN DEFAULT 1,
    allowed_users TEXT,                    -- JSON array of allowed user IDs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- CONVERSATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interface_id INTEGER,
    interface_type TEXT NOT NULL,          -- 'telegram', 'discord', etc.
    external_chat_id TEXT NOT NULL,        -- Telegram chat ID, Discord channel, etc.
    external_user_id TEXT NOT NULL,        -- Telegram user ID, Discord user ID, etc.
    external_username TEXT,                -- Username if available
    title TEXT,                            -- Conversation title/summary
    metadata TEXT,                         -- JSON metadata
    is_active BOOLEAN DEFAULT 1,
    message_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (interface_id) REFERENCES interfaces(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_external ON conversations(interface_type, external_chat_id, external_user_id);

-- =====================================================
-- MESSAGES
-- =====================================================
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    tool_calls TEXT,                       -- JSON array of tool calls
    tool_results TEXT,                     -- JSON array of tool results
    model_used TEXT,                       -- Model that generated this message
    input_tokens INTEGER,
    output_tokens INTEGER,
    metadata TEXT,                         -- JSON metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- =====================================================
-- TOOL EXECUTIONS LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS tool_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    conversation_id INTEGER,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,                   -- JSON input
    output TEXT,                           -- Tool output
    success BOOLEAN,
    error TEXT,
    execution_time_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_conversation ON tool_executions(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool ON tool_executions(tool_name, created_at);

-- =====================================================
-- SYSTEM SETTINGS
-- =====================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- SYSTEM LOGS
-- =====================================================
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
    category TEXT NOT NULL,                -- 'agent', 'telegram', 'system', etc.
    message TEXT NOT NULL,
    metadata TEXT,                         -- JSON metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category, created_at);

-- =====================================================
-- DEFAULT DATA
-- =====================================================

-- Default settings
INSERT OR IGNORE INTO settings (key, value, description) VALUES
    ('agent.max_steps', '25', 'Maximum number of agent steps per request'),
    ('agent.max_retries', '3', 'Maximum retries for failed operations'),
    ('agent.timeout_ms', '120000', 'Agent timeout in milliseconds'),
    ('tools.require_confirmation', 'true', 'Require confirmation for destructive commands'),
    ('tools.shell_timeout_ms', '30000', 'Shell command timeout in milliseconds'),
    ('tools.max_file_size_mb', '10', 'Maximum file size for read/write operations'),
    ('ui.theme', 'dark', 'Web UI theme'),
    ('soul.version', '1', 'SOUL.md version for tracking changes');
