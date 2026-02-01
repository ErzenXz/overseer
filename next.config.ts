import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",
  
  // External packages that should not be bundled
  serverExternalPackages: ["better-sqlite3", "bcrypt"],
  
  // Disable telemetry in production
  ...(process.env.NODE_ENV === "production" && {
    experimental: {
      // Reduce memory usage in production
    },
  }),
};

export default nextConfig;
