# 0006 — Open Gaps and Direction

## Status

Accepted (internal gap inventory; nothing here is a commitment or contract)

## Date

2026-11-04

## Context

This project is work-in-progress and outside the contract surface (see
README index of this knowledge base). This entry consolidates the gaps
recorded across 0001–0005 so the maintenance picture is in one place, and
lists the design questions that cannot be answered from code alone.

## Decision

Record the gaps as-is.

### Missing capabilities (verified absent at HEAD)

1. **Artifact download / install / update flow.** No backend code fetches an
   artifact from the deployer, replaces a binary, or restarts anything
   (0001). The UI only links out (`frontend/src/App.tsx::download_url`).
2. **Content verification.** sha256/size are displayed but never checked
   (0001). This mirrors the deployer-side gap (HA-Services-Deployer
   knowledge base 0003): today no component verifies artifact bytes.
3. **Process management.** No start/stop/restart/status of managed services.
4. **Authentication/authorization.** All endpoints are open
   (`internal/server/router.go`), including config disclosure via
   `GET /api/config` and filesystem operations (precheck/init) — acceptable
   only behind a firewall.
5. **Multi-artifact selection.** Only `artifacts[0]` is ever considered
   (`internal/server/handlers.go::selectProjectArtifact`,
   `frontend/src/App.tsx::runPrecheck`).
6. **Bootstrap coverage.** 3 services have specs; the rest of the platform
   (haskinlib, winnerproxy, mca-server, ha-webui-sdkhandler,
   ha-services-deployer, this service itself) has none
   (`internal/server/bootstrap_specs.go::bootstrapSpecs`).
7. **Docs.** README endpoint list and port are stale (0001, 0005).

### Questions pending author confirmation

- **Priority/intent:** which of the gaps above are actually planned, and in
  which order? The repository shows no commits after `55962a3` (2026-11-03),
  and no design notes exist in-repo; intent cannot be inferred from code.
- **`public_base_url` (0005):** reserved for future redirects/links, or
  vestigial?
- **Relationship to HA-Contract:** if/when this project stabilizes, whether
  its API should be contracted at all remains the author's call; today it is
  explicitly excluded.

### Resolved (author confirmed 2026-11-04)

- **0777 permissions (0004):** confirmed as deliberate convenience for
  single-operator self-hosting, not a placeholder. Costs (multi-user or
  network-exposed hosts) are recorded in 0004.

## Consequences

- Until the download/verify flow exists, this service does not "deploy"
  anything by itself; it prepares directories and first-run configs. All
  external descriptions should keep saying so.
- This entry must be updated when gaps close; entries describing closed gaps
  should be superseded, not silently edited.

## Evidence

- Cross-references: 0001 (inventory), 0002 (data flow), 0003 (bootstrap limits), 0004 (permissions), 0005 (config drift).
- `internal/server/router.go::NewRouter` — full route table (no auth middleware).
- `internal/server/handlers.go::selectProjectArtifact` — first-artifact default.
- `internal/server/bootstrap_specs.go::bootstrapSpecs` — three specs only.
- `git log` — last commit `55962a3` (2026-11-03).
