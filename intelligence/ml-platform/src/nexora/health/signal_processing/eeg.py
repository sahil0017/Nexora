"""Clinical/research EEG signal processing (requires dedicated EEG hardware)."""

from __future__ import annotations

import numpy as np

from nexora.health.acquisition import (
    FeatureProvenance,
    MeasurementStatus,
    ProvenancedFeature,
    SignalSource,
    resolve_measurement_status,
)
from nexora.health.signal_processing.quality import bandpower_fft


def process_eeg_window(
    eeg_samples: list[float] | None,
    sample_rate_hz: float = 128.0,
    source_device: str = "research_eeg",
    is_simulated: bool = False,
) -> dict[str, ProvenancedFeature]:
    if not eeg_samples or len(eeg_samples) < 32 or sample_rate_hz < 32.0:
        prov = FeatureProvenance(
            source_device=source_device,
            signal_source=SignalSource.EEG,
            sampling_rate_hz=sample_rate_hz,
            timestamp_accuracy_ms=2.0,
            placement_protocol="frontal_or_10_20_eeg",
            calibration_status="unavailable",
            signal_quality_score=0.0,
            measurement_status=MeasurementStatus.UNAVAILABLE,
            algorithm_version="eeg_v2.0",
            missing_reason="No EEG hardware stream supplied.",
        )
        return {
            "eeg_delta_ratio": ProvenancedFeature("eeg_delta_ratio", None, "ratio", prov),
            "eeg_delta_power_uv2": ProvenancedFeature("eeg_delta_power_uv2", None, "uV^2", prov),
            "eeg_spindle_power_uv2": ProvenancedFeature("eeg_spindle_power_uv2", None, "uV^2", prov),
        }

    sig = np.array(eeg_samples, dtype=np.float64)
    delta = bandpower_fft(sig, sample_rate_hz, 0.5, 4.0)
    spindle = bandpower_fft(sig, sample_rate_hz, 11.0, 16.0)
    total = max(bandpower_fft(sig, sample_rate_hz, 0.3, 35.0), 1e-9)
    delta_ratio = round(float(np.clip(delta / total, 0.0, 1.0)), 4)

    src = SignalSource.SYNTHETIC_LAB if is_simulated else SignalSource.EEG
    quality = 0.88
    status = resolve_measurement_status(src, "eeg_delta_power", quality, is_simulated)
    prov = FeatureProvenance(
        source_device=source_device,
        signal_source=src,
        sampling_rate_hz=sample_rate_hz,
        timestamp_accuracy_ms=2.0,
        placement_protocol="frontal_or_10_20_eeg",
        calibration_status="impedance_checked",
        signal_quality_score=quality,
        measurement_status=status,
        algorithm_version="eeg_v2.0",
    )
    return {
        "eeg_delta_ratio": ProvenancedFeature("eeg_delta_ratio", delta_ratio, "ratio", prov),
        "eeg_delta_power_uv2": ProvenancedFeature("eeg_delta_power_uv2", round(delta, 4), "uV^2", prov),
        "eeg_spindle_power_uv2": ProvenancedFeature("eeg_spindle_power_uv2", round(spindle, 4), "uV^2", prov),
    }
