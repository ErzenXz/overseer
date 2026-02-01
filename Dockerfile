# ============================================
# MyBot Dockerfile
# Multi-stage build for production efficiency
# ============================================

# ======================
# Stage 1: Dependencies
# ======================
FROM node:20-alpine AS deps

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* ./

# Install dependencies based on lockfile
RUN \
  if [ -f pnpm-lock.yaml ]; then \
    corepack enable pnpm && pnpm install --frozen-lockfile; \
  elif [ -f package-lock.json ]; then \
    npm ci; \
  else \
    npm install; \
  fi

# ======================
# Stage 2: Builder
# ======================
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the Next.js application
RUN npm run build

# ======================
# Stage 3: Production Runner
# ======================
FROM node:20-alpine AS runner

# Install runtime dependencies
RUN apk add --no-cache \
  dumb-init \
  curl \
  git \
  bash \
  openssh-client \
  python3 \
  && rm -rf /var/cache/apk/*

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 mybot

# Set environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy source for bot and agent
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create data directory for SQLite
RUN mkdir -p /app/data /app/skills && chown -R mybot:nodejs /app

# Volume for persistent data
VOLUME ["/app/data", "/app/skills"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:${PORT}/api/health || exit 1

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command - can be overridden
CMD ["node", "server.js"]

# ======================
# Stage 4: Agent Standalone
# ======================
FROM node:20-alpine AS agent

# Install runtime dependencies for agent
RUN apk add --no-cache \
  dumb-init \
  curl \
  git \
  bash \
  openssh-client \
  python3 \
  make \
  g++ \
  && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package.json tsconfig.json ./
COPY src ./src

# Create data directory
RUN mkdir -p /app/data /app/skills

# Volume for persistent data
VOLUME ["/app/data", "/app/skills"]

# Use dumb-init
ENTRYPOINT ["dumb-init", "--"]

# Run agent standalone
CMD ["npx", "tsx", "src/agent/runner.ts"]

# ======================
# Stage 5: Bot Only
# ======================
FROM node:20-alpine AS bot

# Install runtime dependencies
RUN apk add --no-cache \
  dumb-init \
  curl \
  git \
  bash \
  openssh-client \
  python3 \
  make \
  g++ \
  && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package.json tsconfig.json ./
COPY src ./src

# Create data directory
RUN mkdir -p /app/data /app/skills

# Volume for persistent data
VOLUME ["/app/data", "/app/skills"]

# Health check for bot
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "tsx.*bot" || exit 1

# Use dumb-init
ENTRYPOINT ["dumb-init", "--"]

# Run Telegram bot
CMD ["npx", "tsx", "src/bot/index.ts"]

# ======================
# Stage 6: All-in-One with Supervisor
# ======================
FROM node:20-alpine AS allinone

# Install runtime dependencies and supervisor
RUN apk add --no-cache \
  dumb-init \
  supervisor \
  curl \
  git \
  bash \
  openssh-client \
  python3 \
  make \
  g++ \
  nginx \
  && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy built application
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy source for bot
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy supervisor config
COPY config/supervisord.conf /etc/supervisord.conf

# Create directories
RUN mkdir -p /app/data /app/skills /var/log/supervisor /var/run

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Volume for persistent data
VOLUME ["/app/data", "/app/skills"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Expose ports
EXPOSE 3000

# Use dumb-init with supervisor
ENTRYPOINT ["dumb-init", "--"]
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
