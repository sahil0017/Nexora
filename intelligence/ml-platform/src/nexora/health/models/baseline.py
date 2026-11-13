"""M0: Linear / mixed-effects statistical baseline for sleep physiology state estimation."""

from __future__ import annotations

import numpy as np


def predict_m0_linear(
    features: dict[str, float | None],
    participant_random_intercept: float = 0.0,
) -> float:
    """Compute missing-aware linear baseline over standardized observed physiological features."""
    weights = {
        "eeg_delta_ratio": 0.38,
        "n3_fraction": 0.24,
        "ppg_pulsatility_index": 0.20,
        "hrv_rmssd_ms": 0.14,
        "respiratory_rate_bpm": 0.12,
    }
    score = 0.0
    active_weight = 0.0

    if features.get("eeg_delta_ratio") is not None:
        score += weights["eeg_delta_ratio"] * float(np.clip(float(features["eeg_delta_ratio"]), 0.0, 1.0))
        active_weight += weights["eeg_delta_ratio"]
    if features.get("n3_fraction") is not None:
        score += weights["n3_fraction"] * float(np.clip(float(features["n3_fraction"]) / 0.28, 0.0, 1.0))
        active_weight += weights["n3_fraction"]
    if features.get("ppg_pulsatility_index") is not None:
        score += weights["ppg_pulsatility_index"] * float(np.clip(float(features["ppg_pulsatility_index"]), 0.0, 1.0))
        active_weight += weights["ppg_pulsatility_index"]
    if features.get("hrv_rmssd_ms") is not None:
        norm_hrv = float(np.clip(np.log1p(float(features["hrv_rmssd_ms"])) / np.log1p(100.0), 0.0, 1.0))
        score += weights["hrv_rmssd_ms"] * norm_hrv
        active_weight += weights["hrv_rmssd_ms"]
    if features.get("respiratory_rate_bpm") is not None:
        r_opt = float(np.exp(-((float(features["respiratory_rate_bpm"]) - 13.0) ** 2) / 32.0))
        score += weights["respiratory_rate_bpm"] * r_opt
        active_weight += weights["respiratory_rate_bpm"]

    if active_weight <= 1e-6:
        base = 0.32
    else:
        base = score / active_weight
    return round(float(np.clip(base + participant_random_intercept, 0.05, 0.98)), 4)
