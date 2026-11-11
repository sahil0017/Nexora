# Mobile UX & Navigation Experience (`apps/mobile`)

The Expo React Native (`0.88.1`) + Web client follows the **NEXORA Obsidian + Electric Navigation Blue + Emerald Telemetry** design tokens ([`tokens.ts`](../../apps/mobile/src/app/theme/tokens.ts)).

---

## Screen-by-Screen Feature Walkthrough

### 1. Journey Planner & Fullscreen Driving HUD (`JourneyPlannerScreen.tsx` + `NavMapCanvas.tsx`)
- **Pre-Travel Departure Optimizer ([`DepartureOptimizerCard.tsx`](../../apps/mobile/src/features/move/components/DepartureOptimizerCard.tsx))**: Evaluates upcoming 15-minute slots across peak congestion curves and predicts time saved by shifting departure.
- **Route Comparison & Multi-Objective Matrix ([`RouteComparisonMatrix.tsx`](../../apps/mobile/src/features/move/components/RouteComparisonMatrix.tsx))**: Compares `2-Wheeler`, `Car`, `Metro`, `2W + Metro`, and `Bus` across duration, `P50/P90` CI range, cost (`₹`), reliability %, CO₂ grams, and corridor walk safety score (`0–100`).
- **Explainable AI (`✨ Why?`) ([`ExplainableRoutePanel.tsx`](../../apps/mobile/src/features/move/components/ExplainableRoutePanel.tsx))**: Inline rationale factors explaining why a candidate route won ranking.
- **Rapido-Style Fullscreen Navigation Map**:
  - Dedicated expand/collapse fullscreen map toggle right on the navigation canvas.
  - Floating live speed pill, zoom/recenter controls, bottom-left Quick Actions sheet (`Fuel`, `EV`, `Speed Cams`, `Traffic`) backed by live OpenStreetMap Overpass POIs (rendering brand, fuel types like Petrol/Diesel/CNG, EV connector sockets like CCS2/Type 2 & bays, distance, and opening hours — zero hardcoded POI coordinates).
  - Compact draggable/expandable bottom cockpit displaying ETA countdown, hysteresis-filtered **Meaningful Route Changes**, and `End Trip`.
- **Post-Trip Summary ([`PostTripSummaryCard.tsx`](../../apps/mobile/src/features/move/components/PostTripSummaryCard.tsx))**: Actual vs baseline duration, minutes saved, CO₂ saved, estimated trip cost, actionable insights, and feedback rating.

### 2. Live Radar & Digital Twin Hub ([`ActivityScreen.tsx`](../../apps/mobile/src/features/activity/screens/ActivityScreen.tsx))
Lenses: **`Overview` | `Digital Twin` | `Traffic & H3` | `Transit` | `Hazards`**
- **[`DigitalTwinOverviewCard.tsx`](../../apps/mobile/src/features/move/components/DigitalTwinOverviewCard.tsx)**:
  - **System Health Index** + dominant cross-domain interaction label
  - **Cross-Domain Meters**: `Humans & Crowd`, `Vehicle Load`, `Animal Conflict`
  - **Predictive Crowd Horizons**: `+15m`, `+30m`, `+60m` bottleneck cards
  - **Pedestrian Safety (`A–D`)** & **Animal Conflict** panels + 1-tap **`Report Animal Crossing`**
  - **Road Memory Network**: Displays active quorum-verified nodes + 1-tap **`+ Log Waterlogging`** / **`+ Log Pothole`** reinforcement chips
  - **Privacy Shield Status**: Live `k`-anonymity threshold, Laplace `ε` budget, published vs suppressed cell counters
- **[`UrbanSimulatorCard.tsx`](../../apps/mobile/src/features/move/components/UrbanSimulatorCard.tsx)**:
  - Interactive intervention selector (`Signal Retime`, `Car-Free Zone`, `Transit Boost`, `Speed Calming`, `Bus Lane`), strength chips (`20%`–`75%`), **`Run Urban Simulation`** CTA, and before/after delta tiles (`Corridor Speed Δ`, `Walk Safety Δ`, `Crowd Load Δ`, `CO₂ Cut`).

### 3. Home Launcher ([`HomeScreen.tsx`](../../apps/mobile/src/features/home/screens/HomeScreen.tsx))
- Displays live Autonomous Mobility Agent proactive corridor brief headline, traffic speed, hazard alerts, Digital Twin shortcut, and quick-launch Copilot prompts.

### 4. Multilingual AI Copilot ([`AssistantScreen.tsx`](../../apps/mobile/src/features/assistant/screens/AssistantScreen.tsx))
- **Proactive Corridor Brief Banner**: Surfaces live cross-domain health/safety status above chat when GPS context is enabled.
- **Quick Prompt Chips**: `✨ Why this route?`, `🌐 City Twin Brief`, `🛡 Safety & Memory`, plus `English`, `తెలుగు`, and `हिन्दी` prompts with structured factorized explainability cards and expandable RAG context chunks.
