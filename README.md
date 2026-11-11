# NEXORA — Intelligent Life & Urban Mobility Platform

**Status:** **Mobility Module Complete (M3+ Digital Twin Milestone)** · Deployed live on AWS Free-Tier (`https://43.205.135.43.sslip.io/api/v1`)

NEXORA is a multi-module personal intelligence super-app built as a Go modular monolith + independent Python ML service + React Native/Expo mobile & web client. Its flagship **Move (MoveSmart)** engine delivers end-to-end multimodal navigation, real-time hazard & event-aware intelligence, open-source Overpass POI telemetry, pre/during/post-trip automation, and a **12-Pillar City Movement Digital Twin**.

---

## Core Modules & Capabilities

| Module | Status | Key Capabilities |
|---|---|---|
| **Move (MoveSmart)** | **Complete** | Multimodal journey planning (`Car`, `2-Wheeler`, `Metro`, `2W + Metro`, `Bus`), dynamic departure optimization, Rapido-style fullscreen navigation dock, live Overpass fuel/EV/speed-cam POIs, meaningful hysteresis-filtered reroutes, post-trip time-saved insights, 5 Core ML Pillars, 12 City Digital Twin & Privacy Pillars |
| **Assistant (Copilot)** | Active | Multilingual NLU + RAG (`English`, `తెలుగు`, `हिन्दी`), GPS-aware proactive corridor briefings, explainable route reasoning (`✨ Why?`) |
| **Platform Core** | Active | Identity, JWT/dev auth, DynamoDB/Postgres persistence, Redis cache, AWS SNS/SQS event pipeline |
| **Health / Finance / Work** | Foundation | Schema & module hub scaffolding ready for M4–M6 |

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Mobile & Web** | React Native `0.88.1` + Expo (`~58`) + TypeScript + TanStack Query + React Native Web |
| **Backend API** | Go (`Chi` router, `pgxpool`, structured `slog`, Redis read-through cache, DynamoDB docstore) |
| **ML & Digital Twin** | Python + FastAPI + Uvicorn (ST-GNN congestion, H3 HDBSCAN hotspots, TFT demand, Road Memory Bayesian quorum, Laplace DP k-anonymity, Urban What-If Simulator) |
| **Database** | PostgreSQL 16 + PostGIS (`0001`–`0005` migrations) + AWS DynamoDB |
| **Open Data APIs** | OpenStreetMap Overpass API (Fuel stations, EV chargers, Speed cameras) & Nominatim Geocoding |
| **Cloud Infra** | AWS CloudFormation (EC2, RDS PostgreSQL, ECR, S3, SNS, SQS, DynamoDB, SSM, Caddy Auto-HTTPS via `sslip.io`) |

---

## Repository Structure

```text
apps/mobile/                Expo React Native + Web app (Home, Explore, AI Copilot, Activity Radar, Move HUD)
platform/api/               Go control-plane API, mobility engine, ranking, POIs, digital twin handlers, SQL migrations
intelligence/ml-platform/   Python FastAPI ML service (traffic, ETA, hotspots, vision, assistant, digital twin, privacy)
contracts/                  OpenAPI (`nexora-v1.yaml`) & JSON event schemas (`contracts/events/`)
infra/aws/                  CloudFormation (`template.yaml`), production Compose (`docker-compose.prod.yml`), Caddy & deploy script
scripts/                    One-command AWS deploy & ops CLI (`deploy-aws.sh`)
docs/                       Architecture, ADRs, AWS runbook, and full NEXORA Wiki (`docs/wiki/`)
```

---

## Documentation & Wiki Index

Comprehensive documentation lives in [`docs/wiki/`](docs/wiki/Home.md) (and mirrors to the GitHub Wiki):

1. [**Wiki Home & Mobility Feature Matrix**](docs/wiki/Home.md)
2. [**Mobility Architecture, 5 ML Core & 12 Digital Twin Pillars**](docs/wiki/Mobility-Architecture-and-12-Pillars.md)
3. [**API & PostGIS Database Reference**](docs/wiki/API-and-Database-Reference.md)
4. [**Mobile UX, Rapido Fullscreen Navigation & Visual Components**](docs/wiki/Mobile-UX-and-Navigation.md)
5. [**AWS Production Deployment & Local LAN Runbook**](docs/wiki/Deployment-and-LAN-Runbook.md)

---

## Quick Verification Suite

```bash
# 1. Python ML Platform tests (8 unit tests)
PYTHONPATH=intelligence/ml-platform/src python3 -m unittest discover -s intelligence/ml-platform/tests -v

# 2. Go Mobility & Digital Twin tests (8 integration/unit suites)
go test -C platform/api -v -count=1 ./internal/modules/mobility/...

# 3. Mobile TypeScript check & production Web bundle
npm --prefix apps/mobile run typecheck
EXPO_NO_TELEMETRY=1 npm --prefix apps/mobile run export:web
```

---

## Quick Start (AWS + LAN)

### Deploy Full Stack to AWS
```bash
cp infra/aws/env.aws.example .env.aws   # set DB_PASSWORD
./scripts/deploy-aws.sh deploy          # CloudFormation + ECR build/push + RDS migrate + Caddy HTTPS
./scripts/deploy-aws.sh status          # verify outputs & /api/v1/healthz
```

### Run Mobile / Web Client on Local LAN
```bash
EXPO_NO_TELEMETRY=1 npm --prefix apps/mobile start -- --host lan --port 8081
# Expo Go: exp://<YOUR_LAN_IP>:8081
# Web:     http://<YOUR_LAN_IP>:8081
```
