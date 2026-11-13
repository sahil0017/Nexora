"""Sensor provenance, signal sources, and measurement status types."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class SignalSource(str, Enum):
    PHONE_IMU = "phone_imu"
    WEARABLE_PPG = "wearable_ppg"
    WEARABLE_ECG = "wearable_ecg"
    EEG = "eeg"
    RESPIRATORY_BELT = "respiratory_belt"
    MRI = "mri"
    HEALTHKIT = "healthkit"
    HEALTH_CONNECT = "health_connect"
    SYNTHETIC_LAB = "synthetic_lab"


class MeasurementStatus(str, Enum):
    MEASURED = "measured"
    ESTIMATED = "estimated"
    UNAVAILABLE = "unavailable"
    INVALID_QUALITY = "invalid_quality"
    SIMULATED = "simulated"


@dataclass(frozen=True)
class FeatureProvenance:
    source_device: str
    signal_source: SignalSource
    sampling_rate_hz: float
    timestamp_accuracy_ms: float
    placement_protocol: str
    calibration_status: str
    signal_quality_score: float
    measurement_status: MeasurementStatus
    algorithm_version: str
    missing_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["signal_source"] = self.signal_source.value
        d["measurement_status"] = self.measurement_status.value
        return d


@dataclass(frozen=True)
class ProvenancedFeature:
    name: str
    value: float | str | None
    unit: str
    provenance: FeatureProvenance
    limitations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "unit": self.unit,
            "provenance": self.provenance.to_dict(),
            "limitations": self.limitations,
        }
