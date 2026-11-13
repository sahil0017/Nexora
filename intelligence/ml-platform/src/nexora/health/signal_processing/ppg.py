"""Optical PPG signal processing (wearable/clinical optical sensor required; never phone IMU)."""

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
from nexora.health.signal_processing.quality import bandpower_fft, dominant_freq_hz


def _estimate_ibi_rmssd_ms(signal: np.ndarray, sample_rate_hz: float) -> float | None:
    if len(signal) < max(20, int(sample_rate_hz * 2.5)) or sample_rate_hz <= 0:
        return None
    centered = signal - np.mean(signal)
    std = float(np.std(centered))
    if std < 1e-7:
        return None
    min_dist = max(1, int(0.42 * sample_rate_hz))
    peaks: list[int] = []
    last_peak = -min_dist
    for i in range(1, len(centered) - 1):
        if centered[i] > centered[i - 1] and centered[i] >= centered[i + 1] and centered[i] > 0.25 * std:
            if i - last_peak >= min_dist:
                peaks.append(i)
                last_peak = i
    if len(peaks) < 3:
        return None
    ibi_ms = np.diff(np.array(peaks, dtype=np.float64)) * (1000.0 / sample_rate_hz)
    valid = ibi_ms[(ibi_ms >= 400.0) & (ibi_ms <= 1500.0)]
    if len(valid) < 2:
        return None
    return round(float(np.clip(np.sqrt(np.mean(np.diff(valid) ** 2)), 8.0, 140.0)), 2)


def process_ppg_window(
    frames: list[dict[str, Any]],
    sample_rate_hz: float = 25.0,
    source_device: str = "wearable_optical_ppg",
    is_simulated: bool = False,
) -> dict[str, ProvenancedFeature]:
    ppg_vals = [f.get("ppg") for f in frames if f.get("ppg") is not None]
    if len(ppg_vals) < 16:
        prov = FeatureProvenance(
            source_device=source_device,
            signal_source=SignalSource.WEARABLE_PPG,
            sampling_rate_hz=sample_rate_hz,
            timestamp_accuracy_ms=15.0,
            placement_protocol="wrist_or_finger_optical",
            calibration_status="unavailable",
            signal_quality_score=0.0,
            measurement_status=MeasurementStatus.UNAVAILABLE,
            algorithm_version="ppg_v2.0",
            missing_reason="No optical PPG channel present; cardiac pulsatility and HRV are not inferred from phone IMU.",
        )
        return {
            "ppg_pulsatility_index": ProvenancedFeature("ppg_pulsatility_index", None, "ratio", prov),
            "pulse_rate_bpm": ProvenancedFeature("pulse_rate_bpm", None, "bpm", prov),
            "hrv_rmssd_ms": ProvenancedFeature("hrv_rmssd_ms", None, "ms", prov),
        }

    sig = np.array(ppg_vals, dtype=np.float64)
    src = SignalSource.SYNTHETIC_LAB if is_simulated else SignalSource.WEARABLE_PPG
    freq = dominant_freq_hz(sig, sample_rate_hz, 0.70, 2.3)
    cardiac_power = bandpower_fft(sig, sample_rate_hz, 0.70, 2.5)
    total_power = max(bandpower_fft(sig, sample_rate_hz, 0.1, min(sample_rate_hz / 2.0 - 0.1, 10.0)), 1e-9)
    quality = round(float(np.clip(cardiac_power / total_power, 0.1, 0.96)), 4)

    status = resolve_measurement_status(src, "ppg_pulsatility", quality, is_simulated)
    pulsatility = round(float(np.clip(np.tanh((cardiac_power / total_power) * 2.2), 0.05, 1.2)), 4)
    hr_bpm = round(float(np.clip(freq * 60.0, 40.0, 140.0)), 2) if freq else None
    rmssd = _estimate_ibi_rmssd_ms(sig, sample_rate_hz)

    prov = FeatureProvenance(
        source_device=source_device,
        signal_source=src,
        sampling_rate_hz=sample_rate_hz,
        timestamp_accuracy_ms=5.0,
        placement_protocol="wrist_or_finger_optical",
        calibration_status="optical_ppg",
        signal_quality_score=quality,
        measurement_status=status,
        algorithm_version="ppg_v2.0",
    )
    return {
        "ppg_pulsatility_index": ProvenancedFeature("ppg_pulsatility_index", pulsatility, "ratio", prov),
        "pulse_rate_bpm": ProvenancedFeature("pulse_rate_bpm", hr_bpm, "bpm", prov),
        "hrv_rmssd_ms": ProvenancedFeature("hrv_rmssd_ms", rmssd, "ms", prov),
    }
