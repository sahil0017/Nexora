"""NEXORA inference API.

Module-scoped prediction endpoints. The road ST-GNN arrives in M5;
until then every endpoint returns deterministic baseline predictions
so the Go backend can integrate end-to-end.
"""

from fastapi import FastAPI

app = FastAPI(
    title="NEXORA Intelligence Service",
    version="0.1.0",
    description="ETA prediction, traffic forecasting and module intelligence.",
)


@app.get("/healthz")
def health() -> dict:
    return {"status": "ok", "service": "nexora-ml", "version": "0.1.0"}


class JourneyPredictionRequest(dict):
    pass


@app.post("/v1/predict/journey")
def predict_journey(body: dict) -> dict:
    """Baseline ETA prediction for a candidate route.

    Body: {"segment_ids": [...], "mode": "car", "departure_time": "..."}
    Returns p50/p90 duration with model version metadata.
    """
    segments = body.get("segment_ids", [])
    mode = body.get("mode", "car")
    base_speed = {"car": 30.0, "two_wheeler": 28.0, "bus": 18.0}.get(mode, 25.0)
    # Deterministic placeholder: assume 500m average segment length.
    distance_km = len(segments) * 0.5
    p50 = int((distance_km / base_speed) * 3600)
    return {
        "p50_seconds": max(p50, 60),
        "p90_seconds": max(int(p50 * 1.3), 90),
        "model_version": "baseline-v0",
        "uncertainty": {"horizon_minutes": 60, "calibrated": False},
    }


@app.post("/v1/predict/traffic")
def predict_traffic(body: dict) -> dict:
    """Segment-level speed forecast (15/30/60/120 min horizons)."""
    segment_ids = body.get("segment_ids", [])
    return {
        "predictions": [
            {
                "segment_id": sid,
                "speed_kph": 30.0,
                "horizons_minutes": [15, 30, 60, 120],
                "model_version": "baseline-v0",
            }
            for sid in segment_ids
        ]
    }
