# NEXORA Wiki — MoveSmart Complete Documentation

Welcome to the **NEXORA** engineering & product wiki. This wiki documents the completed **Mobility (MoveSmart)** platform release spanning **Mobile/Web UX (`apps/mobile`)**, **Go Control Plane (`platform/api`)**, **Python ML & Digital Twin Engine (`intelligence/ml-platform`)**, **PostGIS/RDS Migrations (`0001`–`0005`)**, and **AWS + LAN Deployment**.

---

## Wiki Pages

- **[Mobility Architecture & 12 Digital Twin Pillars](Mobility-Architecture-and-12-Pillars.md)** — Deep technical breakdown of all 5 Core ML Pillars, all 12 City Movement Digital Twin & Privacy Pillars, and Zero-Hardcoding principles.
- **[API & PostGIS Database Reference](API-and-Database-Reference.md)** — Complete Go REST (`/api/v1/move/*`), Python FastAPI (`/v1/*`), OpenStreetMap Overpass/Nominatim, and SQL migration (`0001`–`0005`) catalog.
- **[Mobile UX & Fullscreen Navigation](Mobile-UX-and-Navigation.md)** — Pre/During/Post-trip intelligence, Rapido-style fullscreen navigation cockpit, Quick Actions, Live Radar Digital Twin lens, Urban What-If Simulator, and Multilingual Copilot.
- **[AWS Production & LAN Deployment Runbook](Deployment-and-LAN-Runbook.md)** — CloudFormation + ECR + RDS + Caddy HTTPS deployment, Expo LAN serving, and test verification suite.

---

## Mobility Feature Completion Matrix

### A. Advance Commute & Travel Intelligence
| Feature | Implementation | Status |
|---|---|---|
| **Before Travel: Dynamic Departure Optimizer** | `POST /move/departures/recommend` + [`DepartureOptimizerCard.tsx`](../../apps/mobile/src/features/move/components/DepartureOptimizerCard.tsx) evaluates peak congestion curves & `arrival_by` deadline | Complete |
| **During Travel: Meaningful Route Changes** | Anti-spam hysteresis filter (`MeaningfulRouteChange` + `suppressed_minor_count`) avoids noisy minor flip-flops | Complete |
| **After Travel: Time Saved & Insights** | `TripSummary` + [`PostTripSummaryCard.tsx`](../../apps/mobile/src/features/move/components/PostTripSummaryCard.tsx) + feedback loop | Complete |
| **Explainable AI (`✨ Why?`)** | `ExplainableRoutePanel` + `/move/assistant/query` returns factorized impact weights & natural-language rationales | Complete |
| **Route Comparison & Multi-Objective Ranking** | [`RouteComparisonMatrix.tsx`](../../apps/mobile/src/features/move/components/RouteComparisonMatrix.tsx) + [`ranking.go`](../../platform/api/internal/modules/mobility/ranking.go) across time, reliability, cost, walk & safety | Complete |
| **ETA Confidence Intervals (`P50/P80/P90`)** | Quantile intervals (`low_seconds`, `median_seconds`, `high_seconds`, `confidence_pct`, `certainty_label`) | Complete |
| **Traffic Anomaly & Event-Aware Routing** | Zero-hardcoding dynamic event engine + speed z-score / corridor deviation anomaly detection | Complete |
| **Live Open-Source POIs** | [`pois.go`](../../platform/api/internal/modules/mobility/pois.go) + OpenStreetMap Overpass API (`fuel`, `charging_station`, `speed_camera`) with fuel-type & EV connector parsing | Complete |
| **Rapido-Style Fullscreen Navigation Map** | Expand/collapse fullscreen map overlay with floating speed HUD, Quick Actions (`Fuel`, `EV`, `Speed Cams`, `Avoid Highway`), and expandable bottom cockpit | Complete |

### B. 12 City Movement Digital Twin, Safety, Simulation & Privacy Pillars
| # | Pillar | Core Module(s) | Status |
|---|---|---|---|
| 1 | **City Movement Digital Twin** | [`city_digital_twin.py`](../../intelligence/ml-platform/src/nexora/models/city_digital_twin.py), [`digital_twin.go`](../../platform/api/internal/modules/mobility/digital_twin.go) | Complete |
| 2 | **Cross-Domain Movement Intelligence** | Humans × Vehicles × Animals coupling tensor (`GET /move/digital-twin/state`) | Complete |
| 3 | **Predictive Crowd Intelligence** | +15m / +30m / +60m H3 density & bottleneck forecasting (`GET /move/crowd/predict`) | Complete |
| 4 | **Animal-Vehicle Conflict Prediction** | Twilight factor × speed × sightings spatial risk (`GET /move/safety/animal-conflict`, `POST /move/safety/animal-sighting`) | Complete |
| 5 | **Pedestrian Safety Intelligence** | Lighting × corridor speed × hazard × weather scoring `A–D` (`GET /move/safety/pedestrian`) | Complete |
| 6 | **Spatiotemporal Prediction Engine** | H3 hex indexing + diurnal/weather forecast horizoning | Complete |
| 7 | **Autonomous Mobility Agent** | Proactive cross-domain corridor brief (`GET /move/assistant/proactive-brief` & Assistant/Home cards) | Complete |
| 8 | **Dynamic Multimodal Optimization** | Safety-weighted multimodal ranking factoring pedestrian safety, animal risk & road memory in `PlanJourney` | Complete |
| 9 | **Traffic Anomaly Detection** | `POST /v1/traffic/anomalies` & `GET /move/traffic/anomalies` linked with digital twin alerts | Complete |
| 10 | **Urban What-If Simulation** | Counterfactual simulator for `car_free_zone`, `signal_retime`, `transit_boost`, `speed_calming`, `bus_lane` (`POST /move/digital-twin/simulate`) | Complete |
| 11 | **Road Memory Network** | Bayesian quorum confidence reinforcement & exponential half-life decay (`POST /move/road-memory/observe`, `GET /move/road-memory/corridor`) | Complete |
| 12 | **Privacy-Preserving Crowd Intelligence** | PII stripping, salted ephemeral cohorts, k-anonymity cell suppression (`k >= k_min`), Laplace DP noise (`POST /move/privacy/telemetry`) | Complete |
