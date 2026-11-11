# Mobility Architecture & 12 Digital Twin Pillars

NEXORA separates **business orchestration & persistence (Go)** from **spatiotemporal ML inference & simulation (Python FastAPI)** behind resilient circuit-safe HTTP contracts with deterministic mathematical fallbacks.

```text
+---------------------------+        HTTPS (Caddy)        +-------------------------------+
|  Expo React Native / Web  | --------------------------> |   Go Modular Monolith (:8080) |
|  (apps/mobile)            |                             |   internal/modules/mobility   |
|  - Fullscreen Nav Canvas  |   Direct OSM Overpass fallback   - PlanJourney / Ranking       |
|  - DigitalTwinOverviewCard|   Nominatim / Overpass      |   - Overpass POIs / Geocode   |
|  - UrbanSimulatorCard     |                             |   - Digital Twin + Privacy Go |
+---------------------------+                             +---------------+---------------+
                                                                          |
                                     +------------------------------------+------------------------------------+
                                     v                                    v                                    v
                       +---------------------------+        +---------------------------+        +---------------------------+
                       | RDS PostgreSQL + PostGIS  |        | Redis Read-Through Cache  |        | Python ML Brain (:8000)   |
                       | Migrations 0001 -> 0005   |        | L1 + Redis                |        | FastAPI (nexora-ml)       |
                       +---------------------------+        +---------------------------+        +---------------------------+
```

---

## Zero-Hardcoding Design Principle

Production code in **Python (`intelligence/ml-platform/src`)**, **Go (`platform/api/internal`)**, and **Mobile (`apps/mobile/src`)** contains **zero hardcoded city coordinates, landmark fixtures, or corridor stubs**:
- Spatial cells (`H3` / quantized lat-lon grids) are computed purely from live GPS telemetry or request bounds.
- Diurnal congestion and twilight factors are evaluated dynamically from timestamps.
- POIs (fuel stations, EV chargers, speed cameras) are fetched dynamically from OpenStreetMap Overpass around the active viewport.
- City events start empty by default and are injected/registered dynamically via `/v1/events/city/register` or derived from spatial/temporal anomaly telemetry.
- All mock coordinates and sample corridors exist strictly inside unit & integration test suites (`test_intelligence.py`, `mobility_test.go`).

---

## The 12 City Movement Intelligence Pillars

### 1. City Movement Digital Twin
Models each urban H3 cell (`h3r8_*`) as an interconnected state vector combining road speed, crowd pressure, transit load, pedestrian vulnerability, wildlife sightings, and verified road memory nodes (`mobility.digital_twin_nodes`, `mobility.digital_twin_edges`).

### 2. Cross-Domain Movement Intelligence
Couples three movement agents simultaneously:
- `human_crowd_density`
- `vehicle_congestion_index`
- `animal_conflict_index`

Computes `coupling_risk_score` and classifies the `dominant_interaction` (e.g., `balanced_multimodal_flow`, `pedestrian_transit_surge`, `wildlife_verge_interaction`).

### 3. Predictive Crowd Intelligence
Projects crowd buildup across `+15m`, `+30m`, and `+60m` horizons (`POST /v1/crowd/predict`, `GET /move/crowd/predict`), flagging bottleneck risk (`low`, `moderate`, `high`) and mitigation guidance before stations/concoursecrowd up.

### 4. Animal-Vehicle Conflict Prediction
Combines crowdsourced/sensor animal sightings (`POST /move/safety/animal-sighting`) stored in `mobility.animal_conflict_zones` with **twilight/nocturnal activity weighting** (`twilight_factor`), corridor vehicle speeds, and adverse weather visibility penalties (`GET /move/safety/animal-conflict`).

### 5. Pedestrian Safety Intelligence
Evaluates walkability & crossing safety on a `0–100` scale mapped to safety grades **`A`–`D`** using:
- Adjacent vehicle speed risk (`avg_vehicle_speed_kph`)
- Time-of-day ambient lighting index (`lighting_index`)
- Crowd crushing / curb spillover factor
- Nearby active road hazards (`mobility.road_hazards`)
- Weather visibility penalty (`rain`, `fog`)

### 6. Spatiotemporal Prediction Engine
Every spatial forecast (crowd, pedestrian safety, demand, hotspots, road memory) indexes coordinates into H3-compatible spatial bins paired with time-bucketed horizons persisted cleanly in PostGIS.

### 7. Autonomous Mobility Agent
Synthesizes real-time telemetry across the Digital Twin, active traffic anomalies, city events, and Privacy Shield counters into an immediately actionable proactive briefing (`GET /move/assistant/proactive-brief` / `POST /v1/assistant/proactive-brief`) surfaced on the Home card and Copilot header.

### 8. Dynamic Multimodal Optimization
[`PlanJourney`](../../platform/api/internal/modules/mobility/mobility.go) and [`rankScoredRoutes`](../../platform/api/internal/modules/mobility/ranking.go) score `two_wheeler`, `car`, `metro`, `multimodal`, `bus`, and `walk` candidates across normalized criteria:
- Travel duration (`P50` + shadow ML models + `P50/P80/P90` CI bounds)
- Arrival reliability breakdown
- Estimated INR cost & `CO₂` footprint
- Walking minutes (`max_walking_minutes` constraint)
- Corridor safety (`pedestrian_safety_score`, `animal_conflict_risk`, and verified Road Memory advisories)

### 9. Traffic Anomaly Detection
Detects emerging corridor speed drops, surge spillovers, and sudden reliability degradation (`GET /move/traffic/anomalies`), surfacing only high-signal changes with anti-spam hysteresis during navigation.

### 10. Urban What-If Simulation
Counterfactual policy simulator (`POST /move/digital-twin/simulate`) evaluating interventions at tunable `intensity_pct` (`0–100%`):
- `car_free_zone`: Maximum pedestrian safety lift & `CO₂` cut
- `signal_retime`: Adaptive green-wave intersection queue relief
- `transit_boost`: Mode-shift speed & crowd relief
- `speed_calming`: Kinetic conflict energy reduction for pedestrians & animals
- `bus_lane`: Dedicated corridor headway stabilization

Returns `baseline_metrics`, `projected_metrics`, and exact deltas (`speed_delta_kph`, `crowd_delta_pct`, `pedestrian_safety_delta`, `animal_conflict_delta`, `co2_reduction_pct`), persisted to `mobility.urban_simulations`.

### 11. Road Memory Network
Persistent, self-healing knowledge graph of physical road conditions (`waterlogging`, `pothole`, `damaged_road`, `blocked_lane`, etc.):
- **Bayesian Confidence Reinforcement**: Independent observations reinforce node confidence toward `0.99`; nodes reach `quorum_verified = true` at quorum (`>= 2` observations).
- **Exponential Half-Life Decay**: Stale reports decay smoothly over time unless corroborated.
- **Vision-Linked**: Camera hazard detections via `/v1/vision/road-hazards` automatically reinforce the spatial Road Memory node.

### 12. Privacy-Preserving Crowd Intelligence
Enforces privacy-by-construction before spatial aggregation leaves ingestion (`POST /move/privacy/telemetry`, `POST /v1/privacy/aggregate`):
1. **PII Stripping**: Drops persistent device/user identifiers; hashes ephemeral tokens with 15-minute rotating epoch salts.
2. **k-Anonymity Thresholding**: Spatial cells containing fewer than `k_min` distinct ephemeral devices are **suppressed** and never published (`suppressed_count`).
3. **Laplace Differential Privacy**: Remaining cell counts receive zero-mean Laplace noise calibrated cleanly to privacy budget `epsilon`.
