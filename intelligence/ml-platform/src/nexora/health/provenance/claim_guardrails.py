"""Scientific claim guardrails and dynamic limitation reporting."""

from __future__ import annotations

CLAIM_GUARDRAIL = (
    "Research surrogate only. NEXORA never claims to measure or improve brain waste "
    "clearance from ordinary smartwatch sleep scores or standalone smartphone sensors."
)


def build_limitations(
    available_modalities: list[str],
    missing_modalities: list[str],
    has_simulated: bool = False,
) -> list[str]:
    limitations: list[str] = ["No direct CSF or brain-clearance measurement"]
    if "eeg" in missing_modalities:
        limitations.append("No EEG slow-wave or sleep-stage measurement")
    if "wearable_ppg" in missing_modalities and "wearable_ecg" in missing_modalities:
        limitations.append("No validated PPG/ECG cardiac pulsatility or beat-to-beat HRV measurement")
    if "respiratory_belt" in missing_modalities:
        limitations.append("No calibrated respiratory belt reference")
    if "mri" in missing_modalities:
        limitations.append("Not calibrated against paired MRI reference measurements")
    if has_simulated:
        limitations.append("Contains synthetic lab calibration data; exclude from real-world validation")
    if available_modalities == ["phone_imu"]:
        limitations.append("Phone-only IMU session: reflects device orientation and motion only")
    limitations.append("Not validated as a brain-clearance estimate")
    return limitations
