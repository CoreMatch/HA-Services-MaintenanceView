# 0003 — Config Bootstrap ("Initialization") for Three Services

## Status

Accepted (records current state; limited coverage by design at this stage)

## Context

"First-deployment configuration initialization" is explicitly **out of
scope of the version-manifest contract** (HA-Contract
`/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/knowledge/0006-version-manifest.md::Purpose`).
This service nonetheless implements a first-install config bootstrap for a
few services. It is internal behavior, not a contract.

## Decision

Record exactly what the bootstrap does and assumes:

- **Coverage: three hard-coded specs**
  (`internal/server/bootstrap_specs.go::bootstrapSpecs`):
  - `hrpauth` — config `config.yaml`, default port 2778, port field
    `server.port`, depends on `hrpauth-yggdrasil-api` (writes
    `yggdrasil_api.base_url`).
  - `hrpauth-yggdrasil-api` — default port 2770, port field `server.port`,
    self URLs `callback.url` + `microservice.relay_url`, depends on
    `hrpauth` (writes `core_api.base_url`).
  - `haskinproxy` — default port 2702, port field `server.listen_addr`,
    self URL `server.public_url`, depends on `hrpauth` (writes
    `upstream.base_url`).
  Any other project: "initialization is not supported for this project yet"
  (`internal/server/handlers.go::InitializeProject`).
- **Precondition: the binary must already exist.** Initialization fails if
  `<deploy_dir>/<artifact.file_name>` is not present
  (`internal/server/bootstrap_runtime.go::initializeProjectConfig`). The
  service never downloads it (see 0001).
- **Default-config generation by executing the target binary.** If the
  config file does not exist, the bootstrap **runs the target executable**
  and polls up to 8 seconds for the config file to appear, then cancels the
  process (`internal/server/bootstrap_runtime.go::generatedConfigWaitTimeout`,
  `internal/server/bootstrap_runtime.go::ensureGeneratedConfig`). This
  relies on the target service's own "generate default config on first
  start" behavior. *Not verified here per-service* — recorded as an
  assumption about sibling services' behavior.
- **Patch phase.** The (generated or existing) YAML is parsed and patched:
  port field set to `:<port>`, self-URL fields and dependency fields set to
  `http://localhost:<port>`
  (`internal/server/bootstrap_runtime.go::initializeProjectConfig`,
  `internal/server/bootstrap_runtime.go::formatListenAddress`,
  `internal/server/bootstrap_runtime.go::formatLocalURL`). Dependency ports
  must already be saved, otherwise the request fails
  (`internal/server/handlers.go::collectDependencyPorts`).
- Precheck runs before initialization inside the same request
  (`internal/server/handlers.go::InitializeProject`).

## Consequences

- The bootstrap targets **single-host localhost deployments**: all
  cross-service URLs are written as `http://localhost:<port>`. Multi-host
  deployments are not represented.
- Running an unknown third-party binary for up to 8 seconds during init is a
  trust decision; acceptable in this operator-controlled context, recorded
  as-is.
- Field paths (`server.port`, `core_api.base_url`, ...) are hard-coded
  guesses at sibling services' config schemas; there is no mechanism to
  detect drift. If a sibling service renames a key, initialization silently
  writes a stale key. Gap recorded as-is.
- Adding a service means editing `bootstrapSpecs` in code; there is no
  external spec format.

## Evidence

- `internal/server/bootstrap_specs.go::bootstrapSpecs` — the three specs.
- `internal/server/bootstrap_runtime.go::generatedConfigWaitTimeout`,
  `internal/server/bootstrap_runtime.go::initializeProjectConfig`,
  `internal/server/bootstrap_runtime.go::ensureGeneratedConfig`,
  `internal/server/bootstrap_runtime.go::formatListenAddress`,
  `internal/server/bootstrap_runtime.go::formatLocalURL`.
- `internal/server/handlers.go::InitializeProject` — initialize handler flow;
  `internal/server/handlers.go::collectDependencyPorts` — dependency port
  requirements.
- Contract context: HA-Contract
  `/home/lnb/Desktop/HA/maintanance/HA-Cupbearer/knowledge/0006-version-manifest.md::Purpose`
  (first-deployment config initialization is out of manifest scope).
