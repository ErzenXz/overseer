import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { z } from "zod";
async function checkDeployReadiness(params) {
  const { project_path, environment = "production" } = params;
  const checks = [];
  const blockers = [];
  const warnings = [];
  if (!existsSync(project_path)) {
    return {
      ready: false,
      environment,
      checks: [{ name: "Project exists", status: "fail", message: "Project path not found", required: true }],
      score: 0,
      blockers: ["Project path does not exist"],
      warnings: []
    };
  }
  const packageJsonPath = join(project_path, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      checks.push({
        name: "Version defined",
        status: pkg.version ? "pass" : "warning",
        message: pkg.version ? `Version: ${pkg.version}` : "No version in package.json",
        required: false
      });
      const hasBuild = pkg.scripts?.build;
      checks.push({
        name: "Build script",
        status: hasBuild ? "pass" : "warning",
        message: hasBuild ? "Build script found" : "No build script defined",
        required: false
      });
      if (!hasBuild) warnings.push("No build script found");
      const hasStart = pkg.scripts?.start;
      checks.push({
        name: "Start script",
        status: hasStart ? "pass" : "fail",
        message: hasStart ? "Start script found" : "No start script defined",
        required: true
      });
      if (!hasStart) blockers.push("No start script defined");
      const hasTest = pkg.scripts?.test;
      checks.push({
        name: "Test script",
        status: hasTest ? "pass" : "warning",
        message: hasTest ? "Test script found" : "No test script - consider adding tests",
        required: false
      });
      const nodeVersion = pkg.engines?.node;
      checks.push({
        name: "Node version specified",
        status: nodeVersion ? "pass" : "warning",
        message: nodeVersion ? `Node: ${nodeVersion}` : "Consider specifying node version in engines",
        required: false
      });
    } catch (error) {
      checks.push({
        name: "package.json valid",
        status: "fail",
        message: "Failed to parse package.json",
        required: true
      });
      blockers.push("Invalid package.json");
    }
  }
  const hasNpmLock = existsSync(join(project_path, "package-lock.json"));
  const hasYarnLock = existsSync(join(project_path, "yarn.lock"));
  const hasPnpmLock = existsSync(join(project_path, "pnpm-lock.yaml"));
  const hasLockFile = hasNpmLock || hasYarnLock || hasPnpmLock;
  checks.push({
    name: "Lock file",
    status: hasLockFile ? "pass" : "fail",
    message: hasLockFile ? "Lock file found" : "No lock file - add one for reproducible builds",
    required: true
  });
  if (!hasLockFile) blockers.push("No package lock file");
  const hasEnvExample = existsSync(join(project_path, ".env.example"));
  checks.push({
    name: "Environment template",
    status: hasEnvExample ? "pass" : "warning",
    message: hasEnvExample ? ".env.example found" : "Consider adding .env.example",
    required: false
  });
  const hasDockerfile = existsSync(join(project_path, "Dockerfile"));
  if (hasDockerfile) {
    checks.push({
      name: "Dockerfile",
      status: "pass",
      message: "Dockerfile found",
      required: false
    });
  }
  const hasGitignore = existsSync(join(project_path, ".gitignore"));
  checks.push({
    name: "Git ignore",
    status: hasGitignore ? "pass" : "warning",
    message: hasGitignore ? ".gitignore found" : "Add .gitignore to exclude build artifacts",
    required: false
  });
  const hasReadme = existsSync(join(project_path, "README.md"));
  checks.push({
    name: "Documentation",
    status: hasReadme ? "pass" : "warning",
    message: hasReadme ? "README.md found" : "Consider adding deployment docs",
    required: false
  });
  const hasNodeModulesGit = existsSync(join(project_path, "node_modules", ".git"));
  if (hasNodeModulesGit) {
    checks.push({
      name: "node_modules not tracked",
      status: "fail",
      message: "node_modules appears to be in git",
      required: true
    });
    blockers.push("node_modules should not be in git");
  }
  const hasTsConfig = existsSync(join(project_path, "tsconfig.json"));
  if (hasTsConfig) {
    checks.push({
      name: "TypeScript config",
      status: "pass",
      message: "tsconfig.json found",
      required: false
    });
  }
  const envFiles = readdirSync(project_path).filter((f) => f.startsWith(".env"));
  const hasEnvProduction = envFiles.some((f) => f.includes("production") || f.includes("prod"));
  if (environment === "production") {
    checks.push({
      name: "Production env config",
      status: hasEnvProduction ? "pass" : "warning",
      message: hasEnvProduction ? "Production env file found" : "No production-specific env file",
      required: false
    });
  }
  const totalRequired = checks.filter((c) => c.required).length;
  const passedRequired = checks.filter((c) => c.required && c.status === "pass").length;
  const totalOptional = checks.filter((c) => !c.required).length;
  const passedOptional = checks.filter((c) => !c.required && c.status === "pass").length;
  const score = Math.round(
    passedRequired / Math.max(totalRequired, 1) * 70 + passedOptional / Math.max(totalOptional, 1) * 30
  );
  return {
    ready: blockers.length === 0,
    environment,
    checks,
    score,
    blockers,
    warnings
  };
}
async function generateDeployChecklist(params) {
  const { project_type, environment = "production" } = params;
  const checklist = [];
  checklist.push(
    { category: "Pre-deploy", item: "All tests passing", required: true, description: "Run full test suite" },
    { category: "Pre-deploy", item: "Code reviewed", required: true, description: "All changes have been reviewed" },
    { category: "Pre-deploy", item: "Dependencies updated", required: false, description: "Check for security updates" },
    { category: "Pre-deploy", item: "No TODO/FIXME in critical paths", required: false, description: "Review and address outstanding items" }
  );
  checklist.push(
    { category: "Environment", item: "Environment variables configured", required: true, description: "All required env vars are set" },
    { category: "Environment", item: "Secrets are in vault/secure storage", required: true, description: "No hardcoded secrets" },
    { category: "Environment", item: "Database migrations ready", required: true, description: "Migrations tested and reversible" }
  );
  if (project_type.toLowerCase() === "nextjs") {
    checklist.push(
      { category: "Next.js", item: "Build succeeds", required: true, description: "next build completes without errors" },
      { category: "Next.js", item: "Static analysis passes", required: true, description: "next lint shows no errors" },
      { category: "Next.js", item: "Image optimization configured", required: false, description: "next/image domains configured" },
      { category: "Next.js", item: "API routes secured", required: true, description: "Authentication on protected routes" }
    );
  } else if (project_type.toLowerCase() === "node" || project_type.toLowerCase() === "express") {
    checklist.push(
      { category: "Node.js", item: "PM2/process manager configured", required: true, description: "Graceful shutdown handling" },
      { category: "Node.js", item: "Error handling middleware", required: true, description: "Global error handler in place" },
      { category: "Node.js", item: "Health check endpoint", required: true, description: "/health or /healthz returns 200" },
      { category: "Node.js", item: "Logging configured", required: true, description: "Structured logging to aggregator" }
    );
  } else if (project_type.toLowerCase() === "docker") {
    checklist.push(
      { category: "Docker", item: "Multi-stage build", required: false, description: "Reduce final image size" },
      { category: "Docker", item: "Non-root user", required: true, description: "Container runs as non-root" },
      { category: "Docker", item: "Health check defined", required: true, description: "HEALTHCHECK instruction in Dockerfile" },
      { category: "Docker", item: "Image tagged properly", required: true, description: "Use semantic versioning" }
    );
  } else if (project_type.toLowerCase() === "python") {
    checklist.push(
      { category: "Python", item: "Requirements pinned", required: true, description: "Exact versions in requirements.txt" },
      { category: "Python", item: "Virtual environment", required: true, description: "Dependencies isolated" },
      { category: "Python", item: "WSGI server configured", required: true, description: "Gunicorn/uWSGI for production" }
    );
  }
  if (environment === "production") {
    checklist.push(
      { category: "Production", item: "Rollback plan documented", required: true, description: "Know how to revert if needed" },
      { category: "Production", item: "Monitoring configured", required: true, description: "Alerts for errors and performance" },
      { category: "Production", item: "Backup verified", required: true, description: "Recent database backup exists" },
      { category: "Production", item: "Team notified", required: true, description: "Stakeholders aware of deployment" },
      { category: "Production", item: "Low-traffic window", required: false, description: "Deploy during low usage" }
    );
  }
  checklist.push(
    { category: "Post-deploy", item: "Smoke tests passing", required: true, description: "Critical paths work" },
    { category: "Post-deploy", item: "Logs reviewed", required: true, description: "No unexpected errors" },
    { category: "Post-deploy", item: "Metrics baseline captured", required: false, description: "Compare with pre-deploy" }
  );
  return { checklist };
}
async function verifyEnvironment(params) {
  const { project_path, env_file = ".env" } = params;
  const envPath = join(project_path, env_file);
  const examplePath = join(project_path, ".env.example");
  const variables = [];
  const missing = [];
  const warnings = [];
  const secretPatterns = [/password/i, /secret/i, /key/i, /token/i, /auth/i, /credential/i];
  const expectedVars = /* @__PURE__ */ new Set();
  if (existsSync(examplePath)) {
    const exampleContent = readFileSync(examplePath, "utf-8");
    for (const line of exampleContent.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) {
        expectedVars.add(match[1]);
      }
    }
  }
  if (!existsSync(envPath)) {
    return {
      valid: false,
      file: env_file,
      variables: [],
      missing: Array.from(expectedVars),
      warnings: [`${env_file} file not found`]
    };
  }
  const envContent = readFileSync(envPath, "utf-8");
  const setVars = /* @__PURE__ */ new Set();
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const [, name, value] = match;
      setVars.add(name);
      const isSecret = secretPatterns.some((p) => p.test(name));
      const hasValue = value.trim().length > 0 && value !== '""' && value !== "''";
      variables.push({
        name,
        set: true,
        hasValue,
        isSecret
      });
      if (!hasValue && isSecret) {
        warnings.push(`${name} appears to be a secret but has no value`);
      }
      if (/your[-_]?|example|changeme|xxx|placeholder/i.test(value)) {
        warnings.push(`${name} appears to contain a placeholder value`);
      }
    }
  }
  for (const expected of expectedVars) {
    if (!setVars.has(expected)) {
      missing.push(expected);
      variables.push({
        name: expected,
        set: false,
        hasValue: false,
        isSecret: secretPatterns.some((p) => p.test(expected))
      });
    }
  }
  return {
    valid: missing.length === 0 && warnings.length === 0,
    file: env_file,
    variables,
    missing,
    warnings
  };
}
const checkDeployReadinessSchema = z.object({
  project_path: z.string().describe("Path to the project"),
  environment: z.string().optional().describe("Target environment")
});
const generateDeployChecklistSchema = z.object({
  project_type: z.string().describe("Type of project"),
  environment: z.string().optional().describe("Target environment")
});
const verifyEnvironmentSchema = z.object({
  project_path: z.string().describe("Path to the project"),
  env_file: z.string().optional().describe("Environment file to check")
});
export {
  checkDeployReadiness,
  checkDeployReadinessSchema,
  generateDeployChecklist,
  generateDeployChecklistSchema,
  verifyEnvironment,
  verifyEnvironmentSchema
};
