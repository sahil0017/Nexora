"""Event-Aware Routing Intelligence: Discovers active city/corridor disruptions dynamically from
live traffic anomalies, H3 congestion hotspots, external open feeds, OpenStreetMap civic venues,
or webhook registrations — without hardcoded city/location literals in production code.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import time
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from nexora.geospatial.h3_grid import haversine_m, latlon_to_h3


class EventIntelligenceEngine:
    """Maintains dynamic urban mobility events and scores spatial/temporal corridor impact."""

    model_version = "event-aware-dynamic-v2"

    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []
        self._telemetry_events: dict[str, dict[str, Any]] = {}
        self._venue_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    def register_event(self, event: dict[str, Any]) -> dict[str, Any]:
        if "latitude" not in event or "longitude" not in event:
            raise ValueError("latitude and longitude are required to register a city event")
        lat = float(event["latitude"])
        lon = float(event["longitude"])
        entry = {
            "event_id": str(event.get("event_id") or f"evt-custom-{len(self._events) + 1}"),
            "title": str(event.get("title") or "Local Corridor Event"),
            "category": str(event.get("category") or "public_event"),
            "latitude": lat,
            "longitude": lon,
            "h3_index": latlon_to_h3(lat, lon, 8),
            "radius_m": float(event.get("radius_m", 2500)),
            "severity": str(event.get("severity", "medium")).lower(),
            "road_delay_multiplier": float(event.get("road_delay_multiplier", 1.20)),
            "affected_modes": list(event.get("affected_modes") or ["car", "bus", "two_wheeler"]),
            "metro_unaffected": bool(event.get("metro_unaffected", True)),
            "peak_hours_ist": list(event.get("peak_hours_ist") or list(range(24))),
            "advisory": str(event.get("advisory") or "Elevated event traffic expected near corridor."),
            "source": str(event.get("source") or "registered"),
        }
        self._events.append(entry)
        return entry

    def sync_from_telemetry(
        self,
        hotspots: list[dict[str, Any]] | None = None,
        anomalies: list[dict[str, Any]] | None = None,
        fallback_lat: float | None = None,
        fallback_lon: float | None = None,
    ) -> None:
        """Synthesize dynamic corridor surge events from live congestion hotspots and traffic anomalies."""
        now = time.time()
        # Prune expired telemetry events (15 min TTL)
        self._telemetry_events = {
            k: v for k, v in self._telemetry_events.items() if v.get("expires_at", 0) > now
        }

        for h in hotspots or []:
            score = float(h.get("congestion_score", 0.0))
            lat = h.get("latitude")
            lon = h.get("longitude")
            if score < 0.68 or lat is None or lon is None:
                continue
            h3_idx = str(h.get("h3_index") or latlon_to_h3(float(lat), float(lon), 8))
            mult = round(min(1.45, 1.10 + (score - 0.65) * 0.65), 2)
            self._telemetry_events[f"hotspot:{h3_idx}"] = {
                "event_id": f"evt-surge-{h3_idx[:8]}",
                "title": f"Live Corridor Surge ({h3_idx[:7]})",
                "category": "telemetry_congestion_surge",
                "latitude": float(lat),
                "longitude": float(lon),
                "h3_index": h3_idx,
                "radius_m": 2000.0,
                "severity": "high" if score >= 0.85 else "medium",
                "road_delay_multiplier": mult,
                "affected_modes": ["car", "bus", "two_wheeler"],
                "metro_unaffected": True,
                "peak_hours_ist": list(range(24)),
                "advisory": (
                    f"Dense GPS cluster detected ({round(score * 100)}% load); "
                    "rail or outer bypass corridors recommended."
                ),
                "source": "live_telemetry",
                "expires_at": now + 900,
            }

        severe_anoms = [a for a in (anomalies or []) if a.get("is_anomaly")]
        if severe_anoms and fallback_lat is not None and fallback_lon is not None:
            top = max(severe_anoms, key=lambda a: float(a.get("speed_drop_pct", 0.0)))
            drop = float(top.get("speed_drop_pct", 0.0))
            seg_id = str(top.get("segment_id") or "corridor")
            mult = round(min(1.5, 1.12 + drop / 200.0), 2)
            h3_idx = latlon_to_h3(fallback_lat, fallback_lon, 8)
            self._telemetry_events[f"anom:{seg_id}"] = {
                "event_id": f"evt-anom-{seg_id}",
                "title": f"Unplanned Slowdown on {seg_id}",
                "category": "traffic_anomaly",
                "latitude": float(fallback_lat),
                "longitude": float(fallback_lon),
                "h3_index": h3_idx,
                "radius_m": 2500.0,
                "severity": str(top.get("severity") or "high"),
                "road_delay_multiplier": mult,
                "affected_modes": ["car", "bus", "two_wheeler"],
                "metro_unaffected": True,
                "peak_hours_ist": list(range(24)),
                "advisory": str(top.get("cause_hint") or "Sudden corridor slowdown detected via EWMA anomaly monitor."),
                "source": "ewma_anomaly_detector",
                "expires_at": now + 900,
            }

    def _discover_osm_venues(self, latitude: float, longitude: float, radius_m: float) -> list[dict[str, Any]]:
        """Optionally discover civic/stadium venues near coordinates via OpenStreetMap Overpass API."""
        if os.getenv("NEXORA_ENABLE_EXTERNAL_OVERPASS", "false").lower() != "true":
            return []
        cell_key = f"{round(latitude, 2)}:{round(longitude, 2)}:{int(radius_m)}"
        now = time.time()
        cached = self._venue_cache.get(cell_key)
        if cached and cached[0] > now:
            return cached[1]

        overpass_url = os.getenv("NEXORA_OVERPASS_URL", "https://overpass-api.de/api/interpreter")
        r_clamped = int(min(max(radius_m, 1000), 8000))
        ql = (
            f'[out:json][timeout:3];('
            f'node["leisure"="stadium"](around:{r_clamped},{latitude},{longitude});'
            f'node["amenity"~"conference_centre|exhibition_centre|events_venue"](around:{r_clamped},{latitude},{longitude});'
            f');out body 5;'
        )
        discovered: list[dict[str, Any]] = []
        try:
            body = urlencode({"data": ql}).encode("utf-8")
            req = Request(overpass_url, data=body, headers={"User-Agent": "Nexora-Mobility/1.0"})
            with urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for el in data.get("elements", [])[:5]:
                tags = el.get("tags") or {}
                name = tags.get("name")
                v_lat = el.get("lat")
                v_lon = el.get("lon")
                if not name or v_lat is None or v_lon is None:
                    continue
                cat = "stadium_event" if tags.get("leisure") == "stadium" else "venue_hub"
                discovered.append(
                    {
                        "event_id": f"osm-{el.get('id', name)}",
                        "title": f"{name} Venue Zone",
                        "category": cat,
                        "latitude": float(v_lat),
                        "longitude": float(v_lon),
                        "h3_index": latlon_to_h3(float(v_lat), float(v_lon), 8),
                        "radius_m": 1800.0,
                        "severity": "low",
                        "road_delay_multiplier": 1.08,
                        "affected_modes": ["car", "bus"],
                        "metro_unaffected": True,
                        "peak_hours_ist": [17, 18, 19, 20, 21],
                        "advisory": f"Check event schedule near {name} (OpenStreetMap venue).",
                        "source": "openstreetmap_overpass",
                    }
                )
        except Exception:
            discovered = []

        self._venue_cache[cell_key] = (now + 1800, discovered)
        return discovered

    def _all_events(self, latitude: float | None = None, longitude: float | None = None, radius_m: float = 12000.0) -> list[dict[str, Any]]:
        combined = list(self._events) + list(self._telemetry_events.values())
        if latitude is not None and longitude is not None:
            combined.extend(self._discover_osm_venues(latitude, longitude, radius_m))
        return combined

    def active_events_near(
        self,
        latitude: float | None = None,
        longitude: float | None = None,
        at_time: datetime | None = None,
        radius_m: float = 12000.0,
    ) -> list[dict[str, Any]]:
        ref = at_time or datetime.now(timezone.utc)
        ist_hour = int(((ref.hour + 5) + (ref.minute + 30) / 60.0) % 24)
        out: list[dict[str, Any]] = []
        for ev in self._all_events(latitude, longitude, radius_m):
            active_now = ist_hour in ev.get("peak_hours_ist", list(range(24)))
            dist_m = 0.0
            if latitude is not None and longitude is not None:
                dist_m = haversine_m(latitude, longitude, ev["latitude"], ev["longitude"])
                if dist_m > max(radius_m, ev["radius_m"]):
                    continue
            out.append(
                {
                    **ev,
                    "h3_index": ev.get("h3_index") or latlon_to_h3(ev["latitude"], ev["longitude"], 8),
                    "distance_meters": round(dist_m, 1),
                    "active_at_time": active_now,
                }
            )
        out.sort(key=lambda e: (not e["active_at_time"], e["distance_meters"]))
        return out

    def score_corridor_impact(
        self,
        origin_lat: float,
        origin_lon: float,
        dest_lat: float,
        dest_lon: float,
        mode: str,
        at_time: datetime | None = None,
    ) -> dict[str, Any]:
        ref = at_time or datetime.now(timezone.utc)
        ist_hour = int(((ref.hour + 5) + (ref.minute + 30) / 60.0) % 24)
        mid_lat = (origin_lat + dest_lat) / 2.0
        mid_lon = (origin_lon + dest_lon) / 2.0
        m = mode.lower().strip()

        matched: list[dict[str, Any]] = []
        max_mult = 1.0
        for ev in self._all_events(mid_lat, mid_lon, 12000.0):
            if ist_hour not in ev.get("peak_hours_ist", list(range(24))):
                continue
            d_orig = haversine_m(origin_lat, origin_lon, ev["latitude"], ev["longitude"])
            d_dest = haversine_m(dest_lat, dest_lon, ev["latitude"], ev["longitude"])
            d_mid = haversine_m(mid_lat, mid_lon, ev["latitude"], ev["longitude"])
            min_d = min(d_orig, d_dest, d_mid)
            if min_d <= ev["radius_m"] * 1.4:
                affected = m in ev.get("affected_modes", [])
                mult = ev["road_delay_multiplier"] if affected else 1.0
                if m == "metro" and ev.get("metro_unaffected", True):
                    mult = 1.0
                if mult > max_mult:
                    max_mult = mult
                matched.append(
                    {
                        "event_id": ev["event_id"],
                        "title": ev["title"],
                        "severity": ev["severity"],
                        "advisory": ev["advisory"],
                        "affects_mode": affected,
                        "delay_multiplier": round(mult, 2),
                    }
                )

        return {
            "event_multiplier": round(max_mult, 2),
            "events": matched,
            "model_version": self.model_version,
        }
