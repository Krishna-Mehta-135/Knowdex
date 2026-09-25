# ─── Stage 1: base ────────────────────────────────────────────────────────────
# Shared node + pnpm toolchain used by every subsequent stage.
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# ─── Stage 2: installer ───────────────────────────────────────────────────────
# Install the full monorepo dependency tree so Turbo can build everything.
FROM base AS installer
WORKDIR /app

# Copy manifests first so this layer is cached until lock-file changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json         ./packages/types/
COPY packages/db/package.json            ./packages/db/
COPY packages/crdt/package.json          ./packages/crdt/
COPY packages/config/package.json        ./packages/config/
COPY packages/ui/package.json            ./packages/ui/
COPY apps/http-backend/package.json      ./apps/http-backend/

RUN pnpm install --frozen-lockfile

# ─── Stage 3: builder ─────────────────────────────────────────────────────────
# Copy full source and compile with Turbo (packages first, then the app).
FROM installer AS builder
WORKDIR /app

COPY turbo.json ./
COPY packages   ./packages
COPY apps/http-backend ./apps/http-backend

RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=http-backend...

# ─── Stage 4: pruner ──────────────────────────────────────────────────────────
# `pnpm deploy` resolves only PRODUCTION dependencies for the target package and
# writes a fully-standalone directory — no workspace symlinks, no devDeps.
FROM builder AS pruner
WORKDIR /app

RUN pnpm config set inject-workspace-packages true && \
    pnpm deploy --filter=http-backend --prod /pruned/http-backend

# ─── Stage 5: runner ──────────────────────────────────────────────────────────
# Minimal image: just the built JS + pruned node_modules. No pnpm, no source.
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat curl

WORKDIR /app
ENV NODE_ENV=production

# Pruned production node_modules (no devDeps, no workspace links)
COPY --from=pruner /pruned/http-backend/node_modules ./node_modules
# Compiled output from builder
COPY --from=builder /app/apps/http-backend/dist       ./dist
# package.json needed by some Node.js module resolution paths
COPY --from=builder /app/apps/http-backend/package.json ./

# Copy prisma schema and migrations for migrate deploy
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 appuser && \
    chown -R appuser:nodejs /app
USER appuser

EXPOSE 8000
# Call the local prisma binary directly: npx may try to write a cache to $HOME,
# which is not writable on Heroku.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma --config=/app/packages/db/prisma.config.ts && node dist/server.js"]
