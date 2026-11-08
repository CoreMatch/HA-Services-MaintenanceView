# HA-Services-MaintenanceView

`HA-Services-MaintenanceView` is the service-side WebUI host for HA deployment management.

## Current scope

- expose a browser-facing HTTP server
- serve the WebUI from `frontend/dist`
- proxy selected requests to `HA-Services-Deployer`
- proxy the Deployer's orchestration surface (manifest/status/deploy/rollback/runs)
  with server-held deploy credentials; the browser never receives them
- session login for operators, reusing the existing ops identity (the deploy
  token) — no separate account system

## Quick start

1. Copy `config.example.yaml` to `config.yaml`.
2. Start the deployer backend first.
3. For the backend:

```bash
go run .
```

4. For frontend development (the `ha-ui` submodule must be initialized first):

```bash
git submodule update --init
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

## Credentials

- `deployer.token` — the Deployer deploy credential (existing ops identity).
  It stays server-side: the proxy injects it into outbound mutation requests,
  and the same value verifies panel logins. When empty, the panel keeps the
  legacy login-free behavior and deploy/rollback triggers fail closed (503).
- No endpoint ever returns token material; `GET /api/config` is redacted.

## API skeleton

- `GET /healthz`
- `GET /api/healthz`
- `GET /api/session` · `POST /api/session/login` · `POST /api/session/logout`
- `GET /api/config` (redacted)
- `GET /api/projects`
- `PUT /api/projects/:name/deployment`
- `POST /api/projects/:name/precheck`
- `POST /api/projects/:name/initialize`
- `GET /api/deployer/healthz`
- `GET /api/deployer/manifest`
- `GET /api/request-log`
- `GET /api/orchestration/manifest`
- `GET /api/orchestration/validation`
- `GET /api/orchestration/status`
- `GET /api/orchestration/runs`
- `GET /api/orchestration/runs/:id`
- `POST /api/orchestration/deploy`
- `POST /api/orchestration/rollback`

Routes registered after the session middleware require a valid session when
`deployer.token` is configured. The orchestration shapes proxied here follow
the Deployer's orchestration contract; when `deployer.token` is unset the
mutation routes answer 503.
