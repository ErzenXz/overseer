import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
async function generateDockerfile(params) {
  const { project_type, project_path, optimization_level = "standard" } = params;
  let dockerfile = "";
  const notes = [];
  let nodeVersion = "20";
  let pythonVersion = "3.11";
  let hasTypescript = false;
  let packageManager = "npm";
  if (project_path) {
    const packageJsonPath = join(project_path, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (pkg.engines?.node) {
          const match = pkg.engines.node.match(/(\d+)/);
          if (match) nodeVersion = match[1];
        }
        if (pkg.devDependencies?.typescript) hasTypescript = true;
      } catch {
      }
    }
    if (existsSync(join(project_path, "yarn.lock"))) packageManager = "yarn";
    else if (existsSync(join(project_path, "pnpm-lock.yaml"))) packageManager = "pnpm";
  }
  switch (project_type.toLowerCase()) {
    case "node":
    case "nodejs":
    case "express":
    case "nextjs":
    case "next":
      if (optimization_level === "optimized") {
        dockerfile = generateOptimizedNodeDockerfile(nodeVersion, packageManager, hasTypescript, project_type);
      } else if (optimization_level === "standard") {
        dockerfile = generateStandardNodeDockerfile(nodeVersion, packageManager, hasTypescript);
      } else {
        dockerfile = generateBasicNodeDockerfile(nodeVersion);
      }
      notes.push(`Using Node.js ${nodeVersion} (Alpine for smaller image)`);
      notes.push(`Package manager: ${packageManager}`);
      break;
    case "python":
    case "django":
    case "flask":
    case "fastapi":
      if (optimization_level === "optimized") {
        dockerfile = generateOptimizedPythonDockerfile(pythonVersion, project_type);
      } else {
        dockerfile = generateStandardPythonDockerfile(pythonVersion);
      }
      notes.push(`Using Python ${pythonVersion} (slim variant)`);
      break;
    case "go":
    case "golang":
      dockerfile = generateGoDockerfile(optimization_level === "optimized");
      notes.push("Using multi-stage build for minimal image");
      notes.push("Final image is scratch/distroless");
      break;
    case "static":
    case "html":
    case "nginx":
      dockerfile = generateStaticDockerfile();
      notes.push("Using nginx:alpine for static file serving");
      break;
    default:
      dockerfile = `# Dockerfile for ${project_type}
# Please customize based on your project requirements

FROM alpine:latest

WORKDIR /app

COPY . .

# Add your build and run commands here

CMD ["echo", "Configure your entrypoint"]
`;
      notes.push("Generic template - customize for your needs");
  }
  return { dockerfile, notes };
}
function generateBasicNodeDockerfile(nodeVersion) {
  return `FROM node:${nodeVersion}-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
`;
}
function generateStandardNodeDockerfile(nodeVersion, packageManager, hasTypescript) {
  const installCmd = packageManager === "yarn" ? "yarn install --frozen-lockfile" : packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : "npm ci";
  const lockFile = packageManager === "yarn" ? "yarn.lock" : packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  return `FROM node:${nodeVersion}-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json ${lockFile} ./
RUN ${installCmd}

# Build stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

${hasTypescript ? "RUN npm run build" : "# No build step needed"}

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodeuser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER nodeuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
`;
}
function generateOptimizedNodeDockerfile(nodeVersion, packageManager, hasTypescript, projectType) {
  if (projectType.toLowerCase().includes("next")) {
    return `FROM node:${nodeVersion}-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \\
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \\
  elif [ -f package-lock.json ]; then npm ci; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \\
  else echo "Lockfile not found." && exit 1; \\
  fi

# Build stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN \\
  if [ -f yarn.lock ]; then yarn run build; \\
  elif [ -f package-lock.json ]; then npm run build; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \\
  else echo "Lockfile not found." && exit 1; \\
  fi

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
`;
  }
  return generateStandardNodeDockerfile(nodeVersion, packageManager, hasTypescript);
}
function generateStandardPythonDockerfile(pythonVersion) {
  return `FROM python:${pythonVersion}-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc \\
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Create non-root user
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`;
}
function generateOptimizedPythonDockerfile(pythonVersion, projectType) {
  return `# Build stage
FROM python:${pythonVersion}-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc \\
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Production stage
FROM python:${pythonVersion}-slim AS runner

WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application
COPY . .

# Create non-root user
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s \\
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["gunicorn", "main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000"]
`;
}
function generateGoDockerfile(optimized) {
  if (optimized) {
    return `# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build with optimizations
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/server .

# Production stage - distroless
FROM gcr.io/distroless/static-debian11

COPY --from=builder /app/server /server

USER nonroot:nonroot

EXPOSE 8080

ENTRYPOINT ["/server"]
`;
  }
  return `FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o server .

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/server .

EXPOSE 8080

CMD ["./server"]
`;
}
function generateStaticDockerfile() {
  return `FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s \\
  CMD wget -q --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;
}
async function analyzeDockerfile(params) {
  const { dockerfile_content } = params;
  const lines = dockerfile_content.split("\n");
  const issues = [];
  const improvements = [];
  const bestPractices = [];
  if (/FROM\s+\w+:latest/i.test(dockerfile_content)) {
    issues.push({
      severity: "warning",
      message: "Using :latest tag is not recommended",
      suggestion: "Pin to a specific version for reproducibility"
    });
  }
  if (!/USER\s+(?!root)/i.test(dockerfile_content)) {
    issues.push({
      severity: "warning",
      message: "Container may run as root",
      suggestion: "Add USER directive with non-root user"
    });
  } else {
    bestPractices.push("Runs as non-root user");
  }
  if (!/HEALTHCHECK/i.test(dockerfile_content)) {
    issues.push({
      severity: "info",
      message: "No HEALTHCHECK defined",
      suggestion: "Add HEALTHCHECK for container orchestration"
    });
  } else {
    bestPractices.push("Has HEALTHCHECK defined");
  }
  const fromCount = (dockerfile_content.match(/^FROM\s+/gim) || []).length;
  if (fromCount > 1) {
    bestPractices.push("Uses multi-stage build");
  } else {
    improvements.push("Consider multi-stage build for smaller images");
  }
  const copyIndex = dockerfile_content.search(/COPY\s+package.*\.json/i);
  const npmInstallIndex = dockerfile_content.search(/RUN\s+npm\s+(ci|install)/i);
  if (copyIndex > -1 && npmInstallIndex > -1 && copyIndex < npmInstallIndex) {
    const copyAllIndex = dockerfile_content.search(/COPY\s+\.\s+\./);
    if (copyAllIndex > -1 && copyAllIndex < npmInstallIndex) {
      issues.push({
        severity: "warning",
        message: "COPY . . before npm install breaks layer caching",
        suggestion: "Copy package.json first, install deps, then copy rest"
      });
    } else {
      bestPractices.push("Good layer caching for dependencies");
    }
  }
  if (/apt-get\s+install/i.test(dockerfile_content)) {
    if (!/rm\s+-rf\s+\/var\/lib\/apt\/lists/i.test(dockerfile_content)) {
      issues.push({
        severity: "info",
        message: "apt-get cache not cleaned",
        suggestion: "Add 'rm -rf /var/lib/apt/lists/*' after install"
      });
    }
  }
  improvements.push("Ensure .dockerignore excludes node_modules, .git, etc.");
  if (/ENV\s+NODE_ENV\s*=\s*production/i.test(dockerfile_content)) {
    bestPractices.push("Sets NODE_ENV=production");
  }
  if (!/EXPOSE\s+\d+/i.test(dockerfile_content)) {
    issues.push({
      severity: "info",
      message: "No EXPOSE directive",
      suggestion: "Add EXPOSE to document the container port"
    });
  }
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 10 - issues.length * 2);
  return {
    valid: errorCount === 0,
    issues,
    score,
    best_practices: bestPractices,
    improvements
  };
}
async function generateCompose(params) {
  const { services, include_database } = params;
  const notes = [];
  const composeServices = {};
  for (const service of services) {
    composeServices[service.name] = {
      build: service.type === "custom" ? `./${service.name}` : void 0,
      image: service.type !== "custom" ? getImageForType(service.type) : void 0,
      ports: service.port ? [`${service.port}:${service.port}`] : void 0,
      environment: getEnvForType(service.type),
      restart: "unless-stopped"
    };
  }
  if (include_database) {
    const db = include_database.toLowerCase();
    switch (db) {
      case "postgres":
      case "postgresql":
        composeServices.db = {
          image: "postgres:15-alpine",
          environment: {
            POSTGRES_USER: "${DB_USER:-postgres}",
            POSTGRES_PASSWORD: "${DB_PASSWORD:-postgres}",
            POSTGRES_DB: "${DB_NAME:-app}"
          },
          volumes: ["postgres_data:/var/lib/postgresql/data"],
          ports: ["5432:5432"]
        };
        notes.push("PostgreSQL configured - set DB_USER, DB_PASSWORD, DB_NAME in .env");
        break;
      case "mysql":
        composeServices.db = {
          image: "mysql:8",
          environment: {
            MYSQL_ROOT_PASSWORD: "${DB_ROOT_PASSWORD:-root}",
            MYSQL_DATABASE: "${DB_NAME:-app}",
            MYSQL_USER: "${DB_USER:-user}",
            MYSQL_PASSWORD: "${DB_PASSWORD:-password}"
          },
          volumes: ["mysql_data:/var/lib/mysql"],
          ports: ["3306:3306"]
        };
        notes.push("MySQL configured - set DB credentials in .env");
        break;
      case "mongodb":
      case "mongo":
        composeServices.db = {
          image: "mongo:6",
          environment: {
            MONGO_INITDB_ROOT_USERNAME: "${MONGO_USER:-root}",
            MONGO_INITDB_ROOT_PASSWORD: "${MONGO_PASSWORD:-password}"
          },
          volumes: ["mongo_data:/data/db"],
          ports: ["27017:27017"]
        };
        notes.push("MongoDB configured - set MONGO_USER, MONGO_PASSWORD in .env");
        break;
      case "redis":
        composeServices.redis = {
          image: "redis:7-alpine",
          ports: ["6379:6379"],
          volumes: ["redis_data:/data"]
        };
        notes.push("Redis configured");
        break;
    }
  }
  let compose = `version: '3.8'

services:
`;
  for (const [name, config] of Object.entries(composeServices)) {
    compose += `  ${name}:
`;
    for (const [key, value] of Object.entries(config)) {
      if (value === void 0) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        compose += `    ${key}:
`;
        for (const [k, v] of Object.entries(value)) {
          compose += `      ${k}: ${v}
`;
        }
      } else if (Array.isArray(value)) {
        compose += `    ${key}:
`;
        for (const item of value) {
          compose += `      - ${typeof item === "string" && item.includes(":") ? `"${item}"` : item}
`;
        }
      } else {
        compose += `    ${key}: ${value}
`;
      }
    }
    compose += "\n";
  }
  if (include_database) {
    compose += `volumes:
`;
    if (include_database.includes("postgres")) compose += `  postgres_data:
`;
    if (include_database.includes("mysql")) compose += `  mysql_data:
`;
    if (include_database.includes("mongo")) compose += `  mongo_data:
`;
    if (include_database.includes("redis")) compose += `  redis_data:
`;
  }
  return { compose, notes };
}
function getImageForType(type) {
  const images = {
    nginx: "nginx:alpine",
    node: "node:20-alpine",
    python: "python:3.11-slim",
    redis: "redis:7-alpine"
  };
  return images[type.toLowerCase()];
}
function getEnvForType(type) {
  if (type.toLowerCase() === "node") {
    return { NODE_ENV: "production" };
  }
  return void 0;
}
async function suggestCommands(params) {
  const { operation, context } = params;
  const commands = [];
  const op = operation.toLowerCase();
  if (op.includes("build")) {
    commands.push(
      { command: "docker build -t myapp .", description: "Build image with tag 'myapp'" },
      { command: "docker build --no-cache -t myapp .", description: "Build without cache" },
      { command: "docker build -t myapp:v1.0.0 .", description: "Build with version tag" }
    );
  }
  if (op.includes("run")) {
    commands.push(
      { command: "docker run -d -p 3000:3000 myapp", description: "Run in background with port mapping" },
      { command: "docker run -it --rm myapp", description: "Run interactively, remove on exit" },
      { command: "docker run -d --name myapp-container -p 3000:3000 --env-file .env myapp", description: "Run with name and env file" }
    );
  }
  if (op.includes("debug") || op.includes("shell") || op.includes("exec")) {
    commands.push(
      { command: "docker exec -it <container> /bin/sh", description: "Open shell in running container" },
      { command: "docker logs -f <container>", description: "Follow container logs" },
      { command: "docker inspect <container>", description: "View container details" }
    );
  }
  if (op.includes("clean") || op.includes("prune") || op.includes("remove")) {
    commands.push(
      { command: "docker system prune -a", description: "Remove all unused images, containers, networks" },
      { command: "docker volume prune", description: "Remove unused volumes" },
      { command: "docker image prune -a", description: "Remove all unused images" },
      { command: "docker container prune", description: "Remove stopped containers" }
    );
  }
  if (op.includes("compose")) {
    commands.push(
      { command: "docker compose up -d", description: "Start all services in background" },
      { command: "docker compose down", description: "Stop and remove containers" },
      { command: "docker compose logs -f", description: "Follow logs from all services" },
      { command: "docker compose build", description: "Build/rebuild services" },
      { command: "docker compose ps", description: "List running services" }
    );
  }
  if (op.includes("push") || op.includes("registry")) {
    commands.push(
      { command: "docker tag myapp registry.example.com/myapp:v1.0.0", description: "Tag for remote registry" },
      { command: "docker push registry.example.com/myapp:v1.0.0", description: "Push to registry" },
      { command: "docker login registry.example.com", description: "Login to registry" }
    );
  }
  if (commands.length === 0) {
    commands.push(
      { command: "docker ps", description: "List running containers" },
      { command: "docker images", description: "List images" },
      { command: "docker stats", description: "Show container resource usage" }
    );
  }
  return { commands };
}
const generateDockerfileSchema = z.object({
  project_type: z.string().describe("Type of project"),
  project_path: z.string().optional().describe("Path to project"),
  optimization_level: z.enum(["basic", "standard", "optimized"]).optional()
});
const analyzeDockerfileSchema = z.object({
  dockerfile_content: z.string().describe("Dockerfile content")
});
const generateComposeSchema = z.object({
  services: z.array(z.object({
    name: z.string(),
    type: z.string(),
    port: z.number().optional()
  })).describe("Services to include"),
  include_database: z.string().optional()
});
const suggestCommandsSchema = z.object({
  operation: z.string().describe("What operation to do"),
  context: z.string().optional()
});
export {
  analyzeDockerfile,
  analyzeDockerfileSchema,
  generateCompose,
  generateComposeSchema,
  generateDockerfile,
  generateDockerfileSchema,
  suggestCommands,
  suggestCommandsSchema
};
