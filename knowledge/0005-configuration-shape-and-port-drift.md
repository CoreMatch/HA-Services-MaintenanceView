# 0005 — Configuration Shape and Port Drift

## Status

Accepted (records current state, including accidental artifacts in git)

## Context

The config layer is versioned (a migration framework currently at version
"1"), and the repository carries two migration backup files plus a port
split between the code default and container deployments.

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
- **Port split between code default and containers (recorded as-is).** The
  code default listen port/public URL is `:2771`
  (`internal/models/config.go::DefaultConfig`, matched by
  `config.example.yaml`). The README quick-start points at `:2771` and
  notes that container deployments use `:18081` (`README.md:L37-L39 fp=195b56d4`).
  Container deployments indeed use `:18081`:
  - the Docker image `EXPOSE 18081` (`Dockerfile:L40 fp=416eab00`);
  - the platform compose maps `${MAINTENANCEVIEW_PORT:-18081}` and renders a
    config with `listen: ":18081"` (HA-Services-Deployer
    `/home/lnb/Desktop/HA/maintanance/HA-Services-Deployer/deploy/docker-compose.yml (field: MAINTENANCEVIEW_PORT)`,
    `/home/lnb/Desktop/HA/maintanance/HA-Services-Deployer/deploy/config/ha-services-maintenance-view.yaml.tmpl (field: listen)`).
  So `:2771` applies only to a bare local `go run .`; composed deployments
  use `:18081`.
- **Accidental artifacts tracked in git.** `config.yaml.bak.0` and
  `config.yaml.bak.1` (both containing an `:18081` config) are tracked.
  They are migration backups from the author's machine, not intended
  content. An earlier survey recorded a temporary `.gitignore` entry for
  stray `1` files; that rule is absent from the current `.gitignore`.

## Consequences

- Operators running `go run .` without a config file get port 2771; the
  README documents `:2771` for the bare local run and `:18081` for
  container deployments (`README.md:L37-L39 fp=195b56d4`). Composed deployments use
  18081 (template sets it).
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
- `config.yaml.bak.0`, `config.yaml.bak.1` — tracked migration backups.
- `README.md:L37-L39 fp=195b56d4`; `Dockerfile:L40 fp=416eab00`; HA-Services-Deployer
  `/home/lnb/Desktop/HA/maintanance/HA-Services-Deployer/deploy/config/ha-services-maintenance-view.yaml.tmpl (field: listen)`
  (`listen: ":18081"`).
- `config.example.yaml` — matches code defaults (`:2771`).
