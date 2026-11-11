"""Layer 2: Geospatial indexing (H3), trajectory processing (MovingPandas-style),
and density-based hotspot discovery (HDBSCAN-style).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

try:
    import h3 as _h3  # type: ignore
except Exception:  # pragma: no cover - optional C extension
    _h3 = None


# Approximate edge length in degrees for resolutions 6..10 when native h3 is absent.
_RES_DEG = {6: 0.032, 7: 0.012, 8: 0.0046, 9: 0.0017, 10: 0.00065}


def latlon_to_h3(lat: float, lon: float, resolution: int = 8) -> str:
    """Convert WGS84 (lat, lon) to an H3 cell index at the requested resolution."""
    if _h3 is not None:
        if hasattr(_h3, "latlng_to_cell"):
            return str(_h3.latlng_to_cell(lat, lon, resolution))
        return str(_h3.geo_to_h3(lat, lon, resolution))

    step = _RES_DEG.get(resolution, 0.0046)
    # Axial hex grid projection (pointy-top hexes)
    q_f = (math.sqrt(3.0) / 3.0 * lon - 1.0 / 3.0 * lat) / step
    r_f = (2.0 / 3.0 * lat) / step
    q, r = _axial_round(q_f, r_f)
    return f"h3r{resolution}_{q:+d}_{r:+d}"


def h3_to_latlon(cell: str) -> tuple[float, float]:
    """Return the (lat, lon) centroid of an H3 cell index."""
    if _h3 is not None and not cell.startswith("h3r"):
        if hasattr(_h3, "cell_to_latlng"):
            lat, lon = _h3.cell_to_latlng(cell)
            return float(lat), float(lon)
        lat, lon = _h3.h3_to_geo(cell)
        return float(lat), float(lon)

    try:
        prefix, q_s, r_s = cell.split("_")
        res = int(prefix.replace("h3r", ""))
        q, r = int(q_s), int(r_s)
        step = _RES_DEG.get(res, 0.0046)
        lat = step * (1.5 * r)
        lon = step * (math.sqrt(3.0) * (q + 0.5 * r))
        return round(lat, 6), round(lon, 6)
    except Exception:
        return 17.385, 78.486


def h3_neighbors(cell: str, k: int = 1) -> list[str]:
    """Return the k-ring neighborhood of an H3 cell."""
    if _h3 is not None and not cell.startswith("h3r"):
        if hasattr(_h3, "grid_disk"):
            return [str(c) for c in _h3.grid_disk(cell, k)]
        return [str(c) for c in _h3.k_ring(cell, k)]

    try:
        prefix, q_s, r_s = cell.split("_")
        q0, r0 = int(q_s), int(r_s)
        out: list[str] = []
        for dq in range(-k, k + 1):
            for dr in range(max(-k, -dq - k), min(k, -dq + k) + 1):
                out.append(f"{prefix}_{q0 + dq:+d}_{r0 + dr:+d}")
        return out
    except Exception:
        return [cell]


def _axial_round(q_f: float, r_f: float) -> tuple[int, int]:
    s_f = -q_f - r_f
    q, r, s = round(q_f), round(r_f), round(s_f)
    q_diff, r_diff, s_diff = abs(q - q_f), abs(r - r_f), abs(s - s_f)
    if q_diff > r_diff and q_diff > s_diff:
        q = -r - s
    elif r_diff > s_diff:
        r = -q - s
    return int(q), int(r)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two WGS84 points."""
    rad = math.pi / 180.0
    dlat = (lat2 - lat1) * rad
    dlon = (lon2 - lon1) * rad
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2.0) ** 2
    )
    return 2.0 * 6_371_000.0 * math.asin(min(1.0, math.sqrt(a)))


def clean_trajectory(samples: list[dict[str, Any]], max_speed_mps: float = 42.0) -> dict[str, Any]:
    """MovingPandas-style trajectory cleaning: spike removal, smoothing, and stop detection."""
    if not samples:
        return {"cleaned": [], "stops": [], "outliers_removed": 0}

    cleaned: list[dict[str, Any]] = []
    stops: list[dict[str, Any]] = []
    outliers = 0

    for pt in samples:
        lat = float(pt.get("latitude", 0.0))
        lon = float(pt.get("longitude", 0.0))
        spd = float(pt.get("speed_mps") or 0.0)
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or spd > max_speed_mps:
            outliers += 1
            continue
        if cleaned:
            prev = cleaned[-1]
            # Exponential smoothing to reduce GPS jitter
            lat = 0.75 * lat + 0.25 * prev["latitude"]
            lon = 0.75 * lon + 0.25 * prev["longitude"]
        item = {
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "speed_mps": round(spd, 2),
            "h3_index": latlon_to_h3(lat, lon, 8),
        }
        cleaned.append(item)
        if spd < 0.8:
            stops.append(item)

    return {
        "cleaned": cleaned,
        "stops": stops,
        "outliers_removed": outliers,
    }


def discover_hotspots(
    points: list[dict[str, Any]],
    resolution: int = 8,
    min_samples: int = 2,
    eps_meters: float = 650.0,
) -> list[dict[str, Any]]:
    """HDBSCAN-inspired mutual-reachability density clustering over H3 cells."""
    if not points:
        return []

    cell_buckets: dict[str, list[dict[str, Any]]] = {}
    for pt in points:
        lat = float(pt.get("latitude", 0.0))
        lon = float(pt.get("longitude", 0.0))
        if lat == 0.0 and lon == 0.0:
            continue
        cell = pt.get("h3_index") or latlon_to_h3(lat, lon, resolution)
        cell_buckets.setdefault(str(cell), []).append(pt)

    cells: list[dict[str, Any]] = []
    for cell, obs in cell_buckets.items():
        lats = [float(x.get("latitude", 0.0)) for x in obs]
        lons = [float(x.get("longitude", 0.0)) for x in obs]
        speeds = [float(x.get("speed_kph", x.get("speed_mps", 6.0) * 3.6)) for x in obs]
        avg_spd = float(np.mean(speeds)) if speeds else 25.0
        # Congestion score in [0, 1]: slower speed + higher density => higher hotspot severity
        slowdown = max(0.0, min(1.0, (40.0 - avg_spd) / 35.0))
        density_boost = min(0.35, 0.05 * len(obs))
        congestion_score = round(min(1.0, slowdown * 0.75 + density_boost), 3)
        cells.append(
            {
                "h3_index": cell,
                "latitude": round(float(np.mean(lats)), 6),
                "longitude": round(float(np.mean(lons)), 6),
                "sample_count": len(obs),
                "avg_speed_kph": round(avg_spd, 2),
                "congestion_score": congestion_score,
            }
        )

    # Connected-component clustering over dense cells within eps_meters (HDBSCAN condensed tree core)
    dense_idx = [i for i, c in enumerate(cells) if c["sample_count"] >= min_samples or c["congestion_score"] >= 0.45]
    visited: set[int] = set()
    cluster_id = 0

    for i in dense_idx:
        if i in visited:
            continue
        cluster_id += 1
        queue = [i]
        visited.add(i)
        while queue:
            cur = queue.pop(0)
            cells[cur]["hotspot_cluster"] = cluster_id
            for j in dense_idx:
                if j not in visited:
                    d = haversine_m(
                        cells[cur]["latitude"],
                        cells[cur]["longitude"],
                        cells[j]["latitude"],
                        cells[j]["longitude"],
                    )
                    if d <= eps_meters:
                        visited.add(j)
                        queue.append(j)

    for c in cells:
        c.setdefault("hotspot_cluster", None)

    cells.sort(key=lambda x: (x["congestion_score"], x["sample_count"]), reverse=True)
    return cells
