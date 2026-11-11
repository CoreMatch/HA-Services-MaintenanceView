<!-- anchor-policy: archival -->
# 0004 — Precheck and Permissions

## Status

Archival snapshot (2026-11-12): the legacy per-project bootstrap UI
(`frontend/src/BootstrapView.tsx`) was removed; its successor is the one-click
initialization wizard — see 0008. Anchors demoted to plain text per archival policy.

Accepted — the 0777 permission behavior is **confirmed by the author as
deliberate convenience for single-operator self-hosting**,
not an oversight. Its costs are recorded below.

## Context

The "precheck" endpoint (`POST /api/projects/:name/precheck`) is the only
filesystem-preparation step before initialization. Its
name suggests broader checks; the implementation is narrow.

## Decision

Record exactly what precheck does (`internal/server/handlers.go (runPrecheck)`):

1. Requires `deploy_dir` to be saved for the project
   (`internal/server/handlers.go (RunProjectPrecheck)`).
2. If the deploy directory does not exist, creates it with mode `0777`
   (`internal/server/handlers.go (runPrecheck)`).
3. `chmod`s the deploy directory to `0777` unconditionally
   (`internal/server/handlers.go (runPrecheck)`).
4. If `<deploy_dir>/<artifact.file_name>` exists, `chmod`s it to `0777`
   (`internal/server/handlers.go (runPrecheck)`); otherwise reports that the
   file does not exist yet (`internal/server/handlers.go (runPrecheck)`).
5. Returns before/after modes and a message; nothing else.

It does **not**: download anything, verify sha256 or size, check disk space,
check the running platform, or validate the artifact against the manifest.

## Consequences (confirmed design + costs)

- **World-writable permissions (0777)** on the deploy directory and the
  service binary are the intended outcome of this flow. The author confirmed
  that this is a **deliberate convenience for single-operator
  self-hosting**, not an oversight. It removes all permission friction for
  the one operator who both runs this service and manages the target
  binaries by hand.
- **Cost / when this does not hold.** The 0777 posture is only defensible on
  a single-user, trusted, non-exposed host. It stops being acceptable if:
  - the host has **multiple users** (any local user can replace the service
    binary between precheck and start, i.e. a local privilege-escalation /
    tampering path); or
  - the deploy directory or this service is **exposed to an untrusted
    network** (the precheck endpoint lets anyone with a panel session
    chmod/create directories; when `cupbearer.token` is unset the panel is
    login-free, see 0001/0006).
  In either of those environments the permission model would need to be
  tightened; nothing in this entry is an endorsement of 0777 beyond the
  stated single-operator case.
- Because precheck never fetches the artifact, the "update" story still
  depends on the operator downloading the binary manually from the link the
  UI shows (see 0001).
- The precheck result is displayed verbatim in the UI
  (`frontend/src/BootstrapView.tsx (directory_mode_before)`).

## Evidence

- `internal/server/handlers.go (RunProjectPrecheck)` — precheck handler.
- `internal/server/handlers.go (runPrecheck)` — implementation (mode `0o777`
  passed to `os.MkdirAll` and to both `os.Chmod` calls).
- `internal/models/project.go (UpdatePrecheckResult)` — result shape.
- `frontend/src/BootstrapView.tsx (runPrecheck)`,
  `frontend/src/BootstrapView.tsx (directory_mode_before)` — UI trigger and
  rendering (legacy bootstrap page).
