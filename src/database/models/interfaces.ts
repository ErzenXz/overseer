import { db, type Interface, type InterfaceType } from "../db";
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
  type: InterfaceType;
  name: string;
  config: InterfaceConfig;
  is_active?: boolean;
  allowed_users?: string[];
  owner_user_id?: number;
}

const SECRET_CONFIG_KEYS = [
  "bot_token",
  "webhook_secret",
  "signing_secret",
  "app_token",
  "access_token",
  "refresh_token",
  "client_secret",
] as const;

function encryptKnownSecrets(config: Record<string, unknown>) {
  for (const key of SECRET_CONFIG_KEYS) {
    const val = config[key];
    if (typeof val === "string" && val.length > 0) {
      config[key] = encrypt(val);
    }
  }
}

function decryptKnownSecrets(config: Record<string, unknown>) {
  for (const key of SECRET_CONFIG_KEYS) {
    const val = config[key];
    if (typeof val === "string" && val.length > 0) {
      try {
        config[key] = decrypt(val);
      } catch {
        // Already decrypted or not encrypted.
      }
    }
  }
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

  // Find active interfaces by type (multi-tenant, multi-instance)
  findActiveByType(type: string): Interface[] {
    return db
      .prepare(
        "SELECT * FROM interfaces WHERE type = ? AND is_active = 1 ORDER BY created_at DESC",
      )
      .all(type) as Interface[];
  },

  // Find interfaces by type owned by a given user
  findByOwnerAndType(ownerUserId: number, type: string): Interface[] {
    return db
      .prepare(
        "SELECT * FROM interfaces WHERE owner_user_id = ? AND type = ? ORDER BY created_at DESC",
      )
      .all(ownerUserId, type) as Interface[];
  },

  // Find active interfaces by type owned by a given user
  findActiveByOwnerAndType(ownerUserId: number, type: string): Interface[] {
    return db
      .prepare(
        "SELECT * FROM interfaces WHERE owner_user_id = ? AND type = ? AND is_active = 1 ORDER BY created_at DESC",
      )
      .all(ownerUserId, type) as Interface[];
  },

  // Get all interfaces
  findAll(): Interface[] {
    return db
      .prepare("SELECT * FROM interfaces ORDER BY created_at DESC")
      .all() as Interface[];
  },

  // Get all interfaces for a given owner
  findAllByOwner(ownerUserId: number): Interface[] {
    return db
      .prepare(
        "SELECT * FROM interfaces WHERE owner_user_id = ? ORDER BY created_at DESC",
      )
      .all(ownerUserId) as Interface[];
  },

  // Get active interfaces
  findActive(): Interface[] {
    return db
      .prepare("SELECT * FROM interfaces WHERE is_active = 1 ORDER BY created_at DESC")
      .all() as Interface[];
  },

  // Get active interfaces for a given owner
  findActiveByOwner(ownerUserId: number): Interface[] {
    return db
      .prepare(
        "SELECT * FROM interfaces WHERE owner_user_id = ? AND is_active = 1 ORDER BY created_at DESC",
      )
      .all(ownerUserId) as Interface[];
  },

  // Create interface
  create(input: InterfaceInput): Interface {
    // Encrypt sensitive data in config
    const configToStore = { ...input.config };
    encryptKnownSecrets(configToStore);

    const result = db
      .prepare(
        `INSERT INTO interfaces (owner_user_id, type, name, config, is_active, allowed_users)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.owner_user_id ?? 1,
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

    if (input.owner_user_id !== undefined) {
      updates.push("owner_user_id = ?");
      values.push(input.owner_user_id);
    }
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
      encryptKnownSecrets(configToStore);
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
    decryptKnownSecrets(config as Record<string, unknown>);
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
