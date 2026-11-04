# 0005 — Configuration Shape and Port Drift

## Status

Accepted (records current state, including accidental artifacts in git)

## Date

2026-11-04

## Context

Config versioning was added in commit `bf28b0d` (2026-10-17). That same
commit changed the default listen port and left migration backup files in
the repository.

## Decision

Record the verified shape and the drift:

- **Auto-generated config.** Missing `config.yaml` → defaults are written to
  disk and the service **continues running with them**
  (`internal/config/config.go::Load`).
- **Defaults in code** (`internal/models/config.go::DefaultConfig`):
  `version: "1"`, `server.listen: ":2771"`, `server.public_base_url:
  "http://127.0.0.1" + ":2771"`, `server.frontend_dist: "./frontend/dist"`,
  `deployer.base_url: "http://127.0.0.1" + ":18080"`, `state.projects_path:
  "./data/projects.json"`.
- **Migration framework at version "1" with an empty chain**
  (`internal/config/migrations.go::ConfigVersion`,
  `internal/config/migrations.go::configMigrations`); a config without
  `version` is stamped to `"1"` with a `.bak.<old-version>` backup written
  first (`internal/config/migrations.go::MigrateConfig`,
  `internal/config/migrations.go::BackupConfigFile`).
- **Port drift (recorded as-is).** Commit `bf28b0d` changed the default
  listen port/public URL **from 18081 to 2771** (commit message). Meanwhile:
  - `README.md:L37 @ 55962a3` tells users to open `http://127.0.0.1` +
    `:18081`;
  - the Docker image `EXPOSE 18081` (`Dockerfile:L31`);
  - the platform compose maps `${MAINTENANCEVIEW_PORT:-18081}` and renders a
    config with `listen: ":18081"` (HA-Services-Deployer
    `/home/lnb/Desktop/HA/HA-Services-Deployer/deploy/docker-compose.yml (field: MAINTENANCEVIEW_PORT)`,
    `/home/lnb/Desktop/HA/HA-Services-Deployer/deploy/config/ha-services-maintenance-view.yaml.tmpl (field: listen)`).
  So `:2771` applies only to a bare local `go run .`; every documented or
  composed deployment uses `:18081`.
  **Update 2026-11-05**: the README quick-start no longer hard-codes
  `:18081`; it now points at `:2771` (matching `config.example.yaml` and the
  code default) and notes that container deployments use `:18081`. The
  Dockerfile/compose side of the drift is unchanged.
- **Accidental artifacts tracked in git.** `config.yaml.bak.0` and
  `config.yaml.bak.1` (both containing the old `:18081` config) were
  committed in `bf28b0d` and are still tracked. They are migration backups
  from the author's machine, not intended content. `.gitignore` also carries
  a temporary entry for stray `1` files added in the same commit.

## Consequences

- Operators running `go run .` without a config file get port 2771; the
  README pointed at `:18081` until 2026-11-05 and now documents `:2771`
  for the bare local run. Composed deployments are unaffected (template
  sets 18081).
- `public_base_url` is currently returned by `GET /api/config` but no
  verified code path consumes it for redirects or URL building (frontend
  uses relative paths). Its intended purpose is *pending author
  confirmation*.
- The tracked `.bak` files are noise; removing them is out of scope for this
  knowledge-base-only change.

## Evidence

- `internal/config/config.go::Load` — auto-generate and continue.
- `internal/models/config.go::DefaultConfig` — defaults.
- `internal/config/migrations.go::ConfigVersion`,
  `internal/config/migrations.go::configMigrations`,
  `internal/config/migrations.go::MigrateConfig`,
  `internal/config/migrations.go::BackupConfigFile`.
- Commit `bf28b0d` — message: "update default server listen port and public base URL from 18081 to 2771"; diff adds `config.yaml.bak.0`, `config.yaml.bak.1`.
- `README.md:L37 @ 55962a3`; `Dockerfile:L31`; HA-Services-Deployer
  `/home/lnb/Desktop/HA/HA-Services-Deployer/deploy/config/ha-services-maintenance-view.yaml.tmpl (field: listen)`
  (`listen: ":18081"`).
- `config.example.yaml` — matches code defaults (`:2771`).
