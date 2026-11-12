"""NEXORA Intelligence Service (FastAPI).

Implements the 5 Mobility Intelligence Pillars + AWS SQS Event Consumer + 6 Engineering Library Layers:
  1. Traffic prediction (STGCN / DCRNN + LightGBM/XGBoost + River online EWMA)
  2. ETA & route intelligence (CatBoost / LightGBM quantile ETA + H3/HDBSCAN hotspot discovery)
  3. Mobility demand prediction (TFT / Prophet Fourier seasonality / XGBoost)
  4. Road intelligence / computer vision (YOLO / RT-DETR / MobileNet hazard detection)
  5. Multilingual Mobility AI Assistant (Qwen3 / Whisper / BGE-M3 / MiniLM reranker — EN/TE/HI)
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import time
from typing import Any

from fastapi import FastAPI, HTTPException

from nexora.assistant.mobility_agent import MobilityAIAssistant
from nexora.events.sqs_worker import OnlineIntelligenceState, run_sqs_consumer_loop
from nexora.finance.engine import FinanceIntelligenceNetwork
from nexora.geospatial.h3_grid import clean_trajectory, discover_hotspots
from nexora.models.city_digital_twin import CityMovementDigitalTwin, RoadMemoryNetwork
from nexora.models.demand_forecaster import MobilityDemandForecaster
from nexora.models.eta_engine import JourneyETAEngine
from nexora.models.event_intelligence import EventIntelligenceEngine
from nexora.models.privacy_intelligence import PrivacyPreservingCrowdAggregator
from nexora.models.traffic_forecaster import SpatioTemporalTrafficForecaster
from nexora.vision.road_inspector import RoadVisionInspector
from nexora.voice.engine import VoiceIntelligenceNetwork
from nexora.deep_learning import hub

traffic_model = SpatioTemporalTrafficForecaster()
demand_model = MobilityDemandForecaster()
event_engine = EventIntelligenceEngine()
road_memory = RoadMemoryNetwork()
digital_twin = CityMovementDigitalTwin(road_memory=road_memory)
privacy_aggregator = PrivacyPreservingCrowdAggregator(k_min=5, epsilon=0.5)
eta_model = JourneyETAEngine(traffic_model)
vision_model = RoadVisionInspector()
assistant_model = MobilityAIAssistant()
finance_network = FinanceIntelligenceNetwork()
voice_network = VoiceIntelligenceNetwork()
online_state = OnlineIntelligenceState(traffic=traffic_model, demand=demand_model)

# Event-versioned 30s TTL cache for high-frequency spatial/traffic inference
_PREDICTION_CACHE: dict[tuple[Any, ...], dict[str, Any]] = {}


def _cache_get(key: tuple[Any, ...]) -> dict[str, Any] | None:
    if len(_PREDICTION_CACHE) > 512:
        _PREDICTION_CACHE.clear()
    return _PREDICTION_CACHE.get(key)


def _cache_set(key: tuple[Any, ...], value: dict[str, Any]) -> dict[str, Any]:
    _PREDICTION_CACHE[key] = value
    return value

_ENGINEERING_LIBRARIES = {
    "routing": [
        {"name": "Valhalla", "license": "MIT", "role": "Dynamic costing, multimodal routing, isochrones, map matching"},
        {"name": "GraphHopper", "license": "Apache-2.0", "role": "Alternative routes, car/bike/foot profiles, map matching"},
        {"name": "OSRM", "license": "BSD-2-Clause", "role": "High-throughput road routing and distance matrices"},
    ],
    "geospatial_processing": [
        {"name": "H3", "license": "Apache-2.0", "role": "Hexagonal spatial indexing for demand and congestion cells"},
        {"name": "OSMnx", "license": "MIT", "role": "OpenStreetMap road graph extraction and topology analysis"},
        {"name": "GeoPandas", "license": "BSD-3-Clause", "role": "Spatial joins, boundary clipping, and corridor analytics"},
        {"name": "MovingPandas", "license": "BSD-3-Clause", "role": "GPS trajectory smoothing, stop detection, trip segmentation"},
    ],
    "traffic_ml": [
        {"name": "LibCity", "license": "Apache-2.0", "role": "Benchmarking STGCN, DCRNN, Graph WaveNet traffic models"},
        {"name": "PyTorch Geometric Temporal", "license": "MIT", "role": "Spatio-temporal graph neural network layers"},
        {"name": "LightGBM", "license": "MIT", "role": "Fast tabular ETA regression and congestion baselines"},
        {"name": "CatBoost", "license": "Apache-2.0", "role": "Multi-quantile travel-time prediction (p50/p80/p90)"},
        {"name": "Darts", "license": "Apache-2.0", "role": "Temporal Fusion Transformer (TFT) and Prophet demand series"},
        {"name": "River", "license": "BSD-3-Clause", "role": "Online incremental learning from live traffic observations"},
    ],
    "mobility_analytics_simulation": [
        {"name": "HDBSCAN", "license": "BSD-3-Clause", "role": "Density-based traffic congestion & hotspot discovery"},
        {"name": "Eclipse SUMO", "license": "EPL-2.0", "role": "Microscopic vehicle, signal, and closure simulation"},
        {"name": "MATSim", "license": "GPL-2.0", "role": "Agent-based city-scale transport demand simulation"},
    ],
    "computer_vision": [
        {"name": "RT-DETR / YOLO", "license": "Apache-2.0 / AGPL-3.0", "role": "Real-time pothole, blocked-lane, and hazard detection"},
        {"name": "MobileNetV3", "license": "Apache-2.0", "role": "Lightweight road surface & hazard severity classification"},
        {"name": "OpenCV", "license": "Apache-2.0", "role": "Frame preprocessing and perspective normalization"},
        {"name": "PaddleOCR", "license": "Apache-2.0", "role": "Road sign and transit board text extraction"},
        {"name": "FiftyOne", "license": "Apache-2.0", "role": "Road dataset curation and false-positive auditing"},
    ],
    "ai_agents": [
        {"name": "Qwen3 (via Ollama / vLLM / llama.cpp)", "license": "Apache-2.0", "role": "Multilingual EN/TE/HI conversational mobility reasoning"},
        {"name": "Whisper", "license": "MIT", "role": "Multilingual voice query transcription"},
        {"name": "BGE-M3", "license": "MIT", "role": "Cross-lingual dense + lexical semantic embeddings"},
        {"name": "Multilingual MiniLM Reranker", "license": "Apache-2.0", "role": "Cross-encoder context reranking for RAG"},
        {"name": "LangGraph / Haystack", "license": "MIT / Apache-2.0", "role": "Stateful tool-calling mobility agent workflows"},
        {"name": "ONNX Runtime", "license": "MIT", "role": "Low-latency CPU/GPU inference for CV and tabular models"},
    ],
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop_event = asyncio.Event()
    task = asyncio.create_task(run_sqs_consumer_loop(online_state, stop_event))
    try:
        yield
    finally:
        stop_event.set()
        task.cancel()


app = FastAPI(
    title="NEXORA Intelligence Service",
    version="0.2.0",
    description="5-pillar mobility intelligence (STGCN/DCRNN, CatBoost/LightGBM ETA, TFT/Prophet demand, RT-DETR/MobileNet road CV, Qwen3/BGE-M3 multilingual assistant) + AWS SQS event worker.",
    lifespan=lifespan,
)


@app.get("/healthz")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "nexora-ml",
        "version": "0.2.0",
        "models": {
            "traffic": traffic_model.model_version,
            "eta": eta_model.model_version,
            "demand": demand_model.model_version,
            "vision": vision_model.model_version,
            "assistant": assistant_model.model_version,
        },
        "events_processed": online_state.events_processed,
    }


@app.get("/v1/stack/libraries")
def list_engineering_libraries() -> dict[str, Any]:
    """Return the 6-layer open-source mobility intelligence stack catalog."""
    return {"layers": _ENGINEERING_LIBRARIES}


@app.post("/v1/predict/traffic")
def predict_traffic(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 1: STGCN/DCRNN + GBDT segment speed forecasts (15/30/60/120 min horizons)."""
    segment_ids = [str(s) for s in body.get("segment_ids", []) if str(s).strip()]
    weather = str(body.get("weather", "clear"))
    adjacency = body.get("adjacency") if isinstance(body.get("adjacency"), dict) else None
    cache_key = ("traffic", tuple(segment_ids), weather, online_state.events_processed, int(time.time() // 30))
    if adjacency is None and (cached := _cache_get(cache_key)) is not None:
        return cached
    predictions = traffic_model.predict_segments(segment_ids, weather=weather, adjacency=adjacency)
    return _cache_set(
        cache_key,
        {
            "predictions": predictions,
            "model_version": traffic_model.model_version,
        },
    )


@app.post("/v1/traffic/anomalies")
def traffic_anomalies(body: dict[str, Any]) -> dict[str, Any]:
    """Detect real-time traffic anomalies across segments via EWMA z-score and speed drop."""
    observed_keys = list(traffic_model._last_speeds.keys()) if hasattr(traffic_model, "_last_speeds") else []
    segment_ids = [str(s) for s in body.get("segment_ids", []) if str(s).strip()] or observed_keys or ["corridor-primary"]
    weather = str(body.get("weather", "clear"))
    anomalies = traffic_model.detect_anomalies(segment_ids, weather=weather)
    active_count = sum(1 for a in anomalies if a["is_anomaly"])
    return {
        "anomalies": anomalies,
        "active_anomaly_count": active_count,
        "model_version": traffic_model.model_version,
    }


@app.get("/v1/events/city")
def list_city_events(lat: float | None = None, lon: float | None = None, radius_m: float = 12000.0) -> dict[str, Any]:
    """Return active urban mobility events synthesized from telemetry, venues, and registered alerts."""
    hotspots = online_state.current_hotspots()
    observed_keys = list(traffic_model._last_speeds.keys()) if hasattr(traffic_model, "_last_speeds") else []
    anomalies = traffic_model.detect_anomalies(observed_keys) if observed_keys else []
    event_engine.sync_from_telemetry(
        hotspots=hotspots,
        anomalies=anomalies,
        fallback_lat=lat,
        fallback_lon=lon,
    )
    events = event_engine.active_events_near(latitude=lat, longitude=lon, radius_m=radius_m)
    return {
        "events": events,
        "model_version": event_engine.model_version,
    }


@app.post("/v1/events/city/register")
def register_city_event(body: dict[str, Any]) -> dict[str, Any]:
    """Register a live urban mobility event for event-aware routing."""
    ev = event_engine.register_event(body)
    return {"event": ev, "model_version": event_engine.model_version}


@app.post("/v1/predict/journey")
def predict_journey(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 2: CatBoost/LightGBM quantile ETA prediction with H3 hotspot, event & hazard awareness."""
    segments = [str(s) for s in body.get("segment_ids", []) if str(s).strip()]
    mode = str(body.get("mode", "car"))
    departure_time = body.get("departure_time")
    distance_m = body.get("distance_meters")
    weather = str(body.get("weather", "clear"))

    hotspots = online_state.current_hotspots()
    max_hotspot = max((h["congestion_score"] for h in hotspots), default=0.0)
    active_hazards = int(body.get("active_hazards", len(online_state.active_hazards)))

    event_mult = float(body.get("event_multiplier", 1.0))
    orig = body.get("origin")
    dest = body.get("destination")
    matched_events: list[dict[str, Any]] = []
    if isinstance(orig, dict) and isinstance(dest, dict) and "latitude" in orig and "latitude" in dest:
        mid_lat = (float(orig["latitude"]) + float(dest["latitude"])) / 2.0
        mid_lon = (float(orig["longitude"]) + float(dest["longitude"])) / 2.0
        anomalies = traffic_model.detect_anomalies(segments, weather=weather) if segments else []
        event_engine.sync_from_telemetry(hotspots=hotspots, anomalies=anomalies, fallback_lat=mid_lat, fallback_lon=mid_lon)
        ev_impact = event_engine.score_corridor_impact(
            float(orig["latitude"]),
            float(orig["longitude"]),
            float(dest["latitude"]),
            float(dest["longitude"]),
            mode=mode,
        )
        event_mult = max(event_mult, ev_impact["event_multiplier"])
        matched_events = ev_impact["events"]

    out = eta_model.predict_journey(
        segment_ids=segments,
        mode=mode,
        departure_time=departure_time,
        distance_meters=float(distance_m) if distance_m is not None else None,
        weather=weather,
        active_hazards=active_hazards,
        hotspot_score=max_hotspot,
        event_multiplier=event_mult,
    )
    out["events"] = matched_events
    return out


@app.post("/v1/predict/journey/batch")
def predict_journey_batch(body: dict[str, Any]) -> dict[str, Any]:
    """Batch multimodal ETA inference — evaluates all candidate modes in a single round-trip."""
    items = body.get("candidates") if isinstance(body.get("candidates"), list) else []
    hotspots = online_state.current_hotspots()
    max_hotspot = max((h["congestion_score"] for h in hotspots), default=0.0)
    active_hazards = len(online_state.active_hazards)

    results: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        segments = [str(s) for s in item.get("segment_ids", []) if str(s).strip()]
        mode = str(item.get("mode", "car"))
        departure_time = item.get("departure_time")
        distance_m = item.get("distance_meters")
        weather = str(item.get("weather", "clear"))
        pred = eta_model.predict_journey(
            segment_ids=segments,
            mode=mode,
            departure_time=departure_time,
            distance_meters=float(distance_m) if distance_m is not None else None,
            weather=weather,
            active_hazards=active_hazards,
            hotspot_score=max_hotspot,
        )
        pred["mode"] = mode
        results.append(pred)
    return {
        "predictions": results,
        "model_version": eta_model.model_version,
    }


@app.post("/v1/hotspots/discover")
def hotspots_discover(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 2 + Layer 2: Clean GPS trajectories (MovingPandas) and cluster H3 hotspots (HDBSCAN)."""
    raw_points = body.get("points")
    points = raw_points if isinstance(raw_points, list) and raw_points else list(online_state.gps_buffer)
    resolution = int(body.get("resolution", 8))
    traj = clean_trajectory(points)
    clusters = discover_hotspots(traj["cleaned"] or points, resolution=resolution)
    return {
        "hotspots": clusters,
        "trajectory_stats": {
            "input_points": len(points),
            "cleaned_points": len(traj["cleaned"]),
            "detected_stops": len(traj["stops"]),
            "outliers_removed": traj["outliers_removed"],
        },
        "model_version": "h3-hdbscan-movingpandas-v1",
    }


@app.post("/v1/predict/demand")
def predict_demand(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 3: TFT / Prophet / XGBoost zone demand & transport availability forecast."""
    cells = body.get("h3_indices") if isinstance(body.get("h3_indices"), list) else None
    lat = body.get("latitude")
    lon = body.get("longitude")
    weather = str(body.get("weather", "clear"))
    rain_mm = float(body.get("rain_mm", 0.0))
    at_time = body.get("at_time")
    return demand_model.predict_demand(
        cells=cells,
        latitude=float(lat) if lat is not None else None,
        longitude=float(lon) if lon is not None else None,
        weather=weather,
        rain_mm=rain_mm,
        at_time=at_time,
    )


@app.post("/v1/vision/road-hazards")
def detect_road_hazards(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 4: YOLO / RT-DETR / MobileNet road hazard detection from image or telemetry."""
    if body.get("latitude") is None or body.get("longitude") is None:
        raise HTTPException(status_code=400, detail="latitude and longitude are required")
    lat = float(body["latitude"])
    lon = float(body["longitude"])
    image_ref = body.get("image_ref") or body.get("image_url")
    hint_type = body.get("hint_type") or body.get("hint_category")
    result = vision_model.inspect(
        latitude=lat,
        longitude=lon,
        image_base64=body.get("image_base64"),
        image_ref=image_ref,
        hint_type=hint_type,
        accelerometer_rms=float(body["accelerometer_rms"]) if body.get("accelerometer_rms") is not None else None,
    )
    online_state.active_hazards.append(result)
    road_memory.observe(
        latitude=lat,
        longitude=lon,
        condition_type=str(result.get("hazard_type", "surface_damage")),
        severity=str(result.get("severity", "medium")),
        confidence_obs=float(result.get("confidence", 0.72)),
    )
    return result


@app.post("/v1/digital-twin/state")
def get_digital_twin_state(body: dict[str, Any]) -> dict[str, Any]:
    """Pillars 1 & 2: City Movement Digital Twin & Cross-Domain Intelligence (Humans, Animals, Vehicles)."""
    lat = float(body.get("latitude", 0.0))
    lon = float(body.get("longitude", 0.0))
    weather = str(body.get("weather", "clear"))
    avg_speed = float(body.get("avg_speed_kph", 30.0))
    events = event_engine.active_events_near(latitude=lat, longitude=lon)
    return digital_twin.build_digital_twin_state(
        latitude=lat,
        longitude=lon,
        avg_speed_kph=avg_speed,
        active_hazards=len(online_state.active_hazards),
        active_events_count=len(events),
        gps_points=list(online_state.gps_buffer),
        weather=weather,
    )


@app.post("/v1/digital-twin/simulate")
def simulate_urban_intervention(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 10: Urban What-If Simulation for interventions (car-free zones, signal retiming, transit boost)."""
    return digital_twin.simulate_what_if(
        latitude=float(body.get("latitude", 0.0)),
        longitude=float(body.get("longitude", 0.0)),
        intervention_type=str(body.get("intervention_type", "signal_retime")),
        intensity_pct=float(body.get("intensity_pct", 25.0)),
        avg_speed_kph=float(body.get("avg_speed_kph", 28.0)),
        crowd_density=float(body.get("crowd_density", 0.55)),
    )


@app.post("/v1/crowd/predict")
def predict_crowd(body: dict[str, Any]) -> dict[str, Any]:
    """Pillars 3 & 6: Predictive Crowd Intelligence across spatiotemporal horizons."""
    lat = float(body.get("latitude", 0.0))
    lon = float(body.get("longitude", 0.0))
    events = event_engine.active_events_near(latitude=lat, longitude=lon)
    return digital_twin.predict_crowd(
        latitude=lat,
        longitude=lon,
        horizons=body.get("horizons") if isinstance(body.get("horizons"), list) else [15, 30, 60],
        gps_points=list(online_state.gps_buffer),
        active_events_count=len(events),
        weather=str(body.get("weather", "clear")),
    )


@app.post("/v1/safety/animal-conflict")
def predict_animal_conflict(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 4: Animal-Vehicle Conflict Prediction."""
    return digital_twin.predict_animal_conflict(
        latitude=float(body.get("latitude", 0.0)),
        longitude=float(body.get("longitude", 0.0)),
        vehicle_speed_kph=float(body.get("vehicle_speed_kph", 40.0)),
        weather=str(body.get("weather", "clear")),
    )


@app.post("/v1/safety/animal-sighting")
def record_animal_sighting(body: dict[str, Any]) -> dict[str, Any]:
    """Ingest reported animal/wildlife movement sighting into the corridor risk model."""
    zone = digital_twin.record_animal_sighting(
        latitude=float(body.get("latitude", 0.0)),
        longitude=float(body.get("longitude", 0.0)),
        species_group=str(body.get("species_group", "stray_cattle")),
        corridor_type=str(body.get("corridor_type", "urban_arterial")),
        severity_hint=str(body.get("severity", "medium")),
    )
    return {"zone": zone, "model_version": digital_twin.model_version}


@app.post("/v1/safety/pedestrian")
def assess_pedestrian_safety(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 5: Pedestrian Safety Intelligence."""
    return digital_twin.assess_pedestrian_safety(
        latitude=float(body.get("latitude", 0.0)),
        longitude=float(body.get("longitude", 0.0)),
        avg_vehicle_speed_kph=float(body.get("avg_vehicle_speed_kph", 34.0)),
        crowd_density=float(body.get("crowd_density", 0.3)),
        active_hazards=int(body.get("active_hazards", len(online_state.active_hazards))),
        weather=str(body.get("weather", "clear")),
    )


@app.post("/v1/road-memory/observe")
def observe_road_memory(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 11: Record or reinforce a persistent Road Memory Network observation."""
    node = road_memory.observe(
        latitude=float(body.get("latitude", 0.0)),
        longitude=float(body.get("longitude", 0.0)),
        condition_type=str(body.get("condition_type", "surface_damage")),
        severity=str(body.get("severity", "medium")),
        segment_id=body.get("segment_id"),
        confidence_obs=float(body.get("confidence", 0.72)),
    )
    return {"node": node, "model_version": road_memory.model_version}


@app.get("/v1/road-memory/corridor")
def query_road_memory(lat: float, lon: float, radius_m: float = 5000.0) -> dict[str, Any]:
    """Pillar 11: Query persistent quorum-verified road memory along corridor."""
    return {
        "nodes": road_memory.query_corridor(lat, lon, radius_m=radius_m),
        "model_version": road_memory.model_version,
    }


@app.post("/v1/privacy/aggregate")
def privacy_aggregate(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 12: K-anonymous + Laplace Differential Privacy crowd flow aggregation."""
    samples = body.get("samples") if isinstance(body.get("samples"), list) else []
    k_min = body.get("k_min")
    epsilon = body.get("epsilon")
    return privacy_aggregator.aggregate_samples(
        samples=samples,
        k_min=int(k_min) if k_min is not None else None,
        epsilon=float(epsilon) if epsilon is not None else None,
    )


@app.get("/v1/privacy/status")
def privacy_status() -> dict[str, Any]:
    return {
        "k_threshold": privacy_aggregator.k_min,
        "epsilon_budget": privacy_aggregator.epsilon,
        "total_pings_processed": privacy_aggregator.total_pings_processed,
        "total_cells_published": privacy_aggregator.total_cells_published,
        "total_cells_suppressed": privacy_aggregator.total_cells_suppressed,
        "model_version": privacy_aggregator.model_version,
    }


@app.post("/v1/assistant/proactive-brief")
def assistant_proactive_brief(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 7: Autonomous Mobility Agent proactive corridor brief."""
    lat = float(body.get("latitude", 0.0))
    lon = float(body.get("longitude", 0.0))
    weather = str(body.get("weather", "clear"))
    events = event_engine.active_events_near(latitude=lat, longitude=lon)
    twin = digital_twin.build_digital_twin_state(
        latitude=lat,
        longitude=lon,
        active_hazards=len(online_state.active_hazards),
        active_events_count=len(events),
        gps_points=list(online_state.gps_buffer),
        weather=weather,
    )
    observed_keys = list(traffic_model._last_speeds.keys()) if hasattr(traffic_model, "_last_speeds") else []
    anomalies = traffic_model.detect_anomalies(observed_keys, weather=weather) if observed_keys else []
    return assistant_model.proactive_brief(
        digital_twin_state=twin,
        anomalies=anomalies,
        active_events=[e for e in events if e.get("active_at_time")],
        privacy_status=privacy_status(),
    )


@app.post("/v1/assistant/query")
def assistant_query(body: dict[str, Any]) -> dict[str, Any]:
    """Pillar 5: Multilingual (EN/TE/HI) Qwen3 + BGE-M3 + MiniLM Reranker mobility assistant."""
    query = str(body.get("query") or body.get("message") or "").strip()
    language = body.get("language")
    ctx_items = body.get("context") if isinstance(body.get("context"), list) else None
    route_context = body.get("route_context") if isinstance(body.get("route_context"), dict) else None
    lat = body.get("latitude")
    lon = body.get("longitude")
    hotspots = online_state.current_hotspots()
    active_events = event_engine.active_events_near(
        latitude=float(lat) if lat is not None else None,
        longitude=float(lon) if lon is not None else None,
    )
    return assistant_model.answer(
        query=query,
        language=language,
        context_items=ctx_items,
        active_hazards=len(online_state.active_hazards),
        hotspots=len(hotspots),
        route_context=route_context,
        active_events=[e for e in active_events if e.get("active_at_time")],
    )


@app.post("/v1/events/ingest")
def ingest_event(body: dict[str, Any]) -> dict[str, Any]:
    """Ingest a single event or batch of events from the Go outbox relay or SNS/SQS bridge."""
    events = body.get("events") if isinstance(body.get("events"), list) else [body]
    accepted = 0
    for ev in events:
        if isinstance(ev, dict) and online_state.handle_event(ev):
            accepted += 1
    return {
        "accepted": accepted,
        "total_events_processed": online_state.events_processed,
    }


@app.get("/v1/events/status")
def events_status() -> dict[str, Any]:
    """Inspect online event consumer state, SQS poll count, and active spatial buffers."""
    return {
        "events_processed": online_state.events_processed,
        "sqs_polls": online_state.sqs_polls,
        "last_event_at": online_state.last_event_at,
        "gps_buffer_size": len(online_state.gps_buffer),
        "active_hazards_count": len(online_state.active_hazards),
        "active_hotspots_count": len(online_state.current_hotspots()),
        "finance_events_count": len(online_state.finance_events),
        "voice_events_count": len(online_state.voice_events),
    }


# =============================================================================
# NEXORA FINANCE INTELLIGENCE NETWORK ENDPOINTS (/v1/finance/*)
# =============================================================================


@app.post("/v1/finance/nlp/parse-alert")
def finance_parse_alert(body: dict[str, Any]) -> dict[str, Any]:
    """Domain 2: Zero-AA real-time SMS / Notification / Vault Email / iOS Shortcut parser."""
    return finance_network.parse_financial_alert(body)


@app.post("/v1/finance/digital-twin")
def finance_digital_twin(body: dict[str, Any]) -> dict[str, Any]:
    """Domains 1 & 2: Compute Financial Digital Twin, Health Score & Backward Ledger Replay."""
    return finance_network.compute_digital_twin(body)


@app.post("/v1/finance/markets/analyze")
def finance_markets_analyze(body: dict[str, Any]) -> dict[str, Any]:
    """Domains 3, 4, 5, 6, 13: MF look-through overlap, Equity quant & Global/LRS intelligence."""
    return finance_network.analyze_markets_and_overlap(body)


@app.post("/v1/finance/tax/evaluate")
def finance_tax_evaluate(body: dict[str, Any]) -> dict[str, Any]:
    """Domain 7: Deterministic Indian Income Tax (Old vs New) + FIFO Capital Gains & Harvesting."""
    return finance_network.evaluate_tax_and_ca(body)


@app.post("/v1/finance/debt-business/optimize")
def finance_debt_business_optimize(body: dict[str, Any]) -> dict[str, Any]:
    """Domains 8, 9, 10: Debt Avalanche/Snowball/Prepay optimizer + Business Unit Economics."""
    return finance_network.optimize_debt_and_business(body)


@app.post("/v1/finance/simulate/what-if")
def finance_simulate_what_if(body: dict[str, Any]) -> dict[str, Any]:
    """Domains 11, 12 & §17.5: Portfolio VaR/Stress + Monte Carlo & What-If Decision Laboratory."""
    return finance_network.run_simulation_and_risk(body)


@app.post("/v1/finance/graph/propagate")
def finance_graph_propagate(body: dict[str, Any]) -> dict[str, Any]:
    """§17.1 & §17.4: Propagate macro/market event across Financial Knowledge Graph."""
    return finance_network.propagate_knowledge_graph_event(body)


@app.post("/v1/finance/radar/scan")
def finance_radar_scan(body: dict[str, Any]) -> dict[str, Any]:
    """§16 & §17.2: Cross-Engine Opportunity Radar scan."""
    return finance_network.scan_opportunity_radar(body)


@app.post("/v1/finance/cfo/reason")
def finance_cfo_reason(body: dict[str, Any]) -> dict[str, Any]:
    """Domain 15, §17.3 & §17.6: Multi-Agent AI CFO reasoning with Privacy Firewall & Evidence Bundle."""
    return finance_network.reason_ai_cfo(body)


# =============================================================================
# NEXORA VOICE INTELLIGENCE PLATFORM ENDPOINTS (/v1/voice/*)
# =============================================================================


@app.post("/v1/voice/audio/analyze")
def voice_audio_analyze(body: dict[str, Any]) -> dict[str, Any]:
    """Workstream 2: Audio validation, VAD, SNR/clipping QC, and CHiME-style routing strategy."""
    return voice_network.analyze_audio(body)


@app.post("/v1/voice/conversation/process")
def voice_conversation_process(body: dict[str, Any]) -> dict[str, Any]:
    """Full 10-workstream Voice Intelligence pipeline producing canonical Conversation IR."""
    return voice_network.process_conversation(body)


@app.post("/v1/voice/memory/search")
def voice_memory_search(body: dict[str, Any]) -> dict[str, Any]:
    """Workstream 6: Hybrid lexical + semantic search across conversational memory."""
    query = str(body.get("query") or "")
    convs = body.get("conversations") if isinstance(body.get("conversations"), list) else None
    limit = int(body.get("limit") or 8)
    return voice_network.search_memory(query=query, conversations=convs, limit=limit)


@app.post("/v1/voice/qa")
def voice_qa(body: dict[str, Any]) -> dict[str, Any]:
    """Workstream 8: Source-grounded conversational Q&A with utterance timestamp citations."""
    question = str(body.get("question") or body.get("query") or "")
    convs = body.get("conversations") if isinstance(body.get("conversations"), list) else None
    return voice_network.answer_qa(question=question, conversations=convs)


@app.get("/v1/voice/models/benchmarks")
def voice_models_benchmarks() -> dict[str, Any]:
    """Workstream 10: Model Intelligence adapter registry and benchmark telemetry."""
    return voice_network.model_benchmarks()


@app.post("/v1/voice/sessions/start")
def voice_session_start(body: dict[str, Any]) -> dict[str, Any]:
    """Workstream 1: Start a live/background call or meeting streaming capture session."""
    return voice_network.start_session(body)


@app.post("/v1/voice/sessions/{session_id}/chunk")
def voice_session_chunk(session_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Workstream 1-5: Stream rolling audio/speech chunk and update Conversation IR & who->whom graph."""
    return voice_network.ingest_session_chunk(session_id, body)


@app.post("/v1/voice/sessions/{session_id}/finalize")
def voice_session_finalize(session_id: str) -> dict[str, Any]:
    """Finalize streaming call session into a sealed Conversation IR."""
    res = voice_network.finalize_session(session_id)
    if res is None:
        raise HTTPException(status_code=404, detail="voice session not found")
    return res


# =============================================================================
# NEXORA UNIFIED DEEP LEARNING PLATFORM ENDPOINTS (/v1/deep/*)
# =============================================================================


@app.get("/v1/deep/status")
def deep_status() -> dict[str, Any]:
    """Status & model registry of all 16 production deep learning architectures."""
    return hub.get_status()


# --- Mobility Deep Learning ---


@app.post("/v1/deep/mobility/st-gnn/predict")
def deep_mobility_st_gnn(body: dict[str, Any]) -> dict[str, Any]:
    """Spatio-Temporal Graph Neural Net (Graph WaveNet / DCRNN) 5-60 min speed forecasting."""
    current_speeds = [float(x) for x in body.get("current_speeds", [45.0, 38.0, 52.0, 29.0, 41.0])]
    adj = body.get("adjacency")
    return hub.st_gnn.predict_future_speeds(current_speeds, adjacency=adj)


@app.post("/v1/deep/mobility/eta/conformal")
def deep_mobility_eta_conformal(body: dict[str, Any]) -> dict[str, Any]:
    """Deep residual ensemble ETA with finite-sample conformal prediction bounds (80% & 90%)."""
    feats = body.get("features")
    return hub.conformal_eta.predict_conformal(
        features=feats,
        distance_km=float(body.get("distance_km", 12.5)),
        free_flow_speed=float(body.get("free_flow_speed", 45.0)),
        congestion_factor=float(body.get("congestion_factor", 1.35)),
        hour_of_day=int(body.get("hour_of_day", 18)),
        is_weekend=bool(body.get("is_weekend", False)),
        rain_mm=float(body.get("rain_mm", 0.0)),
    )


@app.post("/v1/deep/mobility/trajectory/predict")
def deep_mobility_trajectory(body: dict[str, Any]) -> dict[str, Any]:
    """Transformer encoder destination prediction + trip anomaly autoencoder score."""
    raw_crumbs = body.get("breadcrumbs") or [[17.3850, 78.4867], [17.3910, 78.4912], [17.4020, 78.4980]]
    breadcrumbs = [(float(c[0]), float(c[1])) for c in raw_crumbs]
    raw_favs = body.get("user_favorites")
    user_favs = [(float(f[0]), float(f[1])) for f in raw_favs] if raw_favs else None

    dest_pred = hub.trajectory_transformer.predict_destination(breadcrumbs, user_favorites=user_favs)
    anomaly_score = hub.trip_autoencoder.score_trajectory_anomaly(breadcrumbs)
    return {
        "destination_prediction": dest_pred,
        "trajectory_anomaly": anomaly_score,
    }


@app.post("/v1/deep/mobility/vision/inspect")
def deep_mobility_vision_inspect(body: dict[str, Any]) -> dict[str, Any]:
    """Neural road vision: surface defect classification + monocular crater depth estimation."""
    telemetry = body.get("sensor_telemetry")
    patches = body.get("patch_embeddings")
    return hub.road_vision.inspect_frame(
        sensor_telemetry=telemetry,
        patch_embeddings=patches,
    )


@app.post("/v1/deep/mobility/demand/forecast")
def deep_mobility_demand_tft(body: dict[str, Any]) -> dict[str, Any]:
    """Behavioral demand sequence model (TFT) with event surge attenuation."""
    h3_idx = str(body.get("h3_index") or "8860145b23fffff")
    history = [float(x) for x in body["history_30d"]] if "history_30d" in body else None
    return hub.demand_tft.forecast_demand(
        h3_index=h3_idx,
        history_30d=history,
        hour_of_day=int(body.get("hour_of_day", 18)),
        day_of_week=int(body.get("day_of_week", 4)),
        event_distance_km=float(body.get("event_distance_km", 2.0)),
    )


@app.post("/v1/deep/mobility/policy/evaluate")
def deep_mobility_policy_evaluate(body: dict[str, Any]) -> dict[str, Any]:
    """Offline RL / Conservative Q-Learning policy evaluation for digital twin what-if."""
    state = [float(x) for x in body.get("state", [0.5, 0.2, 0.8, 0.4, 0.1, 0.9, 0.3, 0.6])]
    action = int(body.get("action", 0))
    return hub.rl_policy.evaluate_action(state=state, action=action)


# --- Finance Deep Learning ---


@app.post("/v1/deep/finance/classify-alert")
def deep_finance_classify_alert(body: dict[str, Any]) -> dict[str, Any]:
    """MiniLM/DistilBERT-style subword transformer classifier for transaction SMS / notifications."""
    text = str(body.get("raw_text") or body.get("text") or "")
    amt = float(body["amount"]) if "amount" in body and body["amount"] is not None else None
    vpa = str(body["vpa"]) if "vpa" in body and body["vpa"] else None
    return hub.txn_classifier.classify(text=text, amount=amt, vpa=vpa)


@app.post("/v1/deep/finance/anomaly")
def deep_finance_anomaly(body: dict[str, Any]) -> dict[str, Any]:
    """Deep SVDD hypersphere spend anomaly scoring for Opportunity Radar."""
    return hub.spend_svdd.score_anomaly(
        amount=float(body.get("amount", 0.0)),
        hour_of_day=int(body.get("hour_of_day", 12)),
        merchant=str(body.get("merchant", "")),
        category=str(body.get("category", "")),
        is_foreign=bool(body.get("is_foreign", False)),
        historical_mean=float(body.get("historical_mean", 2500.0)),
        historical_std=float(body.get("historical_std", 1800.0)),
    )


@app.post("/v1/deep/finance/cashflow-forecast")
def deep_finance_cashflow_forecast(body: dict[str, Any]) -> dict[str, Any]:
    """DeepAR probabilistic sequence forecaster: 30/60/90-day balance trajectories."""
    balance = float(body.get("current_balance", 150000.0))
    net_flows = [float(x) for x in body["recent_daily_net_flows"]] if "recent_daily_net_flows" in body else None
    fixed_bills = float(body.get("fixed_obligations_monthly", 35000.0))
    return hub.cashflow_deepar.forecast_balance(
        current_balance=balance,
        recent_daily_net_flows=net_flows,
        fixed_obligations_monthly=fixed_bills,
    )


@app.post("/v1/deep/finance/regime-risk")
def deep_finance_regime_risk(body: dict[str, Any]) -> dict[str, Any]:
    """Hidden Markov 4-state market regime classification + Indian factor tilts."""
    return hub.regime_risk.classify_regime(
        volatility_30d=float(body.get("volatility_30d", 0.18)),
        drawdown_pct=float(body.get("drawdown_pct", -0.04)),
        yield_spread_bps=float(body.get("yield_spread_bps", 180.0)),
        fii_flow_crs=float(body.get("fii_flow_crs", 450.0)),
    )


@app.post("/v1/deep/finance/graph/propagate")
def deep_finance_graph_propagate(body: dict[str, Any]) -> dict[str, Any]:
    """GNN message-passing shock propagation across financial knowledge graph."""
    nodes = body.get("asset_nodes") or [
        {"id": "large_cap_eq", "type": "equity_mutual_fund", "weight": 0.45},
        {"id": "corp_bond", "type": "debt_fund", "weight": 0.25},
        {"id": "home_loan", "type": "floating_loan", "weight": 0.30},
    ]
    shocks = body.get("stress_shocks") or {"equity_drawdown": -0.15, "repo_hike_bps": 50.0}
    propagated = hub.gnn_risk.propagate_shock(asset_nodes=nodes, stress_shocks=shocks)
    return {
        "propagated_nodes": propagated,
        "total_nodes": len(propagated),
        "model": "GNN-MessagePassing-ShockPropagator-v1",
    }


@app.post("/v1/deep/finance/doc/extract")
def deep_finance_doc_extract(body: dict[str, Any]) -> dict[str, Any]:
    """Neural document intelligence: PAN, IFSC, salary slips, and tax forms extraction."""
    text = str(body.get("text") or "")
    return hub.doc_intel.extract_document(text)


@app.post("/v1/deep/finance/merchants/register")
def deep_finance_merchants_register(body: dict[str, Any]) -> dict[str, Any]:
    """Dynamically register or update merchant signatures at runtime without redeploying models."""
    merchants = body.get("merchants")
    if merchants is not None:
        count = hub.txn_classifier.register_merchants_batch(merchants)
    else:
        kw = str(body.get("keyword") or body.get("kw") or "").strip().lower()
        if not kw:
            raise HTTPException(status_code=400, detail="keyword is required")
        name = str(body.get("name") or kw.title())
        cat = str(body.get("category") or "shopping_ecommerce")
        rec = bool(body.get("recurring", False))
        hub.txn_classifier.register_merchant(kw, name, cat, rec)
        count = 1
    return {
        "status": "success",
        "registered_count": count,
        "total_active_merchants": len(hub.txn_classifier.merchant_lexicon),
    }


@app.get("/v1/deep/finance/merchants")
def deep_finance_merchants_list() -> dict[str, Any]:
    """List currently registered dynamic merchant signatures and category mappings."""
    return hub.txn_classifier.get_registered_merchants()


# --- Voice Deep Learning ---


@app.post("/v1/deep/voice/asr/adapt")
def deep_voice_asr_adapt(body: dict[str, Any]) -> dict[str, Any]:
    """Whisper telephony adapter: acoustic SNR compensation & code-switching (EN/HI/TE)."""
    return hub.whisper_telephony.adapt_audio(
        sample_rate_hz=int(body.get("sample_rate_hz", 8000)),
        snr_db=float(body.get("snr_db", 14.5)),
        text_sample=str(body.get("text_sample", "")),
    )


@app.post("/v1/deep/voice/diarize")
def deep_voice_diarize(body: dict[str, Any]) -> dict[str, Any]:
    """Neural speaker diarization using x-vector embeddings & agglomerative clustering."""
    feats = body.get("segment_features") or [[0.2] * 16, [0.8] * 16, [0.22] * 16, [0.79] * 16]
    num_speakers = int(body["num_speakers"]) if "num_speakers" in body and body["num_speakers"] else None
    return hub.speaker_diarizer.diarize(segment_features=feats, num_speakers=num_speakers)


@app.post("/v1/deep/voice/dense-search")
def deep_voice_dense_search(body: dict[str, Any]) -> dict[str, Any]:
    """BGE-M3-style dense semantic retrieval across conversation transcripts."""
    query = str(body.get("query") or "")
    corpus = [str(x) for x in body.get("corpus", [])]
    top_k = int(body.get("top_k", 5))
    return hub.dense_retriever.search(query=query, corpus=corpus, top_k=top_k)


@app.post("/v1/deep/voice/rerank")
def deep_voice_rerank(body: dict[str, Any]) -> dict[str, Any]:
    """Cross-encoder query-passage reranking for grounded conversation QA."""
    query = str(body.get("query") or "")
    passages = [str(x) for x in body.get("passages", [])]
    return hub.cross_reranker.rerank(query=query, passages=passages)


@app.post("/v1/deep/voice/urgency")
def deep_voice_urgency(body: dict[str, Any]) -> dict[str, Any]:
    """Wav2Vec2/HuBERT affect classifier & escalation risk detector."""
    feats = body.get("acoustic_features")
    return hub.urgency_detector.detect(
        acoustic_features=feats,
        pitch_variance=float(body.get("pitch_variance", 45.0)),
        energy_rms=float(body.get("energy_rms", 0.35)),
        speech_rate_wpm=float(body.get("speech_rate_wpm", 165.0)),
        sentiment_polarity=float(body.get("sentiment_polarity", -0.3)),
    )


@app.post("/v1/deep/voice/code-switch/register")
def deep_voice_code_switch_register(body: dict[str, Any]) -> dict[str, Any]:
    """Dynamically register dialect tokens and language pairs for telephony ASR."""
    tokens = body.get("tokens")
    lang = body.get("language")
    if isinstance(tokens, dict):
        count = hub.whisper_telephony.register_code_switch_tokens(tokens, language=lang)
    elif isinstance(body.get("token"), str) and lang:
        count = hub.whisper_telephony.register_code_switch_tokens({body["token"]: lang})
    else:
        raise HTTPException(status_code=400, detail="tokens dictionary or token + language required")
    return {
        "status": "success",
        "registered_count": count,
        "total_active_tokens": len(hub.whisper_telephony.code_switch_lexicon),
        "supported_languages": hub.whisper_telephony.supported_languages,
    }


@app.get("/v1/deep/voice/code-switch/lexicon")
def deep_voice_code_switch_lexicon() -> dict[str, Any]:
    """List current dynamic code-switching vocabulary and supported Indian dialect pairs."""
    return hub.whisper_telephony.get_lexicon()


# --- Cross-Cutting & Continuous Learning ---


@app.post("/v1/deep/multimodal/user-twin")
def deep_multimodal_user_twin(body: dict[str, Any]) -> dict[str, Any]:
    """Multi-modal fusion: Voice + Finance + Mobility into unified latent User Twin."""
    voice_v = body.get("voice_summary")
    fin_v = body.get("finance_summary")
    mob_v = body.get("mobility_summary")
    uid = str(body.get("user_id") or "usr_default")
    return hub.multimodal_fusion.fuse(
        voice_summary=voice_v,
        finance_summary=fin_v,
        mobility_summary=mob_v,
        user_id=uid,
    )


@app.post("/v1/deep/evaluation/drift")
def deep_evaluation_drift(body: dict[str, Any]) -> dict[str, Any]:
    """Kolmogorov-Smirnov two-sample feature drift detector."""
    ref = [float(x) for x in body.get("reference_sample", [])]
    cur = [float(x) for x in body.get("current_sample", [])]
    feat = str(body.get("feature_name", "feature_0"))
    return hub.drift_detector.detect_drift(reference_sample=ref, current_sample=cur, feature_name=feat)


@app.post("/v1/deep/evaluation/benchmark")
def deep_evaluation_benchmark(body: dict[str, Any]) -> dict[str, Any]:
    """Run model evaluation harness (MAE, RMSE, MAPE, Conformal empirical coverage)."""
    y_true = [float(x) for x in body.get("y_true", [25.0, 30.0, 35.0, 28.0, 40.0])]
    y_pred = [float(x) for x in body.get("y_pred", [24.5, 31.0, 34.0, 29.5, 38.0])]
    y_lower = [float(x) for x in body["y_lower"]] if "y_lower" in body else None
    y_upper = [float(x) for x in body["y_upper"]] if "y_upper" in body else None
    return hub.evaluation_harness.evaluate_predictions(
        y_true=y_true,
        y_pred=y_pred,
        y_lower=y_lower,
        y_upper=y_upper,
    )
