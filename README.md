# HA-Services-MaintenanceView

`HA-Services-MaintenanceView` is the service-side WebUI host for HA deployment management.

## Current scope

- expose a browser-facing HTTP server
- serve the WebUI from `frontend/dist`
- proxy selected requests to `HA-Services-Deployer`

## Quick start

1. Copy `config.example.yaml` to `config.yaml`.
2. Start the deployer backend first.
3. For the backend:

```bash
go run .
```

4. For frontend development:

```bash
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

Then open `http://127.0.0.1:18081`.

## API skeleton

- `GET /healthz`
- `GET /api/healthz`
- `GET /api/config`
- `GET /api/deployer/healthz`
- `GET /api/deployer/manifest`
