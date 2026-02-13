import type { NextConfig } from "next";
import { dirname } from "path";
import { fileURLToPath } from "url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // External packages that should not be bundled
  serverExternalPackages: ["better-sqlite3", "bcrypt"],
  turbopack: {
    // Avoid Next inferring a workspace root from unrelated lockfiles outside this repo.
    root: projectRoot,
  },
};

export default nextConfig;
