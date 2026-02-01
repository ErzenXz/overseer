import { db, type User, type Session } from "../db";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const SALT_ROUNDS = 12;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const usersModel = {
  // Find user by ID
  findById(id: number): User | undefined {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | User
      | undefined;
  },

  // Find user by username
  findByUsername(username: string): User | undefined {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | User
      | undefined;
  },

  // Create new user
  async create(
    username: string,
    password: string,
    role: "admin" | "developer" | "operator" | "viewer" = "viewer"
  ): Promise<User> {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
      )
      .run(username, passwordHash, role);
    return this.findById(result.lastInsertRowid as number)!;
  },

  // Verify password
  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  },

  // Update password
  async updatePassword(userId: number, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    db.prepare(
      "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(passwordHash, userId);
  },

  // Update last login
  updateLastLogin(userId: number): void {
    db.prepare(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(userId);
  },

  // Get all users
  findAll(): User[] {
    return db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as User[];
  },

  // Delete user
  delete(id: number): void {
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  },
};

export const sessionsModel = {
  // Create session
  create(userId: number): Session {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    db.prepare(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
    ).run(id, userId, expiresAt);
    return this.findById(id)!;
  },

  // Find session by ID
  findById(id: string): Session | undefined {
    return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | Session
      | undefined;
  },

  // Validate session (check if exists and not expired)
  validate(sessionId: string): { valid: boolean; userId?: number } {
    const session = this.findById(sessionId);
    if (!session) return { valid: false };

    const expiresAt = new Date(session.expires_at);
    if (expiresAt < new Date()) {
      this.delete(sessionId);
      return { valid: false };
    }

    return { valid: true, userId: session.user_id };
  },

  // Delete session
  delete(id: string): void {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  },

  // Delete all sessions for user
  deleteAllForUser(userId: number): void {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  },

  // Clean expired sessions
  cleanExpired(): number {
    const result = db
      .prepare("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP")
      .run();
    return result.changes;
  },
};
