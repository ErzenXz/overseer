import { db, type AgentTask } from "../db";

export interface AgentTaskInput {
  owner_user_id: number;
  conversation_id?: number | null;
  parent_task_id?: number | null;
  title: string;
  input: string;
  status?: AgentTask["status"];
  priority?: number;
  assigned_sub_agent_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  result_summary?: string | null;
  result_full?: string | null;
  error?: string | null;
  artifacts?: Record<string, unknown> | null;
}

export const agentTasksModel = {
  findById(id: number): AgentTask | undefined {
    return db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id) as
      | AgentTask
      | undefined;
  },

  findByOwner(
    ownerUserId: number,
    options?: { status?: string; limit?: number; offset?: number },
  ): AgentTask[] {
    const limit = options?.limit ?? 200;
    const offset = options?.offset ?? 0;
    const status = options?.status;

    if (status) {
      return db
        .prepare(
          `SELECT * FROM agent_tasks
           WHERE owner_user_id = ? AND status = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(ownerUserId, status, limit, offset) as AgentTask[];
    }

    return db
      .prepare(
        `SELECT * FROM agent_tasks
         WHERE owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(ownerUserId, limit, offset) as AgentTask[];
  },

  create(input: AgentTaskInput): AgentTask {
    const result = db
      .prepare(
        `INSERT INTO agent_tasks (
          owner_user_id, conversation_id, parent_task_id,
          title, input, status, priority, assigned_sub_agent_id,
          result_summary, result_full, error, artifacts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.owner_user_id,
        input.conversation_id ?? null,
        input.parent_task_id ?? null,
        input.title,
        input.input,
        input.status ?? "queued",
        input.priority ?? 5,
        input.assigned_sub_agent_id ?? null,
        input.result_summary ?? null,
        input.result_full ?? null,
        input.error ?? null,
        input.artifacts ? JSON.stringify(input.artifacts) : null,
      );

    return this.findById(result.lastInsertRowid as number)!;
  },

  update(
    id: number,
    updates: Partial<Omit<AgentTaskInput, "owner_user_id">>,
  ): AgentTask | undefined {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      if (k === "artifacts") {
        fields.push("artifacts = ?");
        values.push(v ? JSON.stringify(v) : null);
        continue;
      }
      fields.push(`${k} = ?`);
      values.push(v as any);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    db.prepare(`UPDATE agent_tasks SET ${fields.join(", ")} WHERE id = ?`).run(
      ...values,
    );
    return this.findById(id);
  },
};
