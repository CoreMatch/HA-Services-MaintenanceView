# HA-Services-MaintenanceView

`HA-Services-MaintenanceView` is the service-side WebUI host for HA deployment management.

## Current scope

- expose a browser-facing HTTP server
- serve the WebUI from `frontend/dist`
- proxy selected requests to `HA-Services-Deployer`

## Quick start

1. Copy `config.example.yaml` to `config.yaml`.
2. Start the deployer backend first.
3. For the backend:

```bash
go run .
```

4. For frontend development:

```bash
cd frontend
npm install
npm run dev
```

5. For a production-like local run:

```bash
cd frontend
npm install
npm run build
```

Then open `http://127.0.0.1:2771` — the port follows `server.listen` in
`config.yaml` (the example file and the code default use `:2771`; container
deployments use `:18081`, see the Dockerfile).

## Deployment facts

Authoritative deployment facts live in [`deploy-manifest.yaml`](deploy-manifest.yaml)
at the repo root (consumed by HA-Services-Deployer's orchestrator;
`manager: aapanel` means the process is panel-managed and the orchestrator
treats it as read-only):

- Bare-metal production listens on `:2771`, loopback-only (container
  deployments use `:18081`); health probe `GET /healthz`.
- Depends on HA-Services-Deployer (`deployer.base_url`); no database, no Redis.
- Config file `config.yaml` (template version 1); state in
  `./data/projects.json`; static frontend served from `./frontend/dist`.

## API skeleton

- `GET /healthz`
- `GET /api/healthz`
- `GET /api/config`
- `GET /api/projects`
- `POST /api/projects/:name/precheck`
- `POST /api/projects/:name/initialize`
- `GET /api/deployer/healthz`
- `GET /api/deployer/manifest`
