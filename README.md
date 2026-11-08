# HA-Services-MaintenanceView

`HA-Services-MaintenanceView` is the service-side WebUI host for HA deployment management.

## Current scope

- expose a browser-facing HTTP server
- serve the WebUI from `frontend/dist`
- proxy selected requests to `HA-Services-Deployer`
- proxy the Deployer's orchestration surface (manifest/status/deploy/rollback/runs)
  with server-held deploy credentials; the browser never receives them
- session login for operators, reusing the existing ops identity (the deploy
  token) — no separate account system

## Quick start

1. Copy `config.example.yaml` to `config.yaml`.
2. Start the deployer backend first.
3. For the backend:

```bash
go run .
```

4. For frontend development (the `ha-ui` submodule must be initialized first):

```bash
git submodule update --init
cd frontend
npm install
npm run dev
```

5. For a production-like local run:

```bash
cd frontend
npm install
npm run build
```

Then open `http://127.0.0.1:2771` — the port follows `server.listen` in
`config.yaml` (the example file and the code default use `:2771`; container
deployments use `:18081`, see the Dockerfile).

## Deployment facts

Authoritative deployment facts live in [`deploy-manifest.yaml`](deploy-manifest.yaml)
at the repo root (consumed by HA-Services-Deployer's orchestrator;
`manager: aapanel` means the process is panel-managed and the orchestrator
treats it as read-only):

- Bare-metal production listens on `:2771`, loopback-only (container
  deployments use `:18081`); health probe `GET /healthz`.
- Depends on HA-Services-Deployer (`deployer.base_url`); no database, no Redis.
- Config file `config.yaml` (template version 1); state in
  `./data/projects.json`; static frontend served from `./frontend/dist`.

## Credentials

- `deployer.token` — the Deployer deploy credential (existing ops identity).
  It stays server-side: the proxy injects it into outbound mutation requests,
  and the same value verifies panel logins. When empty, the panel keeps the
  legacy login-free behavior and deploy/rollback triggers fail closed (503).
- No endpoint ever returns token material; `GET /api/config` is redacted.

## API skeleton

- `GET /healthz`
- `GET /api/healthz`
- `GET /api/session` · `POST /api/session/login` · `POST /api/session/logout`
- `GET /api/config` (redacted)
- `GET /api/projects`
- `PUT /api/projects/:name/deployment`
- `POST /api/projects/:name/precheck`
- `POST /api/projects/:name/initialize`
- `GET /api/deployer/healthz`
- `GET /api/deployer/manifest`
- `GET /api/request-log`
- `GET /api/orchestration/manifest`
- `GET /api/orchestration/validation`
- `GET /api/orchestration/status`
- `GET /api/orchestration/runs`
- `GET /api/orchestration/runs/:id`
- `POST /api/orchestration/deploy`
- `POST /api/orchestration/rollback`

Routes registered after the session middleware require a valid session when
`deployer.token` is configured. The orchestration shapes proxied here follow
the Deployer's orchestration contract; when `deployer.token` is unset the
mutation routes answer 503.

## Local alignment environment (real Deployer, from scratch)

How to stand up the isolated environment used to verify this panel against a
**real** HA-Services-Deployer (not a stub). Everything stays local: isolated
directories and ports, loopback only, no production host touched. The
Deployer repository is used as-is — build its binary, never modify it.

Ports and directories used here (any free equivalents work):

| Component | Port | Working directory |
|---|---|---|
| Tinyvisor | 18093 | `/tmp/ha-e2e/tinyvisor` |
| HA-Services-Deployer (orchestration enabled) | 18090 | `/tmp/ha-e2e/deployer-run` |
| This service (panel) | 18081 | this repository root |

### 1. Tinyvisor

Any current Tinyvisor binary works (on this machine:
`/home/lnb/Minivisor/build/tinyvisor`). Create its run directory:

```bash
mkdir -p /tmp/ha-e2e/tinyvisor && cd /tmp/ha-e2e/tinyvisor
cat > config.json <<'EOF'
{
  "port": 18093,
  "name": "Tinyvisor E2E",
  "apiKey": "<random-hex-32>",
  "pairingPIN": ""
}
EOF
/home/lnb/Minivisor/build/tinyvisor   # keep it running
```

### 2. Real Deployer

Build the binary from a sibling `HA-Services-Deployer` checkout
(`go build -o /tmp/ha-e2e/deployer-bin/ha-services-deployer .`) and create a
run directory — the Deployer reads `config.yaml` from its working directory:

```bash
mkdir -p /tmp/ha-e2e/deployer-run && cd /tmp/ha-e2e/deployer-run
cat > credentials.json <<'EOF'
{
  "tinyvisor_api_key": "<same as Tinyvisor config.json apiKey>",
  "deploy_token": "<random-hex-32>",
  "github_token": ""
}
EOF
chmod 600 credentials.json
cat > config.yaml <<'EOF'
version: "2"
server:
  listen: ":18090"
storage:
  artifacts_root: /tmp/ha-e2e/deployer-run/data/artifacts
manifest:
  path: /tmp/ha-e2e/deployer-run/data/manifest.json
orchestration:
  enabled: true
  scan_roots:
    - /home/lnb/Desktop/HA          # scans <root>/<repo>/deploy-manifest.yaml
  external_manifests: /home/lnb/Desktop/HA/HA-Services-Deployer/deploy/manifests
  state_dir: /tmp/ha-e2e/deployer-run/data/deploy
  probe_host: 127.0.0.1
  tinyvisor:
    url: http://127.0.0.1:18093
  credentials_path: /tmp/ha-e2e/deployer-run/credentials.json
  overrides:
    # Deployment-context overrides: point the deployable projects at the
    # isolated install roots instead of their production paths. Required for
    # any run (even dry-run) to pass preflight on a dev machine.
    avalon:
      install_root: /tmp/ha-e2e/avl
      service_version: "1.0.1"
      artifact_local_path: /tmp/ha-e2e/artifacts/avl/avalon-linux-amd64
    cascade:
      install_root: /tmp/ha-e2e/casc
      health_port: 15153
      ports: { game: 15123, http: 15153 }
      service_version: "1.0.0"
      artifact_local_path: /tmp/ha-e2e/artifacts/casc/cascade-linux-amd64
EOF
/tmp/ha-e2e/deployer-bin/ha-services-deployer   # keep it running
```

Its startup log must say `orchestration enabled: scan_roots=...`. Create the
install-root skeletons before triggering anything (preflight requires them to
exist and be writable): `mkdir -p /tmp/ha-e2e/avl/releases /tmp/ha-e2e/casc/releases`.
The `artifact_local_path` files are only needed for real (non-dry-run)
deploys; dry-runs and all read/error paths work without them.

### 3. This service

Point the local `config.yaml` (git-ignored) at the real Deployer, reusing the
deploy token from step 2 as the panel credential:

```yaml
deployer:
  base_url: http://127.0.0.1:18090
  token: "<same as credentials.json deploy_token>"
server:
  frontend_dist: ./frontend/dist
  listen: :18081
state:
  projects_path: ./data/projects.json
version: "1"
```

Build and run from the repository root (`go build -o hasmv .`, frontend via
`cd frontend && npm install && npm run build`), then open
`http://127.0.0.1:18081` and log in with that same token.

### 4. Confirming the page shows the real Deployer's data

Do not trust the panel on faith — cross-check counts against the source:

- **Run records:** the number of entries in the 运行记录 panel must equal
  both `curl -s http://127.0.0.1:18081/api/orchestration/runs` (after login,
  `data.runs | length`) and `ls /tmp/ha-e2e/deployer-run/data/deploy/runs/*.json | wc -l`
  on disk. Triggering one dry-run deploy from the UI must raise all three by
  one.
- **Projects:** 项目总数 in the stats row must equal `data.count` from
  `/api/orchestration/manifest` — which is the number of manifest files
  under the scan roots and `external_manifests` **after** duplicate-project
  resolution (parallel worktree copies are dropped deterministically and
  surface as the duplicate warning in the validation panel; on this
  machine: 14 files → 13 projects).
- **Liveness:** the Tinyvisor stat must read 可达; a dry-run triggered from
  the UI must finish with per-step `dry-run:` plan lines in the run detail —
  a stub could not produce real step records backed by files on disk.
