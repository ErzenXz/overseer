import { db, type Interface } from "../db";
import { encrypt, decrypt } from "../../lib/crypto";

export interface InterfaceConfig {
  bot_token?: string;
  client_id?: string;  // Discord client ID
  webhook_url?: string;
  webhook_secret?: string;
  allowed_guilds?: string[];  // Discord guild/server IDs
  [key: string]: unknown;
}

export interface InterfaceInput {
  type: "telegram" | "discord" | "slack" | "web";
  name: string;
  config: InterfaceConfig;
  is_active?: boolean;
  allowed_users?: string[];
}

export const interfacesModel = {
  // Find interface by ID
  findById(id: number): Interface | undefined {
    return db.prepare("SELECT * FROM interfaces WHERE id = ?").get(id) as
      | Interface
      | undefined;
  },

  // Find interface by type
  findByType(type: string): Interface | undefined {
    return db
      .prepare("SELECT * FROM interfaces WHERE type = ? LIMIT 1")
      .get(type) as Interface | undefined;
  },

  // Get all interfaces
  findAll(): Interface[] {
    return db
      .prepare("SELECT * FROM interfaces ORDER BY created_at DESC")
      .all() as Interface[];
  },

  // Get active interfaces
  findActive(): Interface[] {
    return db
      .prepare("SELECT * FROM interfaces WHERE is_active = 1 ORDER BY created_at DESC")
      .all() as Interface[];
  },

  // Create interface
  create(input: InterfaceInput): Interface {
    // Encrypt sensitive data in config
    const configToStore = { ...input.config };
    if (configToStore.bot_token) {
      configToStore.bot_token = encrypt(configToStore.bot_token);
    }
    if (configToStore.webhook_secret) {
      configToStore.webhook_secret = encrypt(configToStore.webhook_secret);
    }

    const result = db
      .prepare(
        `INSERT INTO interfaces (type, name, config, is_active, allowed_users)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.type,
        input.name,
        JSON.stringify(configToStore),
        input.is_active !== false ? 1 : 0,
        input.allowed_users ? JSON.stringify(input.allowed_users) : null
      );

    return this.findById(result.lastInsertRowid as number)!;
  },

  // Update interface
  update(id: number, input: Partial<InterfaceInput>): Interface | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.type !== undefined) {
      updates.push("type = ?");
      values.push(input.type);
    }
    if (input.name !== undefined) {
      updates.push("name = ?");
      values.push(input.name);
    }
    if (input.config !== undefined) {
      const configToStore = { ...input.config };
      if (configToStore.bot_token) {
        configToStore.bot_token = encrypt(configToStore.bot_token as string);
      }
      if (configToStore.webhook_secret) {
        configToStore.webhook_secret = encrypt(configToStore.webhook_secret as string);
      }
      updates.push("config = ?");
      values.push(JSON.stringify(configToStore));
    }
    if (input.is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(input.is_active ? 1 : 0);
    }
    if (input.allowed_users !== undefined) {
      updates.push("allowed_users = ?");
      values.push(JSON.stringify(input.allowed_users));
    }

    if (updates.length > 0) {
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      db.prepare(
        `UPDATE interfaces SET ${updates.join(", ")} WHERE id = ?`
      ).run(...values);
    }

    return this.findById(id);
  },

  // Delete interface
  delete(id: number): boolean {
    const result = db.prepare("DELETE FROM interfaces WHERE id = ?").run(id);
    return result.changes > 0;
  },

  // Get decrypted config
  getDecryptedConfig(id: number): InterfaceConfig | null {
    const iface = this.findById(id);
    if (!iface) return null;

    const config = JSON.parse(iface.config) as InterfaceConfig;
    if (config.bot_token && typeof config.bot_token === "string") {
      try {
        config.bot_token = decrypt(config.bot_token);
      } catch {
        // Already decrypted or invalid
      }
    }
    if (config.webhook_secret && typeof config.webhook_secret === "string") {
      try {
        config.webhook_secret = decrypt(config.webhook_secret);
      } catch {
        // Already decrypted or invalid
      }
    }
    return config;
  },

  // Get allowed users
  getAllowedUsers(id: number): string[] {
    const iface = this.findById(id);
    if (!iface?.allowed_users) return [];
    return JSON.parse(iface.allowed_users) as string[];
  },

  // Check if user is allowed
  isUserAllowed(id: number, userId: string): boolean {
    const allowedUsers = this.getAllowedUsers(id);
    if (allowedUsers.length === 0) return true; // No restrictions
    return allowedUsers.includes(userId);
  },
};
