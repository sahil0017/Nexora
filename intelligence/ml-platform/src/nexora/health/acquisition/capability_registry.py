"""Hardware capability registry preventing invalid cross-sensor inference."""

from __future__ import annotations

from nexora.health.acquisition.source_registry import MeasurementStatus, SignalSource

# Explicit map of which physiological modalities a given SignalSource can validly measure.
SOURCE_CAPABILITIES: dict[SignalSource, set[str]] = {
    SignalSource.PHONE_IMU: {"device_orientation", "actigraphy", "experimental_respiration_motion"},
    SignalSource.WEARABLE_PPG: {"ppg_pulsatility", "pulse_rate", "hrv_ibi"},
    SignalSource.WEARABLE_ECG: {"ecg_r_peaks", "heart_rate", "hrv_rmssd"},
    SignalSource.EEG: {"eeg_delta_power", "eeg_slow_oscillation", "eeg_spindles", "sleep_stages"},
    SignalSource.RESPIRATORY_BELT: {"respiratory_rate", "respiratory_variability"},
    SignalSource.MRI: {"dti_alps_index", "csf_pulsatile_velocity_cm_s", "bold_csf_coupling_r", "pvs_burden"},
    SignalSource.HEALTHKIT: {"sleep_stages", "heart_rate", "hrv_sdnn", "respiratory_rate"},
    SignalSource.HEALTH_CONNECT: {"sleep_stages", "heart_rate", "hrv_rmssd", "respiratory_rate"},
    SignalSource.SYNTHETIC_LAB: {"device_orientation", "actigraphy", "experimental_respiration_motion"},
}


def can_source_measure(source: SignalSource, modality: str) -> bool:
    return modality in SOURCE_CAPABILITIES.get(source, set())


def resolve_measurement_status(
    source: SignalSource,
    modality: str,
    quality_score: float,
    is_simulated: bool = False,
) -> MeasurementStatus:
    if is_simulated or source == SignalSource.SYNTHETIC_LAB:
        return MeasurementStatus.SIMULATED
    if not can_source_measure(source, modality):
        return MeasurementStatus.UNAVAILABLE
    if quality_score < 0.35:
        return MeasurementStatus.INVALID_QUALITY
    if modality == "experimental_respiration_motion":
        return MeasurementStatus.ESTIMATED
    return MeasurementStatus.MEASURED
