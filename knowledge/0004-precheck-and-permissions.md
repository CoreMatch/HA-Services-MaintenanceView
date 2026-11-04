# 0004 — Precheck and Permissions

## Status

Accepted — the 0777 permission behavior is **confirmed by the author
(2026-11-04) as deliberate convenience for single-operator self-hosting**,
not an oversight. Its costs are recorded below.

## Date

2026-11-04

## Context

The "precheck" endpoint (`POST /api/projects/:name/precheck`, added in commit
`f3bee6a`) is the only filesystem-preparation step before initialization. Its
name suggests broader checks; the implementation is narrow.

## Decision

Record exactly what precheck does (`internal/server/handlers.go::runPrecheck`):

1. Requires `deploy_dir` to be saved for the project
   (`internal/server/handlers.go::RunProjectPrecheck`).
2. If the deploy directory does not exist, creates it with mode `0777`
   (`internal/server/handlers.go::runPrecheck`).
3. `chmod`s the deploy directory to `0777` unconditionally
   (`internal/server/handlers.go::runPrecheck`).
4. If `<deploy_dir>/<artifact.file_name>` exists, `chmod`s it to `0777`
   (`internal/server/handlers.go::runPrecheck`); otherwise reports that the
   file does not exist yet (`internal/server/handlers.go::runPrecheck`).
5. Returns before/after modes and a message; nothing else.

It does **not**: download anything, verify sha256 or size, check disk space,
check the running platform, or validate the artifact against the manifest.

## Consequences (confirmed design + costs)

- **World-writable permissions (0777)** on the deploy directory and the
  service binary are the intended outcome of this flow. The author confirmed
  on 2026-11-04 that this is a **deliberate convenience for single-operator
  self-hosting**, not an oversight. It removes all permission friction for
  the one operator who both runs this service and manages the target
  binaries by hand.
- **Cost / when this does not hold.** The 0777 posture is only defensible on
  a single-user, trusted, non-exposed host. It stops being acceptable if:
  - the host has **multiple users** (any local user can replace the service
    binary between precheck and start, i.e. a local privilege-escalation /
    tampering path); or
  - the deploy directory or this service is **exposed to an untrusted
    network** (the unauthenticated precheck endpoint, see 0001/0006, lets
    anyone reachable chmod/create directories).
  In either of those environments the permission model would need to be
  tightened; nothing in this entry is an endorsement of 0777 beyond the
  stated single-operator case.
- Because precheck never fetches the artifact, the "update" story still
  depends on the operator downloading the binary manually from the link the
  UI shows (see 0001).
- The precheck result is displayed verbatim in the UI
  (`frontend/src/App.tsx::directory_mode_before`).

## Evidence

- `internal/server/handlers.go::RunProjectPrecheck` — precheck handler.
- `internal/server/handlers.go::runPrecheck` — implementation (mode `0o777`
  passed to `os.MkdirAll` and to both `os.Chmod` calls).
- `internal/models/project.go::UpdatePrecheckResult` — result shape.
- `frontend/src/App.tsx::runPrecheck`,
  `frontend/src/App.tsx::directory_mode_before` — UI trigger and rendering.
- Commit: `f3bee6a` (project deployment management and API).
