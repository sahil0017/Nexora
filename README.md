# NEXORA

Your intelligent life platform — one app, one assistant, connected capabilities.

Modules: **Move** (mobility intelligence, Hyderabad first) · **Assistant** · **Health** · **Finance** · **Work**

## Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + TypeScript (dark theme, five-tab navigation) |
| Backend | Go + Chi modular monolith |
| Intelligence | Python + FastAPI + PyTorch |
| Database | PostgreSQL + PostGIS |
| Cache / Events / Storage | Redis · Redpanda · MinIO |
| Observability | Prometheus + Grafana |

## Repository layout

```
apps/mobile/        React Native app (5 tabs: Home/Explore/AI/Activity/Profile)
backend/api/        Go API — platform, intelligence, module internals
intelligence/       Model gateway + ML platform (FastAPI inference service)
contracts/          OpenAPI + JSON event schemas (source of truth)
infra/              postgres, prometheus, grafana configs
docs/               architecture, ADRs, api, security
```

## Quick start

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps

# API:   http://localhost:8080/api/v1/healthz
# ML:    http://localhost:8000/healthz
# Grafana: http://localhost:3000

docker compose down            # stop
docker compose down -v         # stop and wipe data
```

## Conventions

- OpenAPI (`contracts/openapi/nexora-v1.yaml`) is the HTTP contract source of truth.
- JSON Schema (`contracts/events/`) is the event contract source of truth.
- Go modules own business logic; Python owns training and inference only.
- Every significant architecture decision goes in `docs/adr/`.
- Never log raw GPS coordinates, health content or financial details.

## Roadmap

M1 Platform → M2 Assistant → M3 Mobility → M4 Health → M5 Finance → M6 Work → M7 Cross-module intelligence → M8 Release

See `docs/architecture/` for the full blueprint and module boundaries.
