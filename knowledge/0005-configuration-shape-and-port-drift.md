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
  (`internal/config/config.go:17-27`).
- **Defaults in code** (`internal/models/config.go:24-39`): `version: "1"`,
  `server.listen: ":2771"`, `server.public_base_url:
  "http://127.0.0.1:2771"`, `server.frontend_dist: "./frontend/dist"`,
  `deployer.base_url: "http://127.0.0.1:18080"`, `state.projects_path:
  "./data/projects.json"`.
- **Migration framework at version "1" with an empty chain**
  (`internal/config/migrations.go:11`, `:23-27`); a config without `version`
  is stamped to `"1"` with a `.bak.<old-version>` backup written first
  (`internal/config/migrations.go:36-42`, `:110-125`).
- **Port drift (recorded as-is).** Commit `bf28b0d` changed the default
  listen port/public URL **from 18081 to 2771** (commit message). Meanwhile:
  - `README.md:37` tells users to open `http://127.0.0.1:18081`;
  - the Docker image `EXPOSE 18081` (`Dockerfile:31`);
  - the platform compose maps `${MAINTENANCEVIEW_PORT:-18081}` and renders a
    config with `listen: ":18081"` (HA-Services-Deployer
    `deploy/docker-compose.yml`,
    `deploy/config/ha-services-maintenance-view.yaml.tmpl`).
  So `:2771` applies only to a bare local `go run .`; every documented or
  composed deployment uses `:18081`.
- **Accidental artifacts tracked in git.** `config.yaml.bak.0` and
  `config.yaml.bak.1` (both containing the old `:18081` config) were
  committed in `bf28b0d` and are still tracked. They are migration backups
  from the author's machine, not intended content. `.gitignore` also carries
  a temporary entry for stray `1` files added in the same commit.

## Consequences

- Operators running `go run .` without a config file get port 2771 and will
  not match the README; composed deployments are unaffected (template sets
  18081).
- `public_base_url` is currently returned by `GET /api/config` but no
  verified code path consumes it for redirects or URL building (frontend
  uses relative paths). Its intended purpose is *pending author
  confirmation*.
- The tracked `.bak` files are noise; removing them is out of scope for this
  knowledge-base-only change.

## Evidence

- `internal/config/config.go:17-27` — auto-generate and continue.
- `internal/models/config.go:24-39` — defaults.
- `internal/config/migrations.go:11`, `:23-27`, `:36-42`, `:110-125`.
- Commit `bf28b0d` — message: "update default server listen port and public base URL from 18081 to 2771"; diff adds `config.yaml.bak.0`, `config.yaml.bak.1`.
- `README.md:37`; `Dockerfile:31`; HA-Services-Deployer `deploy/config/ha-services-maintenance-view.yaml.tmpl` (`listen: ":18081"`).
- `config.example.yaml` — matches code defaults (`:2771`).
