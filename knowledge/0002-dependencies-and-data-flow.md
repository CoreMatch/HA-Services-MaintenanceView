# 0002 — Dependencies and Data Flow

## Status

Accepted (records current state)

## Date

2026-11-04

## Context

The service is a thin host around data owned by HA-Services-Deployer. It was
wired against the deployer's `/api/v1/*` surface from the first functional
commits (`f3bee6a`, `88534c6`).

## Decision

Record the verified dependency and data-flow shape:

- **Upstream: HA-Services-Deployer (hard dependency).**
  `deployer.base_url` (default `http://127.0.0.1:18080`,
  `internal/models/config.go:32-34`). The client calls exactly three
  endpoints (`internal/deployer/client.go:29-46`):
  - `GET /api/v1/healthz` (proxied as `GET /api/deployer/healthz`)
  - `GET /api/v1/manifest` (proxied as `GET /api/deployer/manifest`)
  - `GET /api/v1/projects` (the binary-only projection; consumed by
    `GET /api/projects` and by the deployment/precheck/initialize handlers)
  HTTP client timeout is 10 seconds (`internal/deployer/client.go:24`).
  Deployer unreachable → the affected endpoints return 502
  (`internal/server/handlers.go:90-96`).
- **Local state: one JSON file.** Per-project `deploy_dir`/`port` settings in
  `state.projects_path` (default `./data/projects.json`,
  `internal/models/config.go:35-37`), loaded and saved as a whole
  (`internal/state/store.go:20-57`). Note: `Save` writes the file directly
  without temp-file + rename (`internal/state/store.go:51-56`) — not atomic;
  recorded as-is.
- **Frontend build artifact.** The Go server serves `server.frontend_dist`
  (default `./frontend/dist`, `internal/models/config.go:30`). `frontend/dist`
  is git-ignored and **not committed**; a local `npm install && npm run
  build` (React 19 + Vite 7, `frontend/package.json`) or the Docker
  multi-stage build (`Dockerfile:5-10`) must produce it. Without it the
  server still runs but answers 503 with a build hint for non-API routes
  (`internal/server/router.go:49-53`).
- **No database, no Redis, no auth provider** — the only runtime dependency
  beyond the deployer is the local filesystem.

## Consequences

- Starting the deployer first is a real prerequisite (README quick start
  says so, `README.md:14`); without it the project list is unavailable.
- Losing `data/projects.json` loses all saved deploy dirs/ports; there is no
  backup mechanism.
- Download URLs shown in the UI are built by joining `deployer.base_url`
  with `/api/v1/artifacts/<project>/<download_path>`
  (`internal/server/handlers.go:506-508`); they point browsers **directly at
  the deployer**, not through this service.
- The `/api/config` endpoint returns the whole runtime config to any caller
  (`internal/server/handlers.go:44-50`); it contains no secrets today, but
  the endpoint is unauthenticated (see 0001).

## Evidence

- `internal/deployer/client.go:24-46` — endpoints and timeout.
- `internal/server/handlers.go:52-107` — deployer proxies and project view.
- `internal/state/store.go:20-57` — projects.json load/save.
- `internal/models/config.go:24-39` — defaults.
- `internal/server/router.go:33-54` — SPA fallback and 503 hint.
- `frontend/package.json` — React 19 / Vite 7 / `tsc && vite build`.
- `Dockerfile:5-10`, `:27-28` — frontend build stage and copy.
