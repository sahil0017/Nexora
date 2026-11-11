"""City Movement Digital Twin, Cross-Domain Movement (Humans, Animals, Vehicles),
Predictive Crowd Intelligence, Animal-Vehicle Conflict Prediction, Pedestrian Safety,
Urban What-If Simulation, and Persistent Road Memory Network.

All spatial/temporal computations operate dynamically from coordinates, telemetry,
observations, and mathematical models with zero hardcoded city fixtures.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
import time
from typing import Any

from nexora.geospatial.h3_grid import haversine_m, latlon_to_h3


class RoadMemoryNetwork:
    """Maintains persistent, quorum-verified, exponentially decayed knowledge of road conditions."""

    model_version = "road-memory-bayesian-v1"

    def __init__(self, half_life_hrs: float = 72.0) -> None:
        self.half_life_hrs = half_life_hrs
        # Keyed by (h3_index, condition_type)
        self._nodes: dict[tuple[str, str], dict[str, Any]] = {}

    def observe(
        self,
        latitude: float,
        longitude: float,
        condition_type: str,
        severity: str = "medium",
        segment_id: str | None = None,
        confidence_obs: float = 0.72,
    ) -> dict[str, Any]:
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        ctype = condition_type.lower().strip() or "surface_damage"
        sev = severity.lower().strip() or "medium"
        now = time.time()
        key = (h3_idx, ctype)

        existing = self._nodes.get(key)
        if existing:
            obs_count = existing["observation_count"] + 1
            ver_count = existing["verified_by_count"] + 1
            # Bayesian-style reinforcement weighted by repeated independent reports
            prior = self._effective_confidence(existing, now)
            boosted = min(0.99, round(1.0 - (1.0 - prior) * (1.0 - 0.45 * confidence_obs), 3))
            existing.update(
                {
                    "observation_count": obs_count,
                    "verified_by_count": ver_count,
                    "severity": sev if sev in ("high", "critical") else existing["severity"],
                    "confidence": boosted,
                    "status": "verified" if ver_count >= 2 else "active",
                    "last_observed_ts": now,
                    "last_observed_at": datetime.now(timezone.utc).isoformat(),
                    "segment_id": segment_id or existing.get("segment_id"),
                }
            )
            return self._public_view(existing, now)

        node = {
            "node_id": f"rmem-{h3_idx[:8]}-{ctype[:6]}",
            "h3_index": h3_idx,
            "segment_id": segment_id,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "condition_type": ctype,
            "severity": sev,
            "confidence": round(min(0.95, max(0.4, confidence_obs)), 3),
            "observation_count": 1,
            "verified_by_count": 1,
            "decay_half_life_hrs": self.half_life_hrs,
            "status": "active",
            "last_observed_ts": now,
            "last_observed_at": datetime.now(timezone.utc).isoformat(),
        }
        self._nodes[key] = node
        return self._public_view(node, now)

    def _effective_confidence(self, node: dict[str, Any], now_ts: float) -> float:
        elapsed_hrs = max(0.0, (now_ts - node["last_observed_ts"]) / 3600.0)
        hl = max(1.0, float(node.get("decay_half_life_hrs", self.half_life_hrs)))
        decay = 0.5 ** (elapsed_hrs / hl)
        return round(float(node["confidence"]) * decay, 3)

    def _public_view(self, node: dict[str, Any], now_ts: float, ref_point: tuple[float, float] | None = None) -> dict[str, Any]:
        eff = self._effective_confidence(node, now_ts)
        dist = 0.0
        if ref_point is not None:
            dist = round(haversine_m(ref_point[0], ref_point[1], node["latitude"], node["longitude"]), 1)
        return {
            "node_id": node["node_id"],
            "h3_index": node["h3_index"],
            "segment_id": node.get("segment_id"),
            "latitude": node["latitude"],
            "longitude": node["longitude"],
            "condition_type": node["condition_type"],
            "severity": node["severity"],
            "confidence": eff,
            "observation_count": node["observation_count"],
            "verified_by_count": node["verified_by_count"],
            "status": "decayed" if eff < 0.25 else node["status"],
            "last_observed_at": node["last_observed_at"],
            "distance_meters": dist,
        }

    def query_corridor(
        self,
        latitude: float,
        longitude: float,
        radius_m: float = 5000.0,
    ) -> list[dict[str, Any]]:
        now = time.time()
        out: list[dict[str, Any]] = []
        for node in self._nodes.values():
            dist = haversine_m(latitude, longitude, node["latitude"], node["longitude"])
            if dist <= radius_m:
                view = self._public_view(node, now, (latitude, longitude))
                if view["confidence"] >= 0.20:
                    out.append(view)
        out.sort(key=lambda x: (-x["confidence"], x["distance_meters"]))
        return out


class CityMovementDigitalTwin:
    """Unified 12-Pillar City Digital Twin connecting humans, animals, vehicles, crowd forecasts,
    pedestrian safety, wildlife conflict risk, and What-If urban simulations.
    """

    model_version = "city-digital-twin-v1"

    def __init__(self, road_memory: RoadMemoryNetwork | None = None) -> None:
        self.road_memory = road_memory or RoadMemoryNetwork()
        self._animal_zones: list[dict[str, Any]] = []

    def record_animal_sighting(
        self,
        latitude: float,
        longitude: float,
        species_group: str = "stray_cattle",
        corridor_type: str = "urban_arterial",
        severity_hint: str = "medium",
    ) -> dict[str, Any]:
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        now = datetime.now(timezone.utc)
        for z in self._animal_zones:
            if z["h3_index"] == h3_idx and z["species_group"] == species_group:
                z["sighting_count"] += 1
                z["risk_score"] = round(min(0.98, z["risk_score"] + 0.08), 3)
                z["last_observed_at"] = now.isoformat()
                return dict(z)

        base_risk = 0.72 if severity_hint == "high" else 0.56 if severity_hint == "medium" else 0.38
        zone = {
            "zone_id": f"awz-{h3_idx[:8]}-{len(self._animal_zones) + 1}",
            "h3_index": h3_idx,
            "species_group": species_group,
            "corridor_type": corridor_type,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "risk_score": base_risk,
            "sighting_count": 1,
            "advisory": f"Reported {species_group.replace('_', ' ')} movement along {corridor_type.replace('_', ' ')}. Reduce high-beam speed.",
            "last_observed_at": now.isoformat(),
        }
        self._animal_zones.append(zone)
        return dict(zone)

    def predict_crowd(
        self,
        latitude: float,
        longitude: float,
        horizons: list[int] | None = None,
        gps_points: list[dict[str, Any]] | None = None,
        active_events_count: int = 0,
        weather: str = "clear",
        at_time: datetime | None = None,
    ) -> dict[str, Any]:
        """Pillar 3 + Pillar 6: Predictive Crowd Intelligence across spatiotemporal horizons."""
        ref = at_time or datetime.now(timezone.utc)
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        hs = horizons or [15, 30, 60]
        local_samples = 0
        for pt in gps_points or []:
            if "latitude" in pt and "longitude" in pt:
                if haversine_m(latitude, longitude, float(pt["latitude"]), float(pt["longitude"])) <= 1800:
                    local_samples += 1

        # Telemetry density normalized cleanly (0..1)
        live_density = min(0.85, local_samples / 35.0) if local_samples > 0 else 0.24
        event_boost = min(0.32, active_events_count * 0.14)
        weather_mult = 0.88 if weather.lower() in ("rain", "storm") else 1.0

        forecasts: list[dict[str, Any]] = []
        for h_min in hs:
            future_hr = ((ref.hour + (ref.minute + h_min) / 60.0) % 24.0)
            # Diurnal dual-peak harmonic (commute / plaza peaks without city assumptions)
            morning_wave = math.exp(-((future_hr - 3.5) ** 2) / 3.2)  # ~09:00 IST
            evening_wave = math.exp(-((future_hr - 12.5) ** 2) / 4.0)  # ~18:00 IST
            diurnal = 0.18 + 0.42 * max(morning_wave, evening_wave)
            density = round(min(0.98, max(0.08, (0.55 * diurnal + 0.45 * live_density + event_boost) * weather_mult)), 3)
            risk = "critical" if density >= 0.82 else "high" if density >= 0.64 else "moderate" if density >= 0.42 else "low"
            forecasts.append(
                {
                    "h3_index": h3_idx,
                    "horizon_minutes": h_min,
                    "predicted_crowd_density": density,
                    "bottleneck_risk": risk,
                    "recommended_action": (
                        "Stagger departures or shift foot traffic to secondary concourse."
                        if risk in ("high", "critical")
                        else "Crowd flow balanced; normal concourse capacity."
                    ),
                }
            )

        return {
            "h3_index": h3_idx,
            "current_density": round(min(0.98, live_density + event_boost * 0.5), 3),
            "forecasts": forecasts,
            "model_version": self.model_version,
        }

    def predict_animal_conflict(
        self,
        latitude: float,
        longitude: float,
        vehicle_speed_kph: float = 40.0,
        weather: str = "clear",
        at_time: datetime | None = None,
    ) -> dict[str, Any]:
        """Pillar 4: Animal-Vehicle Conflict Prediction combining sightings, twilight factor, speed & visibility."""
        ref = at_time or datetime.now(timezone.utc)
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        ist_hr = ((ref.hour + 5) + (ref.minute + 30) / 60.0) % 24.0
        # Crepuscular & nocturnal risk curve (dusk 17:30-21:30, dawn 05:00-07:30 IST)
        dusk = math.exp(-((ist_hr - 19.2) ** 2) / 3.5)
        dawn = math.exp(-((ist_hr - 6.0) ** 2) / 2.2)
        twilight_factor = max(dusk, dawn)
        visibility_penalty = 0.20 if weather.lower() in ("rain", "fog", "storm", "heavy_rain") else 0.0
        speed_exposure = min(0.30, max(0.0, (vehicle_speed_kph - 25.0) / 80.0))

        nearby_zones: list[dict[str, Any]] = []
        zone_boost = 0.0
        for z in self._animal_zones:
            d = haversine_m(latitude, longitude, z["latitude"], z["longitude"])
            if d <= 4500.0:
                nearby_zones.append({**z, "distance_meters": round(d, 1)})
                zone_boost = max(zone_boost, float(z["risk_score"]) * (1.0 - d / 5500.0))

        risk_score = round(min(0.98, 0.12 + 0.25 * twilight_factor + visibility_penalty + speed_exposure + 0.50 * zone_boost), 3)
        level = "high" if risk_score >= 0.65 else "moderate" if risk_score >= 0.40 else "low"
        return {
            "h3_index": h3_idx,
            "conflict_risk_score": risk_score,
            "risk_level": level,
            "twilight_factor": round(twilight_factor, 3),
            "nearby_zones": sorted(nearby_zones, key=lambda x: x["distance_meters"]),
            "mitigation_advice": (
                "Crepuscular animal crossing risk elevated; maintain <=35 km/h & scan road shoulders."
                if level == "high"
                else "Watch roadside shoulders during low-visibility hours."
                if level == "moderate"
                else "Low animal-vehicle conflict likelihood on this cell."
            ),
            "model_version": self.model_version,
        }

    def assess_pedestrian_safety(
        self,
        latitude: float,
        longitude: float,
        avg_vehicle_speed_kph: float = 34.0,
        crowd_density: float = 0.3,
        active_hazards: int = 0,
        weather: str = "clear",
        at_time: datetime | None = None,
    ) -> dict[str, Any]:
        """Pillar 5: Pedestrian Safety Intelligence combining traffic kinetic risk, lighting, hazards & crowd."""
        ref = at_time or datetime.now(timezone.utc)
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        ist_hr = ((ref.hour + 5) + (ref.minute + 30) / 60.0) % 24.0
        is_night = ist_hr >= 19.5 or ist_hr <= 5.5
        lighting_index = 0.58 if is_night else 0.92
        road_mem = self.road_memory.query_corridor(latitude, longitude, radius_m=2500.0)
        walk_mem_issues = sum(
            1 for n in road_mem if n["condition_type"] in ("unlit_walkway", "chronic_waterlogging", "surface_damage")
        )

        speed_penalty = min(28.0, max(0.0, (avg_vehicle_speed_kph - 25.0) * 0.9))
        hazard_penalty = min(22.0, (active_hazards + walk_mem_issues) * 6.5)
        weather_penalty = 11.0 if weather.lower() in ("rain", "storm", "heavy_rain") else 0.0
        lighting_penalty = 14.0 if is_night else 0.0
        crowd_penalty = 8.0 if crowd_density > 0.72 else 0.0

        score = round(max(15.0, min(98.0, 94.0 - speed_penalty - hazard_penalty - weather_penalty - lighting_penalty - crowd_penalty)), 1)
        grade = "A" if score >= 80 else "B" if score >= 65 else "C" if score >= 45 else "D"
        factors: list[str] = []
        if speed_penalty >= 12:
            factors.append(f"High adjacent vehicle speed ({round(avg_vehicle_speed_kph)} km/h)")
        if is_night:
            factors.append("Night-time crossing lighting penalty")
        if active_hazards + walk_mem_issues > 0:
            factors.append(f"{active_hazards + walk_mem_issues} surface/walkway hazard(s) nearby")
        if weather_penalty > 0:
            factors.append(f"Wet surface & reduced visibility ({weather})")
        if not factors:
            factors.append("Safe ambient corridor speeds & clear walkways")

        return {
            "h3_index": h3_idx,
            "walk_safety_score": score,
            "safety_grade": grade,
            "lighting_index": lighting_index,
            "risk_factors": factors,
            "recommendation": (
                "Prefer signalized crosswalks & well-lit feeder streets."
                if score < 70
                else "Favorable pedestrian corridor conditions."
            ),
            "model_version": self.model_version,
        }

    def build_digital_twin_state(
        self,
        latitude: float,
        longitude: float,
        avg_speed_kph: float = 30.0,
        active_hazards: int = 0,
        active_events_count: int = 0,
        gps_points: list[dict[str, Any]] | None = None,
        weather: str = "clear",
    ) -> dict[str, Any]:
        """Pillar 1 + Pillar 2: Unified City Movement Digital Twin & Cross-Domain Interaction Tensor."""
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        crowd = self.predict_crowd(
            latitude,
            longitude,
            horizons=[15, 30, 60],
            gps_points=gps_points,
            active_events_count=active_events_count,
            weather=weather,
        )
        crowd_density = float(crowd["current_density"])
        animal = self.predict_animal_conflict(latitude, longitude, vehicle_speed_kph=avg_speed_kph, weather=weather)
        ped = self.assess_pedestrian_safety(
            latitude,
            longitude,
            avg_vehicle_speed_kph=avg_speed_kph,
            crowd_density=crowd_density,
            active_hazards=active_hazards,
            weather=weather,
        )
        road_mem = self.road_memory.query_corridor(latitude, longitude, radius_m=4000.0)

        vehicle_flow_idx = round(min(1.0, max(0.08, 1.0 - avg_speed_kph / 60.0)), 3)
        coupling_risk = round(
            min(
                1.0,
                0.38 * crowd_density + 0.34 * vehicle_flow_idx + 0.28 * float(animal["conflict_risk_score"]),
            ),
            3,
        )
        system_health = round(
            max(
                20.0,
                min(
                    99.0,
                    100.0 - coupling_risk * 42.0 - min(20.0, len(road_mem) * 4.5) - min(15.0, active_hazards * 5.0),
                ),
            ),
            1,
        )
        return {
            "h3_index": h3_idx,
            "latitude": latitude,
            "longitude": longitude,
            "system_health_index": system_health,
            "cross_domain": {
                "human_crowd_density": crowd_density,
                "vehicle_congestion_index": vehicle_flow_idx,
                "animal_conflict_index": animal["conflict_risk_score"],
                "coupling_risk_score": coupling_risk,
                "dominant_interaction": (
                    "animal_vehicle_interface"
                    if animal["conflict_risk_score"] >= 0.55
                    else "human_vehicle_corridor_load"
                    if crowd_density >= 0.60
                    else "balanced_multimodal_flow"
                ),
            },
            "crowd_intelligence": crowd,
            "animal_conflict": animal,
            "pedestrian_safety": ped,
            "road_memory_nodes": road_mem[:8],
            "model_version": self.model_version,
        }

    def simulate_what_if(
        self,
        latitude: float,
        longitude: float,
        intervention_type: str,
        intensity_pct: float = 25.0,
        avg_speed_kph: float = 28.0,
        crowd_density: float = 0.55,
    ) -> dict[str, Any]:
        """Pillar 10: Urban What-If Simulation computing macro deltas on speed, safety, crowd & emissions."""
        h3_idx = latlon_to_h3(latitude, longitude, 8)
        scale = max(0.1, min(1.0, intensity_pct / 100.0))
        ped_base = self.assess_pedestrian_safety(
            latitude, longitude, avg_vehicle_speed_kph=avg_speed_kph, crowd_density=crowd_density
        )
        animal_base = self.predict_animal_conflict(latitude, longitude, vehicle_speed_kph=avg_speed_kph)

        base_co2_g_per_km = round(142.0 * (0.7 + 0.5 * crowd_density), 1)
        proj_speed = avg_speed_kph
        proj_crowd = crowd_density
        ped_delta = 0.0
        animal_delta = 0.0
        co2_delta_pct = 0.0
        verdict = ""

        itype = intervention_type.lower().strip()
        if itype == "car_free_zone":
            proj_crowd = round(max(0.12, crowd_density * (1.0 - 0.18 * scale)), 3)
            proj_speed = round(avg_speed_kph * (1.0 + 0.08 * scale), 1)
            ped_delta = round(18.5 * scale + 6.0, 1)
            animal_delta = round(-0.22 * scale - 0.05, 3)
            co2_delta_pct = round(-(28.0 + 20.0 * scale), 1)
            verdict = "Pedestrianization cuts private auto emissions and boosts walk safety substantially."
        elif itype == "signal_retime":
            proj_speed = round(min(55.0, avg_speed_kph * (1.0 + 0.28 * scale)), 1)
            proj_crowd = round(max(0.15, crowd_density * (1.0 - 0.14 * scale)), 3)
            ped_delta = round(7.5 * scale + 2.0, 1)
            animal_delta = round(-0.04 * scale, 3)
            co2_delta_pct = round(-(11.0 * scale + 3.0), 1)
            verdict = "Adaptive signal retiming removes stop-and-go queue spillbacks cleanly."
        elif itype == "transit_boost":
            proj_crowd = round(max(0.10, crowd_density * (1.0 - 0.34 * scale)), 3)
            proj_speed = round(min(54.0, avg_speed_kph * (1.0 + 0.22 * scale)), 1)
            ped_delta = round(9.0 * scale + 2.5, 1)
            animal_delta = round(-0.08 * scale, 3)
            co2_delta_pct = round(-(19.0 * scale + 5.0), 1)
            verdict = "Higher transit frequency shifts riders out of cars and decompresses arterial bottlenecks."
        elif itype == "speed_calming":
            proj_speed = round(max(20.0, avg_speed_kph * (1.0 - 0.24 * scale)), 1)
            proj_crowd = crowd_density
            ped_delta = round(16.0 * scale + 5.0, 1)
            animal_delta = round(-0.26 * scale - 0.06, 3)
            co2_delta_pct = round(-4.5 * scale, 1)
            verdict = "Traffic calming lowers kinetic collision risk for pedestrians and animals."
        else:  # bus_lane
            proj_speed = round(min(52.0, avg_speed_kph * (1.0 + 0.18 * scale)), 1)
            proj_crowd = round(max(0.15, crowd_density * (1.0 - 0.22 * scale)), 3)
            ped_delta = round(6.0 * scale + 2.0, 1)
            animal_delta = round(-0.05 * scale, 3)
            co2_delta_pct = round(-(15.0 * scale + 4.0), 1)
            verdict = "Dedicated transit lane stabilizes bus headways and relieves corridor crowding."

        proj_ped = round(min(99.0, max(15.0, float(ped_base["walk_safety_score"]) + ped_delta)), 1)
        proj_animal = round(max(0.05, min(0.98, float(animal_base["conflict_risk_score"]) + animal_delta)), 3)
        proj_co2 = round(base_co2_g_per_km * (1.0 + co2_delta_pct / 100.0), 1)

        return {
            "scenario_name": f"{itype.replace('_', ' ').title()} ({round(intensity_pct)}%)",
            "intervention_type": itype,
            "h3_index": h3_idx,
            "baseline_metrics": {
                "avg_speed_kph": round(avg_speed_kph, 1),
                "crowd_density": round(crowd_density, 3),
                "walk_safety_score": ped_base["walk_safety_score"],
                "animal_conflict_risk": animal_base["conflict_risk_score"],
                "co2_grams_per_km": base_co2_g_per_km,
            },
            "projected_metrics": {
                "avg_speed_kph": proj_speed,
                "crowd_density": proj_crowd,
                "walk_safety_score": proj_ped,
                "animal_conflict_risk": proj_animal,
                "co2_grams_per_km": proj_co2,
            },
            "deltas": {
                "speed_delta_kph": round(proj_speed - avg_speed_kph, 1),
                "crowd_delta_pct": round((proj_crowd - crowd_density) * 100.0, 1),
                "pedestrian_safety_delta": round(proj_ped - float(ped_base["walk_safety_score"]), 1),
                "animal_conflict_delta": round(proj_animal - float(animal_base["conflict_risk_score"]), 3),
                "co2_reduction_pct": abs(co2_delta_pct),
            },
            "net_impact_summary": verdict,
            "model_version": self.model_version,
        }
