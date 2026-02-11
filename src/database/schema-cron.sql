-- Cron Jobs Schema
-- Scheduled tasks that the AI agent can create and manage

-- Cron jobs table
CREATE TABLE IF NOT EXISTS cron_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,         -- standard 5-field: "0 9 * * *"
  prompt TEXT NOT NULL,                  -- the AI prompt to execute when triggered
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT DEFAULT 'system',      -- 'system', 'agent', or username
  timezone TEXT DEFAULT 'UTC',
  max_retries INTEGER DEFAULT 3,
  timeout_ms INTEGER DEFAULT 300000,     -- 5 minute default
  last_run_at TEXT,
  next_run_at TEXT,
  run_count INTEGER DEFAULT 0,
  last_status TEXT,                      -- 'success', 'failed', 'running'
  metadata TEXT,                         -- JSON for extra config
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cron executions table (history of each run)
CREATE TABLE IF NOT EXISTS cron_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_job_id INTEGER NOT NULL,
  conversation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'success', 'failed'
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  duration_ms INTEGER,
  prompt TEXT NOT NULL,
  output_summary TEXT,
  error TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  metadata TEXT,
  FOREIGN KEY (cron_job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_created_by ON cron_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_cron_executions_job ON cron_executions(cron_job_id);
CREATE INDEX IF NOT EXISTS idx_cron_executions_status ON cron_executions(status);
CREATE INDEX IF NOT EXISTS idx_cron_executions_started ON cron_executions(started_at);
