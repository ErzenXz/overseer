import { db, initializeSchema, type User } from "./db";
import bcrypt from "bcrypt";
import { config } from "dotenv";
import { runIfNeeded as runPermissionsMigration } from "./migrations/001_add_permissions";

// Load environment variables
config();

async function initDatabase() {
  console.log("🚀 Initializing Overseer database...\n");

  // Initialize schema
  initializeSchema();

  // Run migrations
  console.log("📦 Running database migrations...");
  const migrationResult = runPermissionsMigration();
  if (!migrationResult.success) {
    console.error("❌ Migration failed:", migrationResult.error);
    process.exit(1);
  }
  console.log("");

  // Check if admin user exists
  const configuredUsername =
    process.env.DEFAULT_ADMIN_USERNAME || process.env.ADMIN_USERNAME || "admin";
  const configuredPassword =
    process.env.DEFAULT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "changeme123";

  const adminUser = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(configuredUsername) as User | undefined;

  if (!adminUser) {
    // Create default admin user
    const username = configuredUsername;
    const password = configuredPassword;
    const passwordHash = await bcrypt.hash(password, 12);

    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
    ).run(username, passwordHash, "admin");

    console.log(`✅ Created default admin user: ${username}`);
    console.log(`   Password: ${password}`);
    console.log(`   ⚠️  Please change this password after first login!\n`);
  } else {
    console.log(`✅ Admin user already exists: ${adminUser.username}\n`);
  }

  // Check provider count
  const providerCount = db
    .prepare("SELECT COUNT(*) as count FROM providers")
    .get() as { count: number };
  console.log(`📦 Providers configured: ${providerCount.count}`);

  // Check interface count
  const interfaceCount = db
    .prepare("SELECT COUNT(*) as count FROM interfaces")
    .get() as { count: number };
  console.log(`🔌 Interfaces configured: ${interfaceCount.count}`);

  // Check conversation count
  const conversationCount = db
    .prepare("SELECT COUNT(*) as count FROM conversations")
    .get() as { count: number };
  console.log(`💬 Conversations: ${conversationCount.count}`);

  // Check message count
  const messageCount = db
    .prepare("SELECT COUNT(*) as count FROM messages")
    .get() as { count: number };
  console.log(`📝 Messages: ${messageCount.count}`);

  console.log("\n✨ Database initialization complete!");
  console.log(`📁 Database location: ${process.env.DATABASE_PATH || "./data/overseer.db"}`);
}

initDatabase().catch(console.error);
