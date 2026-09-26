<div align="center">
  <h1>Knowdex Core Architecture</h1>
  <p><strong>High-Performance Distributed Knowledge Management Protocol</strong></p>
</div>

<br />

Knowdex is a local-first, structurally consistent collaborative knowledge graph. It relies on advanced Conflict-free Replicated Data Types (CRDTs) to guarantee high-fidelity data synchronization and deterministic conflict resolution across an arbitrarily large network of edge clients.

## Architectural Topology

The backend topology separates long-lived, stateful connections from stateless HTTP requests, ensuring that resource-intensive WebSocket broadcasts do not degrade standard API performance.

```mermaid
graph TB
    subgraph Client Layer
        Web[Next.js Client]
        Mobile[Mobile Client]
    end

    subgraph Load Balancing
        Nginx[Nginx Reverse Proxy / API Gateway]
    end

    subgraph Microservices
        Auth[HTTP Backend Node]
        Sync[WebSocket Sync Node]
    end

    subgraph Persistence Layer
        DB[(PostgreSQL 15)]
        Cache[(Redis 7 Cluster)]
    end

    subgraph External
        LLM[Google Generative AI]
    end

    Web -->|HTTPS| Nginx
    Mobile -->|HTTPS| Nginx

    Nginx -->|Route: /api/*| Auth
    Nginx -->|Route: /ws/*| Sync

    Auth -->|Read/Write| DB
    Sync -->|CRDT Updates| DB

    Sync -.->|Pub/Sub Backbone| Cache
    Auth -.->|Session State| Cache

    Sync -->|Streaming Generation| LLM
```

## Conflict-Free Replicated Data Protocol (CRDT)

At the core of the collaboration engine lies the `Y.js` protocol. When concurrent updates occur across isolated network partitions, the CRDT algorithm guarantees that all peers mathematically converge on the identical final document state.

### Multi-Node Synchronization Flow

```mermaid
sequenceDiagram
    participant C1 as Client 1 (Edge)
    participant N1 as WS Gateway Alpha
    participant MessageBus as Redis Backbone
    participant N2 as WS Gateway Beta
    participant C2 as Client 2 (Edge)

    Note over C1,C2: Both clients possess Document Version V1
    C1->>C1: User types "Hello"
    C1->>N1: Transmit Uint8Array Update (V2)
    N1->>MessageBus: Publish Topic [DocID] -> V2
    MessageBus->>N2: Distribute to Subscriber
    N2->>C2: Dispatch binary frame (V2)
    C2->>C2: Apply fractional update (Y.applyUpdate)
    Note over C1,C2: Guaranteed state convergence without operational transformation (OT)
```

## Component Architecture

Knowdex is orchestrated as a Turborepo monorepo, delineating rigid boundaries between generic utilities and domain-specific microservices.

```mermaid
graph LR
    subgraph Applications
        Web(web)
        Http(http-backend)
        Ws(ws-backend)
    end

    subgraph Internal Packages
        UI(ui)
        Types(types)
        Db(db)
        Crdt(crdt)
        Config(config)
    end

    Web --> UI
    Web --> Types
    Web --> Crdt

    Http --> Types
    Http --> Db

    Ws --> Types
    Ws --> Db
    Ws --> Crdt
```

### Module Specifications

- **`@repo/crdt`**: Defines the proprietary binary codecs utilized for data transport between clients and the WebSocket gateway, preventing parsing overhead associated with JSON payloads.
- **`@repo/db`**: Manages the unified PostgreSQL schema via Prisma. Enforces foreign key constraints and referential integrity across the system.
- **`apps/ws-backend`**: A scalable, non-blocking Node.js process dedicated exclusively to multiplexing WebSocket streams and coordinating the Y.js state vector.
- **`apps/http-backend`**: A traditional stateless REST API managing authentication boundaries, role-based access control, and metadata querying.

## System Prerequisites

To deploy or build the Knowdex ecosystem, the following host environments must be provisioned:

- Container Orchestrator: Docker Engine 24.0+
- Orchestration Tool: Docker Compose v2.20+
- Runtime: Node.js 20.x LTS
- Package Manager: pnpm 9.0+

## Local Deployment

1. **Environment Configuration**
   Provision the environment variables required for cryptographic signing and external integrations.

   ```bash
   cp .env.example .env
   ```

2. **Containerized Provisioning**
   Initialize the complete stack via Docker Compose. This strategy ensures parity with production topology.

   ```bash
   docker compose up --build -d
   ```

3. **Service Verification**
   Verify all subsystems are operational and responding to health checks.
   - Application Gateway: http://localhost:3000
   - REST Services: http://localhost:8000/health
   - WebSocket Services: http://localhost:8080/health

## Continuous Delivery Pipeline

The CI/CD pipeline enforces rigorous static analysis prior to image generation.

```mermaid
graph LR
    Push[Code Push] --> Typecheck[TSC Matrix]
    Push --> Lint[ESLint]
    Push --> Test[Jest Suites]

    Typecheck --> Build[Docker Build]
    Lint --> Build
    Test --> Build

    Build --> Deploy[Rolling Update]
```

Production environments utilize independently deployed artifacts, allowing the WebSocket nodes to scale autonomously from the HTTP cluster in response to high concurrency scenarios.

---

## Product features

| Feature                         | What it does                                                                                                                                                                                                        | Where                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Knowledge graph**             | Canvas force-graph of real `[[links]]`, plus dashed _ghost links_ between similar-but-unlinked notes, a suggestions panel, timeline playback, search highlight. Idle cost is ~0 (the simulation stops when cooled). | `apps/web/src/components/graph`, `lib/graph/forceSim.ts`       |
| **Ask your notes**              | Streaming answers grounded in the workspace's notes and PDFs, with clickable numbered citations. Falls back to matching passages if no Gemini key is available.                                                     | `apps/http-backend/src/semantic/ask.ts`, `/ask`                |
| **Semantic index**              | Notes/PDFs are chunked and embedded in the background (Gemini `gemini-embedding-001`, deterministic local fallback). Embeddings live in plain Postgres `float8[]` — no pgvector needed.                             | `apps/http-backend/src/semantic`                               |
| **Command palette**             | ⌘K: title + meaning search, actions, "Ask: …".                                                                                                                                                                      | `components/shell/CommandPalette.tsx`                          |
| **AI as a collaborator**        | While the AI writes, every collaborator sees who asked and the text streaming in (over Yjs awareness). The requester reviews and accepts/discards.                                                                  | `components/ai`, `lib/sync/useAIPresence.ts`                   |
| **Blocks**                      | `/` menu: headings, lists, todo, table, callout, code, image, PDF/file, web bookmark, `[[link]]`. Paste/drop files to upload.                                                                                       | `components/editor/slash`                                      |
| **Import & clip**               | Markdown / Obsidian vault / Notion export (zip) → notes with tags, folders and real backlinks; clip any public web page.                                                                                            | `/import`, `apps/http-backend/src/import`                      |
| **Version history**             | Automatic snapshots, preview, and non-destructive restore.                                                                                                                                                          | `components/editor/VersionHistory.tsx`                         |
| **Databases**                   | Notion-style databases: typed properties (text, number, select, multi-select, date, checkbox, URL), table + kanban views, inline editing, sort/filter/hide, templates. Rows are real notes.                         | `components/databases`, `apps/http-backend/src/databases`      |
| **In-note assistant**           | Summarize, extract action items, continue, improve selection, custom prompts; suggests tags and links for a note.                                                                                                   | `components/editor/AssistPanel.tsx`, `semantic/assist.ts`      |
| **Publish to web**              | Toggle a note public and share `/p/<id>`: login-free, sanitised, private links/attachments never leak.                                                                                                              | `app/p`, `apps/http-backend/src/publish`                       |
| **Offline-first**               | Service worker + IndexedDB: notes, sidebar and graph reopen with the server down; edits queue and sync automatically; honest sync banner.                                                                           | `public/sw.js`, `lib/sync`, `components/status/SyncBanner.tsx` |
| **Related & unlinked mentions** | Under every note: related-by-meaning notes and plain-text mentions, one click from a real link.                                                                                                                     | `components/editor/RelatedPanel.tsx`                           |

### Local development without cloud keys

```bash
# throwaway Postgres + Redis on non-default ports (never point tests at a shared DB)
docker run -d --name kx-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=knowdex_dev -p 5544:5432 postgres:15-alpine
docker run -d --name kx-dev-redis -p 6390:6379 redis:7-alpine

export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5544/knowdex_dev
export REDIS_URL=redis://127.0.0.1:6390
pnpm --filter @repo/db exec prisma migrate deploy
AI_MOCK=1 pnpm dev            # AI_MOCK=1 streams a canned answer instead of calling Gemini

# optional: an interlinked demo workspace (refuses non-local databases)
cd apps/http-backend && npx tsx scripts/seed-demo.ts you@example.com
```

### Tests

```bash
pnpm turbo test                                # unit tests
TEST_DATABASE_URL=$DATABASE_URL pnpm turbo test  # + real-database API integration tests
```

Integration tests create and delete their own rows but **must not** be pointed at a shared or production database.

### Operational notes

- **Gemini**: set `GEMINI_API_KEY`; optionally `GEMINI_MODEL` (falls back through stable model aliases). Embedding thresholds are calibrated for `gemini-embedding-001`; without a key a local embedder is used.
- **Rate limits** (per user, in memory): Ask 20/min, assistant 30/min, imports 10/10min, uploads 30/min, public pages 240/min/IP. `RATE_LIMIT_DISABLED=1` turns them off (tests).
- **Search cache**: chunk vectors are cached per workspace in the backend process and invalidated on re-index; a multi-instance deployment should move this to a shared store or pgvector.
- **Offline**: the service worker registers in production builds only. Sign-out clears cached user data.
