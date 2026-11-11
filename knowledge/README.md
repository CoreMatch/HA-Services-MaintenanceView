# HA-Services-MaintenanceView Knowledge Base

## Positioning

This directory is **the project's own notebook** — ADR-style records kept for
self-hosting and maintenance of this service.

- **This project is a work in progress.** Per the author's positioning it is
  **not covered by any external contract**: HA-Contract states
  "HA-Services-MaintenanceView exists in the ecosystem but is a
  work-in-progress project and is not covered by this contract"
  (HA-Contract
  `/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/knowledge/0006-version-manifest.md::Purpose`).
  Accordingly, these entries record **internal current state and direction
  only**, and must not be read as descriptions of achieved, guaranteed
  functionality.
- The normative contracts for anything this service consumes live in
  [HA-Contract](https://github.com/CoreMatch/HA-Contract) (e.g. the version
  manifest contract above). When an entry here conflicts with HA-Contract,
  **fix the entry, not the contract**.
- Every claim carries evidence (`file:line`). Claims that
  could not be verified are marked `not verified`. Gaps, placeholders, and
  missing pieces are recorded as-is.

## Entries

| ID | Title | One-line claim |
|---|---|---|
| [0001](0001-work-in-progress-status.md) | Work-in-progress status | Honest inventory: project list, deploy-dir/port persistence, permission precheck, config bootstrap for three services, and a session-gated orchestration proxy exist; own download/install/update, byte verification, and direct process management do not. |
| [0002](0002-dependencies-and-data-flow.md) | Dependencies and data flow | Hard runtime dependency on HA-Cupbearer's `/api/v1/*`; local state is a single `projects.json`; the frontend must be built locally (`frontend/dist` is not committed). |
| [0003](0003-config-bootstrap-initialization.md) | Config bootstrap ("initialization") | For three hard-coded services only: requires the binary to be manually placed first, may execute it briefly to generate a default config, then patches ports and localhost URLs. |
| [0004](0004-precheck-and-permissions.md) | Precheck and permissions | Precheck only creates the deploy directory and chmods it (and the executable) to 0777; author-confirmed as deliberate single-operator convenience, with costs recorded. |
| [0005](0005-configuration-shape-and-port-drift.md) | Configuration shape and port drift | `config.yaml` auto-generated with defaults (`:2771`); Dockerfile and compose use `:18081` (README documents both); two config backup files are accidentally tracked. |
| [0006](0006-open-gaps-and-direction.md) | Open gaps and direction | Consolidated list of what is missing and which questions need author confirmation; nothing here is a commitment. |
| [0007](0007-orchestration-proxy-contract-reconciliation.md) | Orchestration proxy contract reconciliation | The proxy follows the Cupbearer's actual `/api/v1/deploy/*` contract (`X-Deploy-Token`, run snapshots, single-project rollback), reconciled and live-verified on 2026-11-08. |

## Maintenance notes

- Do not rewrite these entries into feature announcements; the project is
  explicitly unfinished.
