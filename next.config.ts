import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // External packages that should not be bundled
  serverExternalPackages: ["better-sqlite3", "bcrypt"],
};

export default nextConfig;
