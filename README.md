<div align="center">

<img src="apps/web/public/purple-atom-logo.svg" alt="Knowdex" width="72" />

# Knowdex

**Notes that know how they connect.**

A local-first, collaborative knowledge base. Write in markdown, link ideas with `[[brackets]]`,
see the shape of your thinking as a graph, and ask questions that are answered from your own notes.

[Live app](https://knowdex.me) &nbsp;·&nbsp; [Architecture](ARCHITECTURE.md) &nbsp;·&nbsp; [Deployment](DEPLOY.md) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-database-4169E1?logo=postgresql&logoColor=white)
![Yjs](https://img.shields.io/badge/Yjs-CRDT-6D5BD0)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

</div>

---

## Contents

1. [Why Knowdex](#why-knowdex)
2. [Features](#features)
3. [How the interesting parts work](#how-the-interesting-parts-work)
4. [Architecture](#architecture)
5. [Repository layout](#repository-layout)
6. [Getting started](#getting-started)
7. [Testing](#testing)
8. [Configuration](#configuration)
9. [Deployment](#deployment)
10. [Design decisions](#design-decisions)
11. [Limits and roadmap](#limits-and-roadmap)

---

## Why Knowdex

Most note apps make you choose. Either they are fast and private but single-player, or they are collaborative but stop working the moment your connection does. Search is usually keyword-only, so a note is only findable if you remember the words you used.

Knowdex is built around three ideas:

- **Local-first.** Every note lives in your browser first. The editor never waits on the network, and you keep working through outages. Changes merge when you reconnect.
- **Structure from links, not folders.** You link notes as you write. The app turns those links into a graph, and adds the links you forgot by comparing what your notes mean.
- **Your notes are the knowledge source.** Questions are answered from what you wrote, with numbered citations back to the exact note, instead of from the open web.

## Features

### Writing

|                     |                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Block editor**    | Type `/` for headings, lists, todos, tables, callouts, code, images, PDFs, web bookmarks and note links. Paste or drop a file to upload it. |
| **Backlinks**       | Every note shows what links to it, plus notes that mention its title in plain text, one click from becoming real links.                     |
| **Related notes**   | Under each note, other notes that are close in meaning, even with no shared words.                                                          |
| **Version history** | Automatic snapshots, side-by-side preview, and restore that never destroys the current version.                                             |
| **Command palette** | `Ctrl/Cmd + K` searches by title and by meaning, runs actions, or starts a question.                                                        |

### Thinking

|                       |                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Knowledge graph**   | A force-directed map of real links, coloured by topic cluster. Dashed **ghost links** join notes that are similar in meaning but not yet linked. A suggestions panel lets you accept them. Timeline playback shows how the graph grew. |
| **Ask your notes**    | Ask in plain language. The answer streams in word by word, grounded in your notes and PDFs, with clickable citations.                                                                                                                  |
| **Semantic search**   | Finds notes by meaning as well as keywords, so a search for "baking" also finds your note about sourdough.                                                                                                                             |
| **In-note assistant** | Summarise, extract action items, continue a draft, rewrite a selection, or suggest tags and links.                                                                                                                                     |

### Organising

|               |                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Databases** | Typed properties (text, number, select, multi-select, date, checkbox, URL) with table and kanban views, inline editing, sorting, filtering and templates. Every row is a real note, so it links and shows up in the graph like anything else. |
| **Import**    | Bring in Markdown files, an Obsidian vault or a Notion export. Tags, folders and wiki links are preserved. Clip any public web page into a note.                                                                                              |
| **Publish**   | Turn a note into a public page at `/p/<id>`. Pages are sanitised, need no login, and never expose private links or attachments.                                                                                                               |

### Working together and offline

|                                  |                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live collaboration**           | Several people edit the same note with cursors and presence. Concurrent edits merge without conflicts.                                                                            |
| **AI as a visible collaborator** | When the assistant writes, everyone in the note sees who asked and watches the text arrive. Only the requester can accept or discard it.                                          |
| **Offline mode**                 | A service worker and IndexedDB keep notes, sidebar and graph available with the server down. Edits queue and sync on reconnect, and a banner says honestly what state you are in. |

## How the interesting parts work

### Real-time sync without conflicts

Documents are Yjs CRDTs. Two people can type in the same paragraph, or one can edit on a plane, and the copies converge to the same result with no central arbiter and no locking.

```mermaid
sequenceDiagram
    participant A as Browser A
    participant S1 as ws-backend 1
    participant R as Redis
    participant S2 as ws-backend 2
    participant B as Browser B

    A->>S1: binary update
    S1->>S1: persist to Postgres
    S1->>R: publish crdt:updates:doc
    R->>S2: deliver
    S2->>B: binary update
    Note over A,B: Both replicas converge to the same document
```

- The wire format is a compact binary protocol in `packages/crdt`, not JSON.
- Connection starts with a two-phase handshake: the client sends its state vector, the server replies with only what is missing.
- Bursts of edits are coalesced before persisting, so typing does not produce a database write per keystroke.
- Redis pub/sub lets you run several WebSocket servers behind one address.

### Meaning-based search and Ask

```mermaid
flowchart LR
    N[Note or PDF] --> C[Split into chunks]
    C --> E[Embed]
    E --> P[(Postgres float8 arrays)]
    Q[Question] --> QE[Embed question]
    QE --> H{Hybrid ranking}
    P --> H
    L[Keyword match with stemming] --> H
    H --> T[Top passages]
    T --> G[LLM answer with citations]
```

1. A background indexer splits each note into chunks and embeds them with `gemini-embedding-001`. If no API key is set, a deterministic local embedder takes over so the feature still works.
2. Vectors are stored as plain Postgres `float8[]` and cached per workspace in memory. There is no vector extension to install.
3. A query is scored by vector similarity **and** keyword overlap. Each embedder has its own similarity thresholds, because scores from different models are not comparable.
4. If nothing is strong enough, Ask returns the closest passages instead of pretending it found an answer.
5. Answers stream over Server-Sent Events. Repeat questions are served from a short cache keyed to the workspace's index version, so they return instantly and invalidate themselves when a note changes.

### The graph

The graph is drawn on a canvas with a custom force simulation. It stops computing once it cools, so an idle graph costs almost nothing.

- **Edges** are your real `[[links]]`.
- **Clusters** are found with Louvain community detection on the link structure, and each cluster gets its own colour.
- **Ghost links** are dashed lines between notes whose embeddings are close but which have no link. They are suggestions: accept one and it becomes a real link.
- **Node size** reflects how connected a note is, so hubs stand out.

### Streaming that feels like typing

Answers arrive in bursts from the model, which looks jumpy if rendered directly. The client runs a small typewriter that reveals text at word boundaries and adapts its speed to how much is buffered, so it neither lags behind a fast stream nor stalls on a slow one.

### Resilient AI calls

Free-tier model quotas run out. Instead of failing, the backend walks a model plan (`GEMINI_MODEL`, then progressively lighter models) with a per-model circuit breaker: rate-limited models are skipped for two minutes, retired ones for an hour, briefly unavailable ones for twenty seconds. If every model is unavailable, Ask degrades to extractive answers from your own passages.

## Architecture

```mermaid
graph TB
    subgraph Client
        Web[Next.js app<br/>Tiptap editor, Yjs, IndexedDB, service worker]
    end

    subgraph Edge
        Caddy[Caddy<br/>automatic HTTPS]
    end

    subgraph Backend
        HTTP[http-backend<br/>Express 5, Prisma 7]
        WS[ws-backend<br/>Yjs sync, presence, AI writer]
    end

    subgraph Data
        PG[(PostgreSQL)]
        Redis[(Redis)]
    end

    Gemini[Google Gemini API]

    Web -->|HTTPS| Caddy
    Web -->|WSS| Caddy
    Caddy --> HTTP
    Caddy --> WS
    HTTP --> PG
    WS --> PG
    WS <-->|pub/sub| Redis
    HTTP --> Gemini
    WS --> Gemini
```

The HTTP API is stateless and cheap to scale. The WebSocket server owns long-lived connections and fans updates out through Redis. Splitting them means a burst of collaborators never slows down ordinary requests.

## Repository layout

A Turborepo and pnpm monorepo.

```
apps/
  web/            Next.js 16 frontend (App Router, Tiptap, service worker)
  http-backend/   Express API: auth, notes, graph, search, Ask, import, publish, databases
  ws-backend/     WebSocket server: Yjs sync, presence, streaming AI writer
packages/
  db/             Prisma schema and migrations
  crdt/           Binary sync protocol shared by client and server
  types/          Shared TypeScript types and validation schemas
  ui/             Shared components (dialogs, buttons, inputs)
  config/         Shared lint and TypeScript config
```

Where to look for a given feature:

| Feature        | Frontend                                     | Backend                                       |
| -------------- | -------------------------------------------- | --------------------------------------------- |
| Graph          | `apps/web/src/components/graph`, `lib/graph` | `apps/http-backend/src/semantic`              |
| Ask            | `components/ask`                             | `semantic/ask.ts`                             |
| Semantic index |                                              | `semantic/embedder.ts`, `semantic/indexer.ts` |
| Databases      | `components/databases`                       | `src/databases`                               |
| Assistant      | `components/editor/AssistPanel.tsx`          | `semantic/assist.ts`                          |
| Import         | `app/(app)/import`                           | `src/import`                                  |
| Publish        | `app/p`                                      | `src/publish`                                 |
| Offline        | `public/sw.js`, `lib/sync`                   |                                               |
| Live sync      | `lib/sync`                                   | `apps/ws-backend`                             |

## Getting started

**Requirements:** Node 20, pnpm, Docker.

### Everything in containers

```bash
cp .env.example .env
docker compose up --build -d
```

| Service          | URL                          |
| ---------------- | ---------------------------- |
| App              | http://localhost:3000        |
| API health       | http://localhost:8000/health |
| WebSocket health | http://localhost:8080/health |

### Local development without cloud keys

No Gemini key and no shared database needed:

```bash
docker run -d --name kx-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=knowdex_dev -p 5544:5432 postgres:15-alpine
docker run -d --name kx-dev-redis -p 6390:6379 redis:7-alpine

export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5544/knowdex_dev
export REDIS_URL=redis://127.0.0.1:6390

pnpm install
pnpm --filter @repo/db exec prisma migrate deploy
AI_MOCK=1 pnpm dev
```

`AI_MOCK=1` streams a canned answer instead of calling Gemini, and the local embedder handles search.

To fill the app with an interlinked demo workspace (it refuses to run against a non-local database):

```bash
cd apps/http-backend && npx tsx scripts/seed-demo.ts you@example.com
```

## Testing

```bash
pnpm turbo test                                   # unit tests
TEST_DATABASE_URL=$DATABASE_URL pnpm turbo test   # plus API integration tests
pnpm turbo build                                  # what Docker and CI actually run
```

- Integration tests create and delete their own rows. **Never point them at a shared or production database.**
- Run `pnpm turbo build` before pushing. The production build type-checks more strictly than the dev server, and CI will fail on errors the dev server tolerates.
- A pre-commit hook runs typecheck and lint with zero warnings allowed.

## Configuration

`.env.example` lists every variable. These are the ones that change behaviour:

| Variable                            | Effect                                                       |
| ----------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                      | PostgreSQL connection string                                 |
| `REDIS_URL`                         | Redis for WebSocket fan-out                                  |
| `JWT_SECRET`                        | Signs sessions                                               |
| `GEMINI_API_KEY`                    | Enables Gemini answers, assistant and embeddings             |
| `GEMINI_MODEL`                      | Preferred generation model; the rest of the plan is fallback |
| `EMBEDDINGS_PROVIDER=local`         | Use the local embedder, saving the free-tier embedding quota |
| `AI_MOCK=1`                         | Canned AI responses for development                          |
| `RATE_LIMIT_DISABLED=1`             | Disable per-user rate limits (tests only)                    |
| `GOOGLE_CLIENT_ID` / `GH_CLIENT_ID` | OAuth sign-in                                                |

Built-in limits, per user and held in memory: Ask 20 per minute, assistant 30 per minute, imports 10 per 10 minutes, uploads 30 per minute, public pages 240 per minute per IP. The Gemini free tier allows roughly 1000 embedding requests per day.

## Deployment

```mermaid
flowchart LR
    Push[Push to main] --> CI[CI: typecheck, lint, test, Docker build check]
    CI --> Build[Build and push images to GHCR]
    Build --> Deploy[SSH to Azure VM, docker compose up]
    Deploy --> Health[Wait for /health]
    Health --> Vercel[Trigger Vercel deploy]
```

| Piece                       | Where it runs                                    |
| --------------------------- | ------------------------------------------------ |
| Frontend                    | Vercel                                           |
| HTTP and WebSocket backends | Docker containers on an Azure VM                 |
| HTTPS and routing           | Caddy, with automatic Let's Encrypt certificates |
| Database                    | Azure Database for PostgreSQL, Flexible Server   |
| Redis                       | Container on a private Azure VM                  |
| Images                      | GitHub Container Registry                        |

- The frontend deploy only fires after the backend reports healthy, so users never get a new UI talking to an old API.
- Prisma migrations run when the API container starts. All migrations to date are additive, so a rollback to the previous image is safe.
- Containers are built in multiple stages, run as a non-root user, and are capped at 256 MB of memory.
- Rapid pushes cancel older in-flight deploys, so the newest commit always wins.

More detail: [DEPLOY.md](DEPLOY.md) for production, [DOCKER.md](DOCKER.md) for containers.

## Design decisions

| Decision                               | Reason                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| CRDTs instead of operational transform | Offline edits and multi-server fan-out merge without a central sequencer        |
| Embeddings in plain Postgres arrays    | No extension to install or manage; fine at personal-workspace scale             |
| Separate HTTP and WebSocket services   | Long-lived connections scale differently from request/response traffic          |
| Databases rows are notes               | Rows inherit links, backlinks, search and graph presence for free               |
| Local embedder fallback                | The app stays fully usable with no API key, quota or network                    |
| Circuit breaker around model calls     | Free-tier quota errors degrade gracefully instead of breaking the feature       |
| Service worker in production only      | A worker left registered in development serves stale chunks and hides real bugs |
| Sanitised public pages                 | Publishing must never leak private links, attachments or scripts                |

## Limits and roadmap

Current limits:

- The per-workspace vector cache is in process memory. Running several API instances would need a shared store or pgvector.
- Rate limits are per process, not global.
- The Gemini free tier caps how much can be indexed and asked per day. A billed key removes this.

Ideas under consideration:

- Shared vector store for multi-instance deployments
- Mobile layout polish
- Richer database views (calendar, gallery) and formulas

---

<div align="center">

Built by [Krishna Mehta](https://github.com/Krishna-Mehta-135). Live at [knowdex.me](https://knowdex.me).

</div>
