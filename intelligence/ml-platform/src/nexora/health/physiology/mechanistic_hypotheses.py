"""Physiological state & mechanistic hypothesis estimation (separate from MRI measurement).

Peripheral & sleep physiology signals are mapped to physiological state hypotheses
(cardiorespiratory coupling, slow-wave neurovascular proxy, orientation conductance)
with explicit missingness masks—never pretending to directly calculate MRI indices.
"""

from __future__ import annotations

from typing import Any

import numpy as np

ORIENTATION_CONDUCTANCE: dict[str, float] = {
    "lateral_right_proxy": 1.04,
    "lateral_left_proxy": 1.02,
    "face_up_supine_proxy": 0.96,
    "face_down_prone_proxy": 0.88,
    "upright_device": 0.65,
    "unknown": 0.85,
}


def estimate_physiological_hypotheses(
    observed: dict[str, float | str | None],
    quality_weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Compute quality-weighted physiological state drivers without inventing missing modalities."""
    qw = quality_weights or {}
    missing: list[str] = []
    available: list[str] = []

    # 1. Slow-wave neurovascular state (only if EEG delta or N3 architecture present)
    eeg_delta = observed.get("eeg_delta_ratio")
    n3_frac = observed.get("n3_fraction")
    frag = float(observed.get("sleep_fragmentation_index") or 0.18)
    continuity = float(np.clip(1.0 - 0.65 * frag, 0.2, 1.0))

    slow_wave_state: float | None = None
    if eeg_delta is not None or n3_frac is not None:
        available.append("eeg_sleep_architecture")
        d_val = float(eeg_delta) if eeg_delta is not None else 0.0
        n3_val = float(n3_frac) if n3_frac is not None else 0.0
        w_sum = (0.65 if eeg_delta is not None else 0.0) + (0.35 if n3_frac is not None else 0.0)
        raw = ((0.65 * d_val) + (0.35 * (n3_val / 0.28))) / max(w_sum, 1e-6)
        slow_wave_state = round(float(np.clip(raw * continuity, 0.05, 1.25)), 4)
    else:
        missing.append("eeg_sleep_architecture")

    # 2. Cardiorespiratory autonomic coupling (only if PPG/ECG or respiration present)
    pulsatility = observed.get("ppg_pulsatility_index")
    rmssd = observed.get("hrv_rmssd_ms")
    resp_rate = observed.get("respiratory_rate_bpm")

    cardiac_state: float | None = None
    if pulsatility is not None or rmssd is not None:
        available.append("cardiac_autonomic")
        vagal = float(np.clip(np.log1p(float(rmssd)) / np.log1p(100.0), 0.2, 1.15)) if rmssd is not None else 0.0
        pulse = float(np.clip(float(pulsatility), 0.05, 1.3)) if pulsatility is not None else 0.0
        if pulsatility is not None and rmssd is not None:
            cardiac_state = round(float(np.clip(0.55 * pulse + 0.45 * vagal, 0.1, 1.3)), 4)
        else:
            cardiac_state = round(float(pulse if pulsatility is not None else vagal), 4)
    else:
        missing.append("cardiac_autonomic")

    resp_state: float | None = None
    if resp_rate is not None:
        available.append("respiration")
        r_opt = float(np.exp(-((float(resp_rate) - 13.0) ** 2) / (2.0 * 5.5**2)))
        resp_state = round(float(np.clip(r_opt, 0.1, 1.1)), 4)
    else:
        missing.append("respiration")

    # 3. Orientation / motion context (from IMU)
    orientation = str(observed.get("device_orientation") or "unknown")
    orientation_factor = ORIENTATION_CONDUCTANCE.get(orientation, 0.85)
    if orientation != "unknown":
        available.append("device_orientation")
    else:
        missing.append("device_orientation")

    # Quality-weighted physiological state aggregate over ONLY available components
    weighted_sum = 0.0
    total_weight = 0.0
    if slow_wave_state is not None:
        w = 0.42 * float(qw.get("eeg", 0.9))
        weighted_sum += w * slow_wave_state
        total_weight += w
    if cardiac_state is not None:
        w = 0.34 * float(qw.get("ppg", 0.85))
        weighted_sum += w * cardiac_state
        total_weight += w
    if resp_state is not None:
        w = 0.24 * float(qw.get("resp", 0.65))
        weighted_sum += w * resp_state
        total_weight += w

    if total_weight > 0:
        phys_state = float(np.clip((weighted_sum / total_weight) * orientation_factor, 0.05, 1.0))
    else:
        # Phone-only orientation/motion fallback: explicitly bounded low-information state
        phys_state = float(np.clip(0.35 * orientation_factor, 0.15, 0.55))

    return {
        "sleep_physiology_state": round(phys_state, 4),
        "available_components": available,
        "missing_components": missing,
        "hypotheses": {
            "slow_wave_neurovascular_proxy": slow_wave_state,
            "cardiac_autonomic_coupling": cardiac_state,
            "respiratory_modulation_proxy": resp_state,
            "orientation_conductance_factor": orientation_factor,
        },
    }
