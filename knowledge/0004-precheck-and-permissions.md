# 0004 — Precheck and Permissions

## Status

Accepted (records current state; 0777 permissions recorded as-is)

## Date

2026-11-04

## Context

The "precheck" endpoint (`POST /api/projects/:name/precheck`, added in commit
`f3bee6a`) is the only filesystem-preparation step before initialization. Its
name suggests broader checks; the implementation is narrow.

## Decision

Record exactly what precheck does (`internal/server/handlers.go:510-557`):

1. Requires `deploy_dir` to be saved for the project
   (`internal/server/handlers.go:243-250`).
2. If the deploy directory does not exist, creates it with mode `0777`
   (`handlers.go:519-523`).
3. `chmod`s the deploy directory to `0777` unconditionally
   (`handlers.go:531-534`).
4. If `<deploy_dir>/<artifact.file_name>` exists, `chmod`s it to `0777`
   (`handlers.go:548-553`); otherwise reports that the file does not exist
   yet (`handlers.go:540-545`).
5. Returns before/after modes and a message; nothing else.

It does **not**: download anything, verify sha256 or size, check disk space,
check the running platform, or validate the artifact against the manifest.

## Consequences (recorded as-is)

- **World-writable permissions (0777)** on the deploy directory and the
  service binary are the intended outcome of this flow. This is a security
  trade-off; whether it is deliberate convenience for a single-operator
  self-hosted box is *pending author confirmation*. The knowledge base
  records the behavior without endorsing it.
- Because precheck never fetches the artifact, the "update" story still
  depends on the operator downloading the binary manually from the link the
  UI shows (see 0001).
- The precheck result is displayed verbatim in the UI
  (`frontend/src/App.tsx:468-494`).

## Evidence

- `internal/server/handlers.go:207-267` — precheck handler.
- `internal/server/handlers.go:510-557` — `runPrecheck` implementation (0777 at lines 520, 531, 550).
- `internal/models/project.go:72-84` — result shape.
- `frontend/src/App.tsx:212-236`, `:468-494` — UI trigger and rendering.
- Commit: `f3bee6a` (project deployment management and API).
