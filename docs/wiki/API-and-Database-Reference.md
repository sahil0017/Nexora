# API & PostGIS Database Reference

All Go API routes are mounted under **`/api/v1`** (live production base: `https://43.205.135.43.sslip.io/api/v1`).

---

## 1. Go Control Plane Endpoints (`/api/v1/move/*`)

### Journey Planning, Navigation & Personalization
| Method | Path | Description |
|---|---|---|
| `POST` | `/move/journeys/plan` | Multimodal route planner + ML shadow eval + reliability, CI, safety & road memory advisories |
| `POST` | `/move/departures/recommend` | Dynamic departure slot optimizer vs `arrival_by` deadline |
| `GET` / `PATCH` | `/move/profile` | User mobility profile, preferred mode & multi-objective weights |
| `GET` / `POST` | `/move/places` | Saved home/work/custom places |
| `GET` | `/move/places/search` | Dynamic Nominatim geocoding search |
| `POST` | `/move/trips` | Start active navigation trip |
| `GET` | `/move/trips/{id}` | Get trip details & summary |
| `POST` | `/move/trips/{id}/locations:batch` | Batch GPS telemetry upload |
| `GET` | `/move/trips/{id}/updates` | Live ETA, remaining distance & hysteresis-filtered `MeaningfulRouteChange` |
| `POST` | `/move/trips/{id}/complete` | Complete trip & compute time saved, CO₂ saved, insights |
| `GET` | `/move/insights/commute` | User historical commute analytics & peak avoidance % |
| `POST` | `/move/feedback` | Post-trip accuracy rating & outcome feedback |

### Traffic, POIs, Transit & 5-Core ML Endpoints
| Method | Path | Description |
|---|---|---|
| `GET` | `/move/traffic/segments` | Live road segment speeds & congestion levels |
| `GET` | `/move/traffic/predictions` | ST-GNN / DCRNN horizon speed forecasts |
| `GET` | `/move/traffic/anomalies` | Real-time corridor congestion anomaly detection |
| `GET` | `/move/events/active` | Active dynamically registered city mobility events |
| `GET` | `/move/pois/nearby` | Live OpenStreetMap Overpass POIs (`fuel`, `ev`, `cam`) with fuel types & charger sockets |
| `GET` | `/move/transit/stops/nearby` | Nearby bus & metro stops |
| `GET` | `/move/transit/departures` | Live/scheduled transit departures |
| `POST` | `/move/demand/predict` | Spatiotemporal mobility demand & surge pressure |
| `POST` | `/move/hotspots` | H3 + HDBSCAN spatial congestion hotspot clustering |
| `POST` | `/move/hazards/report` | Report road hazard (reinforces Road Memory) |
| `GET` | `/move/hazards/nearby` | Active road hazards within corridor radius |
| `POST` | `/move/assistant/query` | Multilingual (`en`, `te`, `hi`) Copilot query with explainability factors |
| `GET` | `/move/stack/libraries` | Active ML/OSS stack inventory |
| `GET` | `/move/intelligence/status` | Live health & online learner status of `nexora-ml` |

### 12-Pillar Digital Twin, Safety, Road Memory & Privacy Endpoints
| Method | Path | Handler (`digital_twin.go`) | Description |
|---|---|---|---|
| `GET` | `/move/digital-twin/state` | `GetDigitalTwinState` | Unified H3 cross-domain state (crowd, vehicles, animal risk, walk safety, road memory, health index) |
| `POST` | `/move/digital-twin/simulate` | `SimulateUrbanIntervention` | Counterfactual Urban What-If simulation (`car_free_zone`, `signal_retime`, `transit_boost`, `speed_calming`, `bus_lane`) |
| `GET` | `/move/crowd/predict` | `GetCrowdForecast` | +15m / +30m / +60m predictive crowd density horizons |
| `GET` | `/move/safety/animal-conflict` | `GetAnimalConflict` | Dynamic wildlife/stray conflict probability + mitigation advice |
| `POST` | `/move/safety/animal-sighting` | `ReportAnimalSighting` | Record verified/crowdsourced animal corridor sighting |
| `GET` | `/move/safety/pedestrian` | `GetPedestrianSafety` | Walkability safety score (`0–100`) & grade (`A–D`) |
| `POST` | `/move/road-memory/observe` | `ObserveRoadMemory` | Reinforce persistent road condition memory node & quorum |
| `GET` | `/move/road-memory/corridor` | `GetRoadMemoryCorridor` | Query active decayed road memory nodes in 5 km radius |
| `POST` | `/move/privacy/telemetry` | `AggregatePrivacyTelemetry` | PII-stripped k-anonymity aggregation + Laplace DP noise |
| `GET` | `/move/privacy/status` | `GetPrivacyStatus` | Privacy Shield telemetry budget, published & suppressed cell counts |
| `GET` | `/move/assistant/proactive-brief` | `GetProactiveBrief` | Autonomous Mobility Agent proactive corridor brief |

---

## 2. Python ML FastAPI Endpoints (`intelligence/ml-platform/src/nexora/inference/api.py`)

Internal service endpoints (`http://ml:8000`):
- `GET /healthz`, `GET /v1/stack/libraries`
- `POST /v1/predict/traffic`, `POST /v1/traffic/anomalies`
- `GET /v1/events/city`, `POST /v1/events/city/register`
- `POST /v1/predict/journey`, `POST /v1/predict/journey/batch`
- `POST /v1/hotspots/discover`, `POST /v1/predict/demand`, `POST /v1/vision/road-hazards`
- `POST /v1/digital-twin/state`, `POST /v1/digital-twin/simulate`, `POST /v1/crowd/predict`
- `POST /v1/safety/animal-conflict`, `POST /v1/safety/animal-sighting`, `POST /v1/safety/pedestrian`
- `POST /v1/road-memory/observe`, `GET /v1/road-memory/corridor`
- `POST /v1/privacy/aggregate`, `GET /v1/privacy/status`
- `POST /v1/assistant/proactive-brief`, `POST /v1/assistant/query`
- `POST /v1/events/ingest`, `GET /v1/events/status`

---

## 3. PostgreSQL / PostGIS Schema Migrations (`platform/api/migrations/`)

| Migration | Scope | Tables Created |
|---|---|---|
| `0001_initial_schema` | Multi-module core schemas (`identity`, `platform`, `intelligence`, `mobility`, `health`, `finance`, `work`, `audit`) | `users`, `user_sessions`, `profiles`, `conversations`, `messages`, `trips`, `trip_legs`, `route_options`, `location_samples`, `road_segments`, `traffic_observations`, `traffic_predictions`, `transit_*`, `trip_feedback`, etc. |
| `0002_mobility_feature1` | Mobility personalization, outbox & transit realtime | `platform.event_outbox`, `platform.processed_events`, `mobility.cities`, `mobility.profiles`, `mobility.route_preferences`, `mobility.commute_patterns`, `mobility.route_segments`, `mobility.route_predictions`, `mobility.transit_realtime_observations` |
| `0003_mobility_intelligence` | Spatial H3 cells, demand & road hazards | `mobility.spatial_cells`, `mobility.demand_forecasts`, `mobility.road_hazards` |
| `0004_seed_default_user` | Default demo identity seed | Default user seed (`migration` idempotent) |
| `0005_city_movement_intelligence` | 12-Pillar City Digital Twin, Safety, Simulation, Road Memory & Privacy | `mobility.digital_twin_nodes`, `mobility.digital_twin_edges`, `mobility.crowd_forecasts`, `mobility.animal_conflict_zones`, `mobility.pedestrian_safety_cells`, `mobility.urban_simulations`, `mobility.road_memory_nodes`, `mobility.privacy_aggregated_flows` |
