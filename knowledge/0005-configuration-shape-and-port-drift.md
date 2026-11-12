# 0005 — Configuration Shape and Port Drift

## Status

Accepted (records current state, including accidental artifacts in git).
Updated 2026-11-12: the historical port split is resolved — MV is unified on
`:2771`; the former container default `:18081` is retired as a typo.

## Context

The config layer is versioned (a migration framework currently at version
"1"), and the repository carries two migration backup files. A former port
split (code default `:2771` vs container `:18081`) existed until 2026-11-12,
when the author ruled `18080/18081` documentation-era typos (every other
service sits in the 27xx band) and MV was unified on `:2771`.

## Decision

Record the verified shape and the drift:

- **Auto-generated config.** Missing `config.yaml` → defaults are written to
  disk and the service **continues running with them**
  (`internal/config/config.go::Load`).
- **Defaults in code** (`internal/models/config.go::DefaultConfig`):
  `version: "1"`, `server.listen: ":2771"`, `server.public_base_url:
  "http://127.0.0.1" + ":2771"`, `server.frontend_dist: "./frontend/dist"`,
  `cupbearer.base_url: "http://127.0.0.1" + ":18080"`, `state.projects_path:
  "./data/projects.json"`.
- **Migration framework at version "1" with an empty chain**
  (`internal/config/migrations.go::ConfigVersion`,
  `internal/config/migrations.go::configMigrations`); a config without
  `version` is stamped to `"1"` with a `.bak.<old-version>` backup written
  first (`internal/config/migrations.go::MigrateConfig`,
  `internal/config/migrations.go::BackupConfigFile`).
- **Port unified on `:2771` (split resolved).** The code default listen
  port/public URL is `:2771` (`internal/models/config.go::DefaultConfig`,
  matched by `config.example.yaml`), and container deployments now use the
  same `:2771`:
  - the Docker image `EXPOSE 2771` (`Dockerfile`);
  - the platform compose maps `${MAINTENANCEVIEW_PORT:-2771}` and renders a
    config with `listen: ":2771"` (HA-Cupbearer
    `/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/deploy/docker-compose.yml (field: MAINTENANCEVIEW_PORT)`,
    `/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/deploy/config/ha-services-maintenance-view.yaml.tmpl (field: listen)`).
  The former container default `:18081` was a documentation-era typo (all
  other services sit in the 27xx band) and is retired; remaining `18081`
  mentions are deliberate historical annotations only.
- **Accidental artifacts tracked in git.** `config.yaml.bak.0` and
  `config.yaml.bak.1` (both containing a `:18081` config) are tracked.
  They are migration backups from the author's machine, not intended
  content; their `:18081` reflects the retired typo port and is superseded
  by `:2771`. An earlier survey recorded a temporary `.gitignore` entry for
  stray `1` files; that rule is absent from the current `.gitignore`.

## Consequences

- Operators running `go run .` without a config file get port 2771; the
  README documents `:2771` for both the bare local run and container
  deployments (unified). Composed deployments use 2771 (template sets it).
- `public_base_url` is currently returned by `GET /api/config` but no
  verified code path consumes it for redirects or URL building (frontend
  uses relative paths). Its intended purpose is *pending author
  confirmation*.
- The tracked `.bak` files are noise; removing them is a repository-hygiene
  task outside the scope of this knowledge base.

## Evidence

- `internal/config/config.go::Load` — auto-generate and continue.
- `internal/models/config.go::DefaultConfig` — defaults.
- `internal/config/migrations.go::ConfigVersion`,
  `internal/config/migrations.go::configMigrations`,
  `internal/config/migrations.go::MigrateConfig`,
  `internal/config/migrations.go::BackupConfigFile`.
- `config.yaml.bak.0`, `config.yaml.bak.1` — tracked migration backups
  (carry the retired `:18081`; historical only).
- `README.md` quick-start (`:2771`); `Dockerfile` (`EXPOSE 2771`);
  HA-Cupbearer
  `/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/deploy/config/ha-services-maintenance-view.yaml.tmpl (field: listen)`
  (`listen: ":2771"`).
- `config.example.yaml` — matches code defaults (`:2771`).
