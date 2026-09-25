# Deploying the Knowdex backend

The Knowdex backend runs on Azure for Students, on the App VM it shares with
CanvasSync:

- **Frontend:** Vercel (`knowdex.me`).
- **Backend:** `docker-compose.prod.yml`, i.e. `knowdex-http` (:8000) and
  `knowdex-ws` (:8080) in `/opt/knowdex` on the App VM (`20.198.86.229`). No
  ports are published: CanvasSync's Caddy terminates HTTPS for
  `api.knowdex.me` / `ws.knowdex.me` and proxies over the shared `edge`
  Docker network.
- **Postgres:** database `knowdex_db` on the shared Azure Postgres Flexible
  Server (B1ms, private access). Migrations run when `knowdex-http` starts.
- **Redis:** the shared Redis on the Data VM (`10.0.1.5`), used only for ws
  pub/sub.
- **CI/CD:** `.github/workflows/deploy.yml` runs CI, builds and pushes to
  GHCR, deploys over SSH, then triggers the Vercel deploy hook. It runs on
  every push to `main`.

**Cost:** about ₹115/month of the shared ~₹365/month, paid from Azure student
credit. The VMs, disks and Postgres are on the free-services list until
10 Nov 2026.

The full architecture, the exact commands used to build it, cost breakdown,
operations and backup steps are in the CanvasSync repo:
[`docs/deploy-azure.md`](https://github.com/Krishna-Mehta-135/Canvassync/blob/main/docs/deploy-azure.md).
