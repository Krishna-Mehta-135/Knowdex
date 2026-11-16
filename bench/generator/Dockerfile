FROM node:22.14.0-alpine3.21
WORKDIR /app
ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json packages/config/tsconfig.base.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/crdt/package.json ./packages/crdt/
COPY bench/package.json ./bench/
RUN pnpm install --frozen-lockfile
COPY packages/types ./packages/types
COPY packages/crdt ./packages/crdt
RUN pnpm --filter @repo/types build && pnpm --filter @repo/crdt build
RUN cd /app/bench && node --input-type=module -e "await import('ws'); await import('yjs'); await import('@repo/crdt')"
COPY bench ./bench
COPY bench/generator/server.mjs ./server.mjs
CMD ["node", "server.mjs"]
