"""Respiratory signal processing with explicit measured vs experimental-motion provenance."""

from __future__ import annotations

from typing import Any

import numpy as np

from nexora.health.acquisition import (
    FeatureProvenance,
    MeasurementStatus,
    ProvenancedFeature,
    SignalSource,
    resolve_measurement_status,
)
from nexora.health.signal_processing.quality import dominant_freq_hz


def process_respiration_window(
    frames: list[dict[str, Any]],
    sample_rate_hz: float = 25.0,
    source_device: str = "respiratory_sensor",
    is_simulated: bool = False,
) -> dict[str, ProvenancedFeature]:
    resp_vals = [f.get("resp") for f in frames if f.get("resp") is not None]
    has_belt = len(resp_vals) >= 16

    if not frames or (not has_belt and len(frames) < 32):
        prov = FeatureProvenance(
            source_device=source_device,
            signal_source=SignalSource.RESPIRATORY_BELT if has_belt else SignalSource.PHONE_IMU,
            sampling_rate_hz=sample_rate_hz,
            timestamp_accuracy_ms=20.0,
            placement_protocol="thoracic_belt" if has_belt else "phone_chest_controlled",
            calibration_status="uncalibrated",
            signal_quality_score=0.0,
            measurement_status=MeasurementStatus.UNAVAILABLE,
            algorithm_version="resp_v2.0",
            missing_reason="Insufficient respiratory belt or controlled chest-motion samples.",
        )
        return {
            "respiratory_rate_bpm": ProvenancedFeature("respiratory_rate_bpm", None, "breaths/min", prov),
            "respiratory_variability": ProvenancedFeature("respiratory_variability", None, "cv", prov),
        }

    if has_belt:
        sig = np.array(resp_vals, dtype=np.float64)
        src = SignalSource.SYNTHETIC_LAB if is_simulated else SignalSource.RESPIRATORY_BELT
        modality = "respiratory_rate"
        quality = 0.90
        limitations: list[str] = []
    else:
        sig = np.array([float(f.get("az", 9.81)) for f in frames], dtype=np.float64)
        sig = sig - np.mean(sig)
        src = SignalSource.SYNTHETIC_LAB if is_simulated else SignalSource.PHONE_IMU
        modality = "experimental_respiration_motion"
        quality = 0.55
        limitations = ["Experimental estimate from phone motion; validate against respiratory belt reference."]

    freq = dominant_freq_hz(sig, sample_rate_hz, 0.12, 0.45)
    if freq is None:
        status = MeasurementStatus.INVALID_QUALITY
        rate_bpm = None
        var = None
    else:
        status = resolve_measurement_status(src, modality, quality, is_simulated)
        rate_bpm = round(float(np.clip(freq * 60.0, 6.0, 32.0)), 2)
        var = round(float(np.clip(np.std(sig) / (np.mean(np.abs(sig)) + 1e-6), 0.0, 2.0)), 4)

    prov = FeatureProvenance(
        source_device=source_device,
        signal_source=src,
        sampling_rate_hz=sample_rate_hz,
        timestamp_accuracy_ms=10.0,
        placement_protocol="thoracic_belt" if has_belt else "phone_chest_controlled",
        calibration_status="calibrated" if has_belt else "uncalibrated_motion_proxy",
        signal_quality_score=quality if freq is not None else 0.15,
        measurement_status=status,
        algorithm_version="resp_v2.0",
        missing_reason="No dominant respiratory peak in 0.12-0.45 Hz." if freq is None else None,
    )
    return {
        "respiratory_rate_bpm": ProvenancedFeature("respiratory_rate_bpm", rate_bpm, "breaths/min", prov, limitations),
        "respiratory_variability": ProvenancedFeature("respiratory_variability", var, "cv", prov, limitations),
    }
