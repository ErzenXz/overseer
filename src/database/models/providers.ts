import { db, type Provider } from "../db";
import { encrypt, decrypt } from "../../lib/crypto";

export interface ProviderInput {
  name: string;
  display_name: string;
  api_key?: string;
  base_url?: string;
  model: string;
  is_active?: boolean;
  is_default?: boolean;
  priority?: number;
  max_tokens?: number | null;
  temperature?: number | null;
  config?: Record<string, unknown>;
}

export const providersModel = {
  // Find provider by ID
  findById(id: number): Provider | undefined {
    return db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as
      | Provider
      | undefined;
  },

  // Get all providers
  findAll(): Provider[] {
    return db
      .prepare("SELECT * FROM providers ORDER BY priority DESC, created_at ASC")
      .all() as Provider[];
  },

  // Get active providers
  findActive(): Provider[] {
    return db
      .prepare(
        "SELECT * FROM providers WHERE is_active = 1 ORDER BY priority DESC, created_at ASC",
      )
      .all() as Provider[];
  },

  // Get default provider
  findDefault(): Provider | undefined {
    return db
      .prepare(
        "SELECT * FROM providers WHERE is_default = 1 AND is_active = 1 LIMIT 1",
      )
      .get() as Provider | undefined;
  },

  // Create provider
  create(input: ProviderInput): Provider {
    const apiKeyEncrypted = input.api_key ? encrypt(input.api_key) : null;

    // If setting as default, unset other defaults
    if (input.is_default) {
      db.prepare("UPDATE providers SET is_default = 0").run();
    }

    const result = db
      .prepare(
        `INSERT INTO providers (name, display_name, api_key_encrypted, base_url, model, is_active, is_default, priority, max_tokens, temperature, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.display_name,
        apiKeyEncrypted,
        input.base_url || null,
        input.model,
        input.is_active !== false ? 1 : 0,
        input.is_default ? 1 : 0,
        input.priority ?? 0,
        input.max_tokens ?? null,
        input.temperature ?? 0.7,
        input.config ? JSON.stringify(input.config) : null,
      );

    return this.findById(result.lastInsertRowid as number)!;
  },

  // Update provider
  update(id: number, input: Partial<ProviderInput>): Provider | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    // If setting as default, unset other defaults
    if (input.is_default) {
      db.prepare("UPDATE providers SET is_default = 0").run();
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.name !== undefined) {
      updates.push("name = ?");
      values.push(input.name);
    }
    if (input.display_name !== undefined) {
      updates.push("display_name = ?");
      values.push(input.display_name);
    }
    if (input.api_key !== undefined) {
      updates.push("api_key_encrypted = ?");
      values.push(input.api_key ? encrypt(input.api_key) : null);
    }
    if (input.base_url !== undefined) {
      updates.push("base_url = ?");
      values.push(input.base_url || null);
    }
    if (input.model !== undefined) {
      updates.push("model = ?");
      values.push(input.model);
    }
    if (input.is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(input.is_active ? 1 : 0);
    }
    if (input.is_default !== undefined) {
      updates.push("is_default = ?");
      values.push(input.is_default ? 1 : 0);
    }
    if (input.priority !== undefined) {
      updates.push("priority = ?");
      values.push(input.priority);
    }
    if (input.max_tokens !== undefined) {
      updates.push("max_tokens = ?");
      values.push(input.max_tokens);
    }
    if (input.temperature !== undefined) {
      updates.push("temperature = ?");
      values.push(input.temperature);
    }
    if (input.config !== undefined) {
      updates.push("config = ?");
      values.push(JSON.stringify(input.config));
    }

    if (updates.length > 0) {
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      db.prepare(`UPDATE providers SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values,
      );
    }

    return this.findById(id);
  },

  // Delete provider
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM providers WHERE id = ?").run(id);
    return result.changes > 0;
  },

  // Get decrypted API key
  getApiKey(id: number): string | null {
    const provider = this.findById(id);
    if (!provider?.api_key_encrypted) return null;
    return decrypt(provider.api_key_encrypted);
  },

  // Set as default
  setDefault(id: number): void {
    db.prepare("UPDATE providers SET is_default = 0").run();
    db.prepare(
      "UPDATE providers SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(id);
  },
};
