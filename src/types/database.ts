// Database entity types - client-safe (no server dependencies)

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "developer" | "operator" | "viewer";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface Provider {
  id: number;
  name: string;
  display_name: string;
  api_key_encrypted: string | null;
  base_url: string | null;
  model: string;
  is_active: number;
  is_default: number;
  priority: number;
  max_tokens: number | null;
  temperature: number;
  config: string | null;
  created_at: string;
  updated_at: string;
}

// Interface types are extensible (new integrations can be added without DB migrations).
export type InterfaceType =
  | "telegram"
  | "discord"
  | "slack"
  | "whatsapp"
  | "matrix"
  | "web"
  | (string & {});

export interface Interface {
  id: number;
  owner_user_id?: number;
  type: InterfaceType;
  name: string;
  config: string;
  is_active: number;
  allowed_users: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  owner_user_id?: number;
  interface_id: number | null;
  interface_type: string;
  external_chat_id: string;
  external_user_id: string;
  external_username: string | null;
  title: string | null;
  metadata: string | null;
  is_active: number;
  message_count: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls: string | null;
  tool_results: string | null;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  metadata: string | null;
  created_at: string;
}

export interface ToolExecution {
  id: number;
  message_id: number | null;
  conversation_id: number | null;
  tool_name: string;
  input: string;
  output: string | null;
  success: number | null;
  error: string | null;
  execution_time_ms: number | null;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export interface Log {
  id: number;
  owner_user_id?: number | null;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  message: string;
  metadata: string | null;
  created_at: string;
}

export interface RolePermission {
  id: number;
  role: string;
  permission: string;
  created_at: string;
}

export interface UserCustomPermission {
  id: number;
  user_id: number;
  permission: string;
  granted: number; // 1 = granted, 0 = revoked
  granted_by: number | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecurityAuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  resource: string | null;
  permission: string | null;
  result: "allowed" | "denied";
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

export interface Migration {
  id: number;
  name: string;
  applied_at: string;
}

export interface CronJob {
  id: number;
  owner_user_id?: number;
  name: string;
  description: string | null;
  cron_expression: string;
  prompt: string;
  enabled: number;
  created_by: string;
  timezone: string;
  max_retries: number;
  timeout_ms: number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_status: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CronExecution {
  id: number;
  cron_job_id: number;
  owner_user_id?: number;
  conversation_id: number | null;
  status: "running" | "success" | "failed";
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  prompt: string;
  output_summary: string | null;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  tool_calls_count: number;
  metadata: string | null;
}

export interface AgentTask {
  id: number;
  owner_user_id: number;
  conversation_id: number | null;
  parent_task_id: number | null;
  title: string;
  input: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled" | string;
  priority: number;
  assigned_sub_agent_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result_summary: string | null;
  result_full: string | null;
  error: string | null;
  artifacts: string | null;
}
