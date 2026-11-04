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
  `deployer.base_url` (default `http://127.0.0.1` + `:18080`,
  `internal/models/config.go::DefaultConfig`). The client calls exactly
  three endpoints (`internal/deployer/client.go::Healthz`,
  `internal/deployer/client.go::Manifest`,
  `internal/deployer/client.go::Projects`):
  - `GET /api/v1/healthz` (proxied as `GET /api/deployer/healthz`)
  - `GET /api/v1/manifest` (proxied as `GET /api/deployer/manifest`)
  - `GET /api/v1/projects` (the binary-only projection; consumed by
    `GET /api/projects` and by the deployment/precheck/initialize handlers)
  HTTP client timeout is 10 seconds (`internal/deployer/client.go::NewClient`).
  Deployer unreachable → the affected endpoints return 502
  (`internal/server/handlers.go::GetProjects`).
- **Local state: one JSON file.** Per-project `deploy_dir`/`port` settings in
  `state.projects_path` (default `./data/projects.json`,
  `internal/models/config.go::DefaultConfig`), loaded and saved as a whole
  (`internal/state/store.go::Load`, `internal/state/store.go::Save`). Note:
  `Save` writes the file directly without temp-file + rename
  (`internal/state/store.go::Save`) — not atomic; recorded as-is.
- **Frontend build artifact.** The Go server serves `server.frontend_dist`
  (default `./frontend/dist`, `internal/models/config.go::DefaultConfig`).
  `frontend/dist` is git-ignored and **not committed**; a local `npm install
  && npm run build` (React 19 + Vite 7, `frontend/package.json`) or the
  Docker multi-stage build (`Dockerfile:L5-L10`) must produce it. Without it
  the server still runs but answers 503 with a build hint for non-API routes
  (`internal/server/router.go::NewRouter`).
- **No database, no Redis, no auth provider** — the only runtime dependency
  beyond the deployer is the local filesystem.

## Consequences

- Starting the deployer first is a real prerequisite (README quick start
  says so, `README.md:L14`); without it the project list is unavailable.
- Losing `data/projects.json` loses all saved deploy dirs/ports; there is no
  backup mechanism.
- Download URLs shown in the UI are built by joining `deployer.base_url`
  with `/api/v1/artifacts/<project>/<download_path>`
  (`internal/server/handlers.go::buildDownloadURL`); they point browsers
  **directly at the deployer**, not through this service.
- The `/api/config` endpoint returns the whole runtime config to any caller
  (`internal/server/handlers.go::GetConfig`); it contains no secrets today,
  but the endpoint is unauthenticated (see 0001).

## Evidence

- `internal/deployer/client.go::Healthz`, `internal/deployer/client.go::Manifest`,
  `internal/deployer/client.go::Projects` — endpoints;
  `internal/deployer/client.go::NewClient` — timeout.
- `internal/server/handlers.go::GetDeployerHealthz`,
  `internal/server/handlers.go::GetDeployerManifest`,
  `internal/server/handlers.go::GetProjects` — deployer proxies and project view.
- `internal/state/store.go::Load`, `internal/state/store.go::Save` — projects.json load/save.
- `internal/models/config.go::DefaultConfig` — defaults.
- `internal/server/router.go::NewRouter` — SPA fallback and 503 hint.
- `frontend/package.json` — React 19 / Vite 7 / `tsc && vite build`.
- `Dockerfile:L5-L10`, `Dockerfile:L27-L28` — frontend build stage and copy.
