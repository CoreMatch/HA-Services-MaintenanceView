<!-- anchor-policy: archival -->
# 0001 — Work-in-Progress Status

## Status

Archival snapshot (2026-11-12): the legacy per-project bootstrap UI
(`frontend/src/BootstrapView.tsx`) was removed; its successor is the one-click
initialization wizard — see 0008. Anchors demoted to plain text per archival policy.

Accepted (records current state; explicitly a snapshot of an unfinished project)

## Context

HA-Services-MaintenanceView is described by its README as "the service-side
WebUI host for HA deployment management" (`README.md (writing-time line ref, not anchored) ~ `HA-Services-MaintenanceView` is the service-sid`). HA-Contract
explicitly excludes this project from the version-manifest contract and calls
it work-in-progress. This entry inventories what exists and what does not,
without dressing it up.

## Decision

Record the honest inventory at HEAD.

### What exists (implemented)

- Browser-facing HTTP server serving a single-page React frontend from
  `frontend/dist`, with an SPA fallback and a 503 + hint when the frontend
  build is missing (`internal/server/router.go (NewRouter)`).
- Project overview merging the deployer's `/api/v1/projects` with local
  per-project settings (`internal/server/handlers.go (buildProjectViews)`).
- Saving per-project `deploy_dir` and `port` with basic validation and
  cross-project port-uniqueness checks
  (`internal/server/handlers.go (SaveProjectDeployment)`,
  `internal/server/handlers.go (validateUniquePort)`), persisted
  to `data/projects.json` (`internal/state/store.go (Store)`).
- A "precheck" that prepares directories/permissions (see 0004).
- A config bootstrap ("initialization") for exactly three services (see
  0003).
- Frontend: a tabbed single-page app (no router library). The shell with
  session gate and tab navigation (`frontend/src/App.tsx (App)`) hosts the
  orchestration operations view (Cupbearer proxy: status/validation/runs/
  deploy/rollback, `frontend/src/OrchestrationView.tsx (OrchestrationView)`)
  and the legacy bootstrap page listing projects, editing deploy dir/port,
  and triggering precheck/initialize
  (`frontend/src/BootstrapView.tsx (BootstrapView)`).
- Multi-stage Docker image building the frontend and the Go server
  (`Dockerfile`).

### What does not exist (placeholders / missing)

- **No artifact download, install, or update flow of its own.** The legacy
  bootstrap page only renders a plain download link to the deployer artifact
  (`frontend/src/BootstrapView.tsx (download_url)`); nothing in this backend
  fetches, replaces, or installs binaries. Binary lifecycle is proxied to
  HA-Cupbearer's orchestration endpoints instead
  (`internal/server/handlers_orchestration.go (TriggerDeploy)`).
- **No sha256 verification anywhere in this service.** Digests are displayed
  (`frontend/src/BootstrapView.tsx (sha256)`) but never computed or compared.
- **No direct process management** — lifecycle actions are proxied to the
  Cupbearer orchestrator, which drives Tinyvisor
  (`internal/server/handlers_orchestration.go (TriggerRollback)`); this
  service never calls Tinyvisor itself.
- **Authentication** is a single-credential session model: panel login is
  verified against `deployer.token` (the existing ops identity), the proxy
  injects the token into outbound Cupbearer mutation requests, and
  `GET /api/config` is redacted (`internal/server/auth.go (authMiddleware)`,
  `internal/server/handlers.go (GetConfig)`). With `deployer.token` empty the
  legacy login-free behavior is kept and mutation proxying fails closed.
- **Only the first artifact is ever used** — UI and handlers take
  `artifacts[0]` (`frontend/src/BootstrapView.tsx (runPrecheck)`,
  `frontend/src/BootstrapView.tsx (initializeProject)`,
  `frontend/src/BootstrapView.tsx (writing-time line ref, not anchored)`;
  `internal/server/handlers.go (selectProjectArtifact)` defaults to the first
  artifact when no id is given).
- Bootstrap coverage: 3 of the platform's services (see 0003); everything
  else gets "initialization is not supported for this project yet"
  (`internal/server/handlers.go (InitializeProject)`).

## Consequences

- The service is usable today only as a **deployment metadata + first-install
  config helper** on a trusted single host, with binaries placed manually by
  the operator. Any broader reading of its capabilities would be wrong.
- The gap list in 0006 is the honest "what's left" view; none of it is
  committed roadmap.

## Evidence

- `internal/server/router.go (NewRouter)`, `internal/server/handlers.go`,
  `internal/server/handlers_orchestration.go`, `internal/server/auth.go`,
  `frontend/src/App.tsx`, `frontend/src/OrchestrationView.tsx`,
  `frontend/src/BootstrapView.tsx` as cited above.
- Contract exclusion: HA-Contract
  `/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/knowledge/0006-version-manifest.md (Purpose)`
  ("work-in-progress project and is not covered by this contract").
