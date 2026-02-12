-- Agent Sessions and Sub-Agents Schema

-- Agent sessions table
CREATE TABLE IF NOT EXISTS agent_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  interface_type TEXT NOT NULL DEFAULT 'web',
  interface_id INTEGER,
  user_id TEXT,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider_id INTEGER,
  model_name TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  context_data TEXT,
  current_task TEXT,
  step_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (interface_id) REFERENCES interfaces(id),
  FOREIGN KEY (provider_id) REFERENCES providers(id)
);

-- Sub-agents table
CREATE TABLE IF NOT EXISTS sub_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_session_id TEXT NOT NULL,
  sub_agent_id TEXT UNIQUE NOT NULL,
  agent_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  assigned_task TEXT,
  task_result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  step_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (parent_session_id) REFERENCES agent_sessions(session_id)
);

-- MCP Servers table
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  server_type TEXT NOT NULL, -- 'stdio' or 'sse'
  transport_config TEXT NOT NULL, -- JSON with connection details
  command TEXT, -- for stdio: command to run
  args TEXT, -- for stdio: arguments (JSON array)
  env_vars TEXT, -- environment variables (JSON)
  url TEXT, -- for sse: server URL
  headers TEXT, -- for sse: custom headers (JSON)
  is_active INTEGER DEFAULT 1,
  auto_connect INTEGER DEFAULT 1,
  last_connected_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Skills table
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT DEFAULT '1.0.0',
  author TEXT,
  source TEXT, -- 'builtin', 'github', 'local', 'marketplace'
  source_url TEXT,
  triggers TEXT, -- JSON array of trigger keywords
  system_prompt TEXT,
  tools TEXT, -- JSON array of tool definitions
  config_schema TEXT, -- JSON schema for skill configuration
  config TEXT, -- JSON with actual configuration
  is_active INTEGER DEFAULT 1,
  is_builtin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT,
  use_count INTEGER DEFAULT 0
);

-- Agent skills mapping (which skills are active for which sessions)
CREATE TABLE IF NOT EXISTS agent_session_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  config TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(session_id),
  FOREIGN KEY (skill_id) REFERENCES skills(skill_id)
);

-- Platform-specific settings
CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT UNIQUE NOT NULL, -- 'linux', 'windows', 'macos'
  shell_command TEXT,
  package_manager TEXT,
  service_manager TEXT,
  path_separator TEXT,
  home_dir_env TEXT,
  temp_dir TEXT,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default platform settings
INSERT OR IGNORE INTO platform_settings (platform, shell_command, package_manager, service_manager, path_separator, home_dir_env, temp_dir) VALUES
('linux', 'bash', 'apt-get|yum|pacman', 'systemctl', '/', 'HOME', '/tmp'),
('windows', 'powershell.exe', 'choco|winget', 'sc', '\\', 'USERPROFILE', '%TEMP%'),
('macos', 'zsh', 'brew', 'launchctl', '/', 'HOME', '/tmp');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_started ON agent_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sub_agents_parent ON sub_agents(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sub_agents_status ON sub_agents(status);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_active ON mcp_servers(is_active);
CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);

-- Super Memory table for persistent cross-conversation knowledge
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom', -- 'preference', 'fact', 'project', 'context', 'custom'
  importance INTEGER NOT NULL DEFAULT 5, -- 1-10
  source TEXT, -- 'manual', 'auto-extracted', etc.
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory(importance);
