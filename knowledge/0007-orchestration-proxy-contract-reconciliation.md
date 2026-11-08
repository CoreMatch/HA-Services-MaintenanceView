# 0007 — Orchestration Proxy Contract Reconciliation

## Status

Accepted (records current state)

## Context

The orchestration operations surface was designed against an assumed Deployer
contract (`/home/lnb/Desktop/HA/MAINTENANCEVIEW-ORCHESTRATION-DESIGN-20261108.md`
§4, explicitly marked as assumptions pending the Deployer-side knowledge
0007). HA-Services-Deployer has since shipped its bare-metal orchestration
endpoints (`/home/lnb/Desktop/HA/HA-Services-Deployer/knowledge/0007-bare-metal-orchestration-scope.md`),
and this service's proxy was reconciled against the Deployer's actual code
(`internal/server/handlers_deploy.go`, `internal/server/router.go`,
`internal/orchestrator`) and re-verified against a live local Deployer
instance on 2026-11-08.

## Decision

Record the reconciled contract as implemented at HEAD.

### Upstream endpoints proxied (Deployer actual, not assumed)

| MV endpoint | Deployer endpoint | Auth |
|---|---|---|
| `GET /api/orchestration/manifest` | `GET /api/v1/deploy/manifests` | none (read-only) |
| `GET /api/orchestration/validation` | `GET /api/v1/deploy/validate` | none (read-only) |
| `GET /api/orchestration/status` | `GET /api/v1/deploy/status` | none (read-only) |
| `GET /api/orchestration/runs` | `GET /api/v1/deploy/runs` | none (read-only) |
| `GET /api/orchestration/runs/:id` | `GET /api/v1/deploy/runs/:id` | none (read-only) |
| `POST /api/orchestration/deploy` | `POST /api/v1/deploy/run` | `X-Deploy-Token` injected server-side |
| `POST /api/orchestration/rollback` | `POST /api/v1/deploy/rollback` | `X-Deploy-Token` injected server-side |

Differences from the design-doc assumptions that matter:

- The path group is `/api/v1/deploy/*`, not `/api/v1/orchestration/*`.
- Mutation auth is the `X-Deploy-Token` request header, not
  `Authorization: Bearer`. Fail-closed: unconfigured token on the Deployer
  side answers 503; a wrong token answers 401.
- Mutations return the full run snapshot (202), not a bare `run_id`.
- Rollback is single-project `{project, to, cascade}`; empty `to` selects
  the newest non-active release.
- `validate` returns `{ok, errors, warnings}`; `Run` objects carry
  `preflight` (the passed preflight report) and `notes` (anomaly events);
  refused runs answer 400 with `data.errors` (validation) or
  `data.preflight` (blockers/warnings). Shapes mirrored in
  `internal/models/orchestration.go`.
- The Deployer also serves read-only `GET /api/v1/deploy/preflight`; this
  service does not proxy it (refusal payloads and run snapshots already
  carry the full preflight report).

### Manager gate semantics

The trigger gate (`internal/server/handlers_orchestration.go::gateManagedProjects`)
judges by the manifest-declared `manager`, matching the design: only
`manager: tinyvisor` projects may be deployed/rolled back from this panel;
`aapanel`/`manual` answer 409 with per-project readable reasons, `external`
projects answer as external dependencies. The Deployer's status view reports
the *effective* manager after deployment-context overrides; in a local
verification context the two can differ, and the panel deliberately follows
the declared value (fail-closed). The status table in the UI shows the
effective value and annotates the declaration when they drift. The Deployer
foreign semantics remain the final backstop: foreign projects are never
touched regardless.

### Live alignment evidence (2026-11-08)

Verified against a live local Deployer (isolated environment, orchestration
enabled, scanning this workspace; Tinyvisor reachable):

- Read side: 13 aggregated manifests; validation `ok` with one duplicate-name
  warning surfaced; status with foreign/healthy fields; run history and run
  detail with per-step records passed through byte-for-byte.
- Mutation side: dry-run deploy answered 202 with the run snapshot including
  the `preflight` report and finished with per-step dry-run plan; manager
  gate answered 409 with rejections for a panel-managed project; rollback
  without a previous release answered 400 with the upstream message and
  `upstream_status` preserved.
- Frontend: login gate, stats, validation panel (errors/warnings), manifest
  table, status table with action gating, run history, and failed-run detail
  (error text verbatim) verified through the rendered UI.

## Consequences

- The proxy contract lives in exactly two files
  (`internal/deployer/client.go`, `internal/models/orchestration.go`);
  upstream evolution is reconciled there and here.
- Go nil slices serialize as JSON `null` upstream (e.g. empty `errors`);
  the frontend normalizes all list fields in `frontend/src/api.ts` before
  rendering.

## Evidence

- `internal/server/handlers_orchestration.go` — proxy handlers and manager gate.
- `internal/deployer/client.go` — upstream paths and `X-Deploy-Token` injection.
- `internal/models/orchestration.go` — reconciled shapes.
- `internal/server/orchestration_test.go` — stub-Deployer coverage of the same contract.
- [xref] `/home/lnb/Desktop/HA/HA-Services-Deployer/internal/server/handlers_deploy.go` — upstream implementation.
- [xref] `/home/lnb/Desktop/HA/HA-Services-Deployer/knowledge/0007-bare-metal-orchestration-scope.md` — upstream scope entry.
