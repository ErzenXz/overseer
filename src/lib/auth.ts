import { cookies } from "next/headers";
import { usersModel, sessionsModel } from "../database/index";
import type { User } from "../database/index";

const SESSION_COOKIE_NAME = "overseer_session";

export interface AuthResult {
  success: boolean;
  user?: Omit<User, "password_hash">;
  sessionId?: string;
  error?: string;
}

/**
 * Login with username and password
 */
export async function login(
  username: string,
  password: string
): Promise<AuthResult> {
  const user = usersModel.findByUsername(username);
  if (!user) {
    return { success: false, error: "Invalid username or password" };
  }

  const validPassword = await usersModel.verifyPassword(user, password);
  if (!validPassword) {
    return { success: false, error: "Invalid username or password" };
  }

  // Create session
  const session = sessionsModel.create(user.id);

  // Update last login
  usersModel.updateLastLogin(user.id);

  const { password_hash, ...userWithoutPassword } = user;
  return { success: true, user: userWithoutPassword, sessionId: session.id };
}

/**
 * Logout current session
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    sessionsModel.delete(sessionId);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<Omit<User, "password_hash"> | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return null;
  }

  const { valid, userId } = sessionsModel.validate(sessionId);
  if (!valid || !userId) {
    return null;
  }

  const user = usersModel.findById(userId);
  if (!user) {
    return null;
  }

  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * Check if user is authenticated (for middleware/protection)
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return user !== null;
}

/**
 * Change password for current user
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const user = usersModel.findById(userId);
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const validPassword = await usersModel.verifyPassword(user, currentPassword);
  if (!validPassword) {
    return { success: false, error: "Current password is incorrect" };
  }

  await usersModel.updatePassword(userId, newPassword);

  // Invalidate all other sessions
  sessionsModel.deleteAllForUser(userId);

  return { success: true };
}

/**
 * Require authentication - returns user or throws redirect
 */
export async function requireAuth(): Promise<Omit<User, "password_hash">> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}
