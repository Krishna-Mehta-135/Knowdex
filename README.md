# Knowdex

A local-first, collaborative note-taking app built around a knowledge graph. Notes are markdown with `[[links]]`, edited live by several people at once, and searchable by meaning as well as by keyword. Live at [knowdex.me](https://knowdex.me).

## What it does

- **Editor.** Rich text with a `/` command menu: headings, lists, todos, tables, callouts, code, images, PDFs, web bookmarks and `[[note links]]`. Paste or drop files to upload them.
- **Real-time collaboration.** Yjs CRDTs over WebSockets. Edits merge without conflicts, including edits made offline.
- **Knowledge graph.** Force-directed view of the links between notes, coloured by cluster (Louvain community detection). Dashed ghost links join notes that are similar in meaning but not yet linked.
- **Ask your notes.** Questions are answered from your own notes and PDFs, streamed, with numbered citations that open the source.
- **Semantic search.** Notes are chunked and embedded in the background; search combines vector similarity with keyword matching.
- **Databases.** Typed properties (text, number, select, multi-select, date, checkbox, URL) with table and kanban views. Rows are ordinary notes.
- **Assistant.** Summarise, extract action items, continue writing or rewrite a selection. While the AI writes, every collaborator sees who asked and the text as it arrives.
- **Import and clip.** Markdown files, Obsidian vaults and Notion exports; clip a public web page into a note.
- **Publish.** Make a note public at `/p/<id>`. Public pages are sanitised and never expose private links or attachments.
- **Version history.** Automatic snapshots with preview and non-destructive restore.
- **Offline.** A service worker and IndexedDB keep notes, sidebar and graph available with the server down. Edits queue and sync when the connection returns.

## Architecture

```mermaid
graph LR
    Browser[Browser<br/>Next.js on Vercel] -->|HTTPS| Proxy[Caddy]
    Browser -->|WSS| Proxy
    Proxy --> HTTP[http-backend<br/>Express + Prisma]
    Proxy --> WS[ws-backend<br/>Yjs sync]
    HTTP --> PG[(PostgreSQL)]
    WS --> PG
    WS <-->|pub/sub| Redis[(Redis)]
    HTTP --> Gemini[Gemini API]
    WS --> Gemini
```

The HTTP API is stateless. The WebSocket server holds the long-lived connections and fans updates out across instances through Redis, so the two scale separately.

| Path                                               | Role                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web`                                         | Next.js 16 frontend (App Router, Tiptap editor, service worker)            |
| `apps/http-backend`                                | Express 5 API: auth, notes, graph, search, Ask, import, publish, databases |
| `apps/ws-backend`                                  | WebSocket server: Yjs sync, presence, streaming AI writer                  |
| `packages/db`                                      | Prisma schema and migrations                                               |
| `packages/crdt`                                    | Binary sync protocol shared by client and server                           |
| `packages/types`, `packages/ui`, `packages/config` | Shared types, components and config                                        |

Semantic search stores embeddings as plain Postgres `float8[]` and caches them per workspace in memory, so no pgvector extension is needed. Embeddings come from `gemini-embedding-001`; with no API key a deterministic local embedder is used instead.

## Running locally

Requirements: Node 20, pnpm, Docker.

```bash
cp .env.example .env
docker compose up --build -d
```

- App: http://localhost:3000
- API health: http://localhost:8000/health
- WebSocket health: http://localhost:8080/health

To run without cloud keys, start a throwaway database and mock the AI:

```bash
docker run -d --name kx-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=knowdex_dev -p 5544:5432 postgres:15-alpine
docker run -d --name kx-dev-redis -p 6390:6379 redis:7-alpine

export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5544/knowdex_dev
export REDIS_URL=redis://127.0.0.1:6390
pnpm --filter @repo/db exec prisma migrate deploy
AI_MOCK=1 pnpm dev
```

`AI_MOCK=1` streams a canned answer instead of calling Gemini. To load an interlinked demo workspace (refuses non-local databases):

```bash
cd apps/http-backend && npx tsx scripts/seed-demo.ts you@example.com
```

## Tests

```bash
pnpm turbo test                                   # unit tests
TEST_DATABASE_URL=$DATABASE_URL pnpm turbo test   # plus API integration tests
```

Integration tests create and delete their own rows. Never point them at a shared or production database. Run `pnpm turbo build` before pushing; the Docker build type-checks more strictly than the dev server.

## Configuration

See `.env.example` for the full list. The ones that change behaviour:

| Variable                    | Effect                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`            | Enables Gemini answers, assistant and embeddings                                            |
| `GEMINI_MODEL`              | Preferred generation model; falls back through other models on quota or availability errors |
| `EMBEDDINGS_PROVIDER=local` | Use the local embedder (saves the free-tier embedding quota on dev machines)                |
| `AI_MOCK=1`                 | Canned AI responses for development                                                         |
| `RATE_LIMIT_DISABLED=1`     | Turn off per-user rate limits (tests only)                                                  |

The Gemini free tier allows roughly 1000 embedding requests per day. Per-user rate limits are in memory: Ask 20/min, assistant 30/min, imports 10 per 10 min, uploads 30/min, public pages 240/min per IP.

## Deployment

The frontend deploys to Vercel. The two backends run as Docker containers on an Azure VM behind Caddy, with PostgreSQL on Azure Flexible Server and Redis on a private VM. Every push to `main` runs CI (typecheck, lint, tests, Docker build check), builds and pushes images to GitHub Container Registry, deploys over SSH, waits for `/health`, then triggers the Vercel deploy. Database migrations run when the API container starts.

- [DEPLOY.md](DEPLOY.md): production setup and operations
- [DOCKER.md](DOCKER.md): container details
- [ARCHITECTURE.md](ARCHITECTURE.md): design notes
- [CONTRIBUTING.md](CONTRIBUTING.md): workflow and CI
