"""Phone/wearable IMU signal processing: device orientation and actigraphy ONLY.

Does NOT infer cardiac BCG, HRV, PPG pulsatility, or EEG from IMU motion.
"""

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
from nexora.health.signal_processing.quality import compute_imu_quality


def classify_device_orientation(ax: float, ay: float, az: float) -> str:
    """Estimate device orientation from 3-axis gravity vector (not necessarily body posture)."""
    vec = np.array([ax, ay, az], dtype=np.float64)
    norm = float(np.linalg.norm(vec))
    if norm < 1e-6:
        return "unknown"
    gx, gy, gz = vec / norm
    if abs(gy) > 0.72:
        return "upright_device"
    if gz > 0.65:
        return "face_up_supine_proxy"
    if gz < -0.65:
        return "face_down_prone_proxy"
    if gx > 0.55:
        return "lateral_right_proxy"
    if gx < -0.55:
        return "lateral_left_proxy"
    return "face_up_supine_proxy" if gz >= 0 else "lateral_left_proxy"


def process_imu_window(
    frames: list[dict[str, Any]],
    sample_rate_hz: float = 25.0,
    source_device: str = "mobile_imu",
    is_simulated: bool = False,
) -> dict[str, ProvenancedFeature]:
    signal_source = SignalSource.SYNTHETIC_LAB if is_simulated else SignalSource.PHONE_IMU

    if not frames:
        prov = FeatureProvenance(
            source_device=source_device,
            signal_source=signal_source,
            sampling_rate_hz=sample_rate_hz,
            timestamp_accuracy_ms=20.0,
            placement_protocol="unspecified",
            calibration_status="uncalibrated",
            signal_quality_score=0.0,
            measurement_status=MeasurementStatus.UNAVAILABLE,
            algorithm_version="imu_v2.0",
            missing_reason="No IMU frames supplied.",
        )
        return {
            "device_orientation": ProvenancedFeature("device_orientation", None, "category", prov),
            "actigraphy_rms": ProvenancedFeature("actigraphy_rms", None, "m/s^2", prov),
        }

    ax = np.array([float(f.get("ax", 0.0)) for f in frames], dtype=np.float64)
    ay = np.array([float(f.get("ay", 0.0)) for f in frames], dtype=np.float64)
    az = np.array([float(f.get("az", 9.81)) for f in frames], dtype=np.float64)
    mag = np.sqrt(ax**2 + ay**2 + az**2)
    actigraphy_rms = round(float(np.sqrt(np.mean((mag - np.mean(mag)) ** 2))), 4)
    quality = compute_imu_quality(len(frames), actigraphy_rms)
    orientation = classify_device_orientation(float(np.mean(ax)), float(np.mean(ay)), float(np.mean(az)))

    orient_status = resolve_measurement_status(signal_source, "device_orientation", quality, is_simulated)
    act_status = resolve_measurement_status(signal_source, "actigraphy", quality, is_simulated)

    orient_prov = FeatureProvenance(
        source_device=source_device,
        signal_source=signal_source,
        sampling_rate_hz=sample_rate_hz,
        timestamp_accuracy_ms=10.0,
        placement_protocol="bedside_or_chest_unspecified",
        calibration_status="gravity_normalized",
        signal_quality_score=quality,
        measurement_status=orient_status,
        algorithm_version="imu_v2.0",
    )
    act_prov = FeatureProvenance(
        source_device=source_device,
        signal_source=signal_source,
        sampling_rate_hz=sample_rate_hz,
        timestamp_accuracy_ms=10.0,
        placement_protocol="bedside_or_chest_unspecified",
        calibration_status="factory_imu",
        signal_quality_score=quality,
        measurement_status=act_status,
        algorithm_version="imu_v2.0",
    )

    return {
        "device_orientation": ProvenancedFeature(
            name="device_orientation",
            value=orientation,
            unit="category",
            provenance=orient_prov,
            limitations=["Phone IMU estimates device orientation, not necessarily anatomical body posture."],
        ),
        "actigraphy_rms": ProvenancedFeature(
            name="actigraphy_rms",
            value=actigraphy_rms,
            unit="m/s^2",
            provenance=act_prov,
        ),
    }
