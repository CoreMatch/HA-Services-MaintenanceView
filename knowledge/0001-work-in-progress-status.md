# 0001 — Work-in-Progress Status

## Status

Accepted (records current state; explicitly a snapshot of an unfinished project)

## Context

HA-Services-MaintenanceView is described by its README as "the service-side
WebUI host for HA deployment management" (`README.md:L3`). HA-Contract
explicitly excludes this project from the version-manifest contract and calls
it work-in-progress. This entry inventories what exists and what does not,
without dressing it up.

## Decision

Record the honest inventory at HEAD.

### What exists (implemented)

- Browser-facing HTTP server serving a single-page React frontend from
  `frontend/dist`, with an SPA fallback and a 503 + hint when the frontend
  build is missing (`internal/server/router.go::NewRouter`).
- Project overview merging the deployer's `/api/v1/projects` with local
  per-project settings (`internal/server/handlers.go::buildProjectViews`).
- Saving per-project `deploy_dir` and `port` with basic validation and
  cross-project port-uniqueness checks
  (`internal/server/handlers.go::SaveProjectDeployment`,
  `internal/server/handlers.go::validateUniquePort`), persisted
  to `data/projects.json` (`internal/state/store.go::Store`).
- A "precheck" that prepares directories/permissions (see 0004).
- A config bootstrap ("initialization") for exactly three services (see
  0003).
- Frontend: one hand-styled React page (no router library) listing projects,
  editing deploy dir/port, and triggering precheck/initialize
  (`frontend/src/App.tsx::App`).
- Multi-stage Docker image building the frontend and the Go server
  (`Dockerfile`).

### What does not exist (placeholders / missing)

- **No artifact download, install, or update flow.** The UI only renders a
  plain download link to the deployer artifact
  (`frontend/src/App.tsx::download_url`); nothing in the backend fetches,
  replaces, or installs binaries.
- **No sha256 verification anywhere.** Digests are displayed
  (`frontend/src/App.tsx::sha256`) but never computed or compared.
- **No process management** — no start/stop/restart of services.
- **No authentication** on any endpoint
  (`internal/server/router.go::NewRouter`).
- **Only the first artifact is ever used** — UI and handlers take
  `artifacts[0]` (`frontend/src/App.tsx::runPrecheck`,
  `frontend/src/App.tsx::initializeProject`, `frontend/src/App.tsx:L329`;
  `internal/server/handlers.go::selectProjectArtifact` defaults to the first
  artifact when no id is given).
- **README endpoint list is incomplete.** The API skeleton
  (`README.md:L41-L50`) lists eight of the nine routes and omits
  `PUT /api/projects/:name/deployment`
  (`internal/server/router.go::NewRouter`).
- Bootstrap coverage: 3 of the platform's services (see 0003); everything
  else gets "initialization is not supported for this project yet"
  (`internal/server/handlers.go::InitializeProject`).

## Consequences

- The service is usable today only as a **deployment metadata + first-install
  config helper** on a trusted single host, with binaries placed manually by
  the operator. Any broader reading of its capabilities would be wrong.
- The gap list in 0006 is the honest "what's left" view; none of it is
  committed roadmap.

## Evidence

- `internal/server/router.go::NewRouter`, `internal/server/handlers.go`, `frontend/src/App.tsx` as cited above.
- Contract exclusion: HA-Contract
  `/home/lnb/Desktop/HA/HA-Services-Deployer/knowledge/0006-version-manifest.md::Purpose`
  ("work-in-progress project and is not covered by this contract").
