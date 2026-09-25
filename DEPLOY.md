# Deploying the Knowdex backend

The Knowdex backend runs on the shared Azure App VM next to CanvasSync:

- `docker-compose.prod.yml` — `knowdex-http` + `knowdex-ws`, no published
  ports; CanvasSync's Caddy proxies `api.knowdex.me` / `ws.knowdex.me` to them
  over the shared `edge` Docker network.
- Postgres — database `knowdex_db` on the shared Azure Postgres server.
- Redis — shared Redis container on the Data VM (ws pub/sub only).
- `.github/workflows/deploy.yml` — build → GHCR → SSH deploy → Vercel hook.

Full step-by-step setup (VMs, Postgres, DNS, GitHub secrets for both repos)
lives in the CanvasSync repo: `docs/deploy-azure.md`.
