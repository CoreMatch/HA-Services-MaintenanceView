<!-- anchor-policy: archival -->
# 0006 — Open Gaps and Direction

## Status

Archival snapshot (2026-11-12): the legacy per-project bootstrap UI
(`frontend/src/BootstrapView.tsx`) was removed; its successor is the one-click
initialization wizard — see 0008. Anchors demoted to plain text per archival policy.

Accepted (internal gap inventory; nothing here is a commitment or contract)

## Context

This project is work-in-progress and outside the contract surface (see
README index of this knowledge base). This entry consolidates the gaps
recorded across 0001–0005 so the maintenance picture is in one place, and
lists the design questions that cannot be answered from code alone.

## Decision

Record the gaps as-is.

### Missing capabilities (verified absent at HEAD)

1. **Artifact download / install / update flow of this service's own.** No
   backend code here fetches an artifact from the Cupbearer, replaces a
   binary, or restarts anything directly (0001). The legacy bootstrap page
   only links out (`frontend/src/BootstrapView.tsx (download_url)`); binary
   lifecycle is delegated to HA-Cupbearer's orchestration endpoints
   via the proxy (`internal/server/handlers_orchestration.go (TriggerDeploy)`).
2. **Content verification.** sha256/size are displayed but never checked
   (0001). This mirrors the Cupbearer-side gap (HA-Cupbearer
   knowledge base 0003): today no component verifies artifact bytes.
3. **Direct process management.** This service still performs no
   start/stop/restart/status itself; it proxies the Cupbearer orchestrator,
   which drives Tinyvisor
   (`internal/server/handlers_orchestration.go (GetOrchestrationStatus)`).
4. **Multi-artifact selection.** Only `artifacts[0]` is ever considered
   (`internal/server/handlers.go (selectProjectArtifact)`,
   `frontend/src/BootstrapView.tsx (runPrecheck)`).
5. **Bootstrap coverage.** 3 services have specs; the rest of the platform
   (haskinlib, winnerproxy, mca-server, ha-webui-sdkhandler,
   ha-cupbearer, this service itself) has none
   (`internal/server/bootstrap_specs.go (bootstrapSpecs)`).

### Questions pending author confirmation

- **Priority/intent:** which of the gaps above are actually planned, and in
  which order? No design notes exist in-repo; intent cannot be inferred
  from code.
- **`public_base_url` (0005):** reserved for future redirects/links, or
  vestigial?
- **Relationship to HA-Contract:** if/when this project stabilizes, whether
  its API should be contracted at all remains the author's call; today it is
  explicitly excluded.

### Resolved (author-confirmed)

- **0777 permissions (0004):** confirmed as deliberate convenience for
  single-operator self-hosting, not a placeholder. Costs (multi-user or
  network-exposed hosts) are recorded in 0004.
- **Authentication/authorization (2026-11-08):** single-credential session
  model shipped — panel login verifies against `cupbearer.token` (the
  existing ops identity), the proxy injects the token into outbound Cupbearer
  mutation requests, `GET /api/config` is redacted, and mutation endpoints
  fail closed when the token is unset
  (`internal/server/auth.go (authMiddleware)`,
  `internal/server/handlers_orchestration.go (TriggerDeploy)`).
- **Docs (2026-11-08):** the README API skeleton now lists every route,
  including the deployment PUT route and the orchestration/session surface.

## Consequences

- Until the download/verify flow exists, this service does not "deploy"
  anything by itself; it prepares directories and first-run configs. All
  external descriptions should keep saying so.
- This entry must be updated when gaps close.

## Evidence

- Cross-references: 0001 (inventory), 0002 (data flow), 0003 (bootstrap limits), 0004 (permissions), 0005 (config drift).
- `internal/server/router.go (NewRouter)` — full route table (session
  middleware guards the routes registered after it when `cupbearer.token`
  is configured).
- `internal/server/handlers.go (selectProjectArtifact)` — first-artifact default.
- `internal/server/bootstrap_specs.go (bootstrapSpecs)` — three specs only.
