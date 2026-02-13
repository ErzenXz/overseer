-- Agent Tasks Schema
-- Persistent work queue entries used by orchestration and the dashboard.

CREATE TABLE IF NOT EXISTS agent_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  parent_task_id INTEGER,

  title TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|running|completed|failed|canceled
  priority INTEGER NOT NULL DEFAULT 5,

  assigned_sub_agent_id TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,

  result_summary TEXT,
  result_full TEXT,
  error TEXT,
  artifacts TEXT, -- JSON

  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_owner ON agent_tasks(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_conversation ON agent_tasks(conversation_id, created_at);

