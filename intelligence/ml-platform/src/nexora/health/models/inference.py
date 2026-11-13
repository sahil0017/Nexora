"""Staged, quality-aware, missing-modality-aware research inference pipeline."""

from __future__ import annotations

from typing import Any

import numpy as np

from nexora.health.acquisition import SignalSource
from nexora.health.models.baseline import predict_m0_linear
from nexora.health.models.state_space import filter_m1_state_space
from nexora.health.models.uncertainty import estimate_uncertainty
from nexora.health.physiology import estimate_physiological_hypotheses
from nexora.health.provenance import CLAIM_GUARDRAIL, build_limitations
from nexora.health.signal_processing import (
    process_eeg_window,
    process_imu_window,
    process_ppg_window,
    process_respiration_window,
)

MODEL_VERSION = "0.2.0-staged"


class ResearchInferenceEngine:
    """Separates sensor measurement, physiological state inference, and MRI validation."""

    def process_measurement_window(self, body: dict[str, Any]) -> dict[str, Any]:
        frames = list(body.get("frames") or [])
        sample_rate_hz = float(body.get("sample_rate_hz", 25.0))
        is_simulated = bool(body.get("is_simulated", False))
        source_device = str(body.get("source_device", "mobile_device"))

        imu_feats = process_imu_window(frames, sample_rate_hz=sample_rate_hz, source_device=source_device, is_simulated=is_simulated)
        resp_feats = process_respiration_window(frames, sample_rate_hz=sample_rate_hz, source_device=source_device, is_simulated=is_simulated)
        ppg_feats = process_ppg_window(frames, sample_rate_hz=sample_rate_hz, source_device=source_device, is_simulated=is_simulated)
        eeg_feats = process_eeg_window(
            body.get("eeg_samples"),
            sample_rate_hz=float(body.get("eeg_sample_rate_hz", 128.0)),
            source_device=source_device,
            is_simulated=is_simulated,
        )

        all_features = {**imu_feats, **resp_feats, **ppg_feats, **eeg_feats}
        available_modalities: list[str] = []
        missing_modalities: list[str] = []

        if imu_feats["device_orientation"].value is not None:
            available_modalities.append(SignalSource.SYNTHETIC_LAB.value if is_simulated else SignalSource.PHONE_IMU.value)
        if ppg_feats["ppg_pulsatility_index"].value is not None:
            available_modalities.append(SignalSource.WEARABLE_PPG.value)
        else:
            missing_modalities.append(SignalSource.WEARABLE_PPG.value)
        if eeg_feats["eeg_delta_ratio"].value is not None:
            available_modalities.append(SignalSource.EEG.value)
        else:
            missing_modalities.append(SignalSource.EEG.value)
        if resp_feats["respiratory_rate_bpm"].provenance.signal_source == SignalSource.RESPIRATORY_BELT:
            available_modalities.append(SignalSource.RESPIRATORY_BELT.value)
        else:
            missing_modalities.append(SignalSource.RESPIRATORY_BELT.value)
        missing_modalities.append(SignalSource.MRI.value)

        return {
            "features": {k: v.to_dict() for k, v in all_features.items()},
            "available_modalities": available_modalities,
            "missing_modalities": missing_modalities,
            "is_simulated": is_simulated,
            "limitations": build_limitations(available_modalities, missing_modalities, has_simulated=is_simulated),
            "claim_guardrail": CLAIM_GUARDRAIL,
        }

    def infer_research_state(self, body: dict[str, Any]) -> dict[str, Any]:
        stage = str(body.get("model_stage", "M1"))
        is_simulated = bool(body.get("is_simulated", False))
        frames = list(body.get("frames") or [])

        # Gather explicit observed modalities without fabricating missing ones
        observed: dict[str, float | str | None] = {
            "eeg_delta_ratio": body.get("eeg_delta_ratio"),
            "n3_fraction": body.get("n3_fraction"),
            "sleep_fragmentation_index": body.get("sleep_fragmentation_index"),
            "ppg_pulsatility_index": body.get("ppg_pulsatility_index") or body.get("cardiac_pulsatility_index"),
            "hrv_rmssd_ms": body.get("hrv_rmssd_ms"),
            "respiratory_rate_bpm": body.get("respiratory_rate_bpm"),
            "device_orientation": body.get("device_orientation") or body.get("posture"),
        }

        available_modalities: list[str] = []
        missing_modalities: list[str] = []

        if frames:
            meas = self.process_measurement_window(body)
            feats = meas["features"]
            if observed["device_orientation"] is None:
                observed["device_orientation"] = feats["device_orientation"]["value"]
            if observed["respiratory_rate_bpm"] is None:
                observed["respiratory_rate_bpm"] = feats["respiratory_rate_bpm"]["value"]
            if observed["ppg_pulsatility_index"] is None:
                observed["ppg_pulsatility_index"] = feats["ppg_pulsatility_index"]["value"]
            if observed["hrv_rmssd_ms"] is None:
                observed["hrv_rmssd_ms"] = feats["hrv_rmssd_ms"]["value"]
            if observed["eeg_delta_ratio"] is None:
                observed["eeg_delta_ratio"] = feats["eeg_delta_ratio"]["value"]
            available_modalities = meas["available_modalities"]
            missing_modalities = meas["missing_modalities"]
        else:
            if observed["device_orientation"] is not None:
                available_modalities.append("phone_imu")
            if observed["ppg_pulsatility_index"] is not None or observed["hrv_rmssd_ms"] is not None:
                available_modalities.append("wearable_ppg")
            else:
                missing_modalities.append("wearable_ppg")
            if observed["eeg_delta_ratio"] is not None or observed["n3_fraction"] is not None:
                available_modalities.append("eeg")
            else:
                missing_modalities.append("eeg")
            if observed["respiratory_rate_bpm"] is None:
                missing_modalities.append("respiratory_belt")
            if not body.get("mri_calibrated", False):
                missing_modalities.append("mri")

        signal_quality_score = float(body.get("signal_quality_score", 0.72 if available_modalities else 0.35))
        quality_label = "high" if signal_quality_score >= 0.78 else "moderate" if signal_quality_score >= 0.45 else "low"

        # Stage M0: Linear baseline
        m0_val = predict_m0_linear(
            {
                "eeg_delta_ratio": observed["eeg_delta_ratio"] if isinstance(observed["eeg_delta_ratio"], (int, float)) else None,
                "n3_fraction": observed["n3_fraction"] if isinstance(observed["n3_fraction"], (int, float)) else None,
                "ppg_pulsatility_index": observed["ppg_pulsatility_index"] if isinstance(observed["ppg_pulsatility_index"], (int, float)) else None,
                "hrv_rmssd_ms": observed["hrv_rmssd_ms"] if isinstance(observed["hrv_rmssd_ms"], (int, float)) else None,
                "respiratory_rate_bpm": observed["respiratory_rate_bpm"] if isinstance(observed["respiratory_rate_bpm"], (int, float)) else None,
            }
        )

        # Physiological hypothesis decomposition
        phys_hyp = estimate_physiological_hypotheses(observed)
        hyp_val = float(phys_hyp["sleep_physiology_state"])

        # Stage M1: State-space filter over prior + current
        prior_obs = [float(v) for v in (body.get("prior_state_series") or [])]
        m1_out = filter_m1_state_space(prior_obs + [0.5 * m0_val + 0.5 * hyp_val])
        point_val = m0_val if stage == "M0" else m1_out["filtered_mean"]

        unc = estimate_uncertainty(
            ensemble_predictions=[m0_val, hyp_val, m1_out["filtered_mean"]],
            available_modalities=available_modalities,
            signal_quality_score=signal_quality_score,
            missing_count=len(missing_modalities),
        )
        ci_low = round(float(np.clip(point_val - 1.96 * unc["total_std"], 0.0, 1.0)), 4)
        ci_high = round(float(np.clip(point_val + 1.96 * unc["total_std"], 0.0, 1.0)), 4)

        # N3-associated feature sensitivity (renamed from ambiguous clearance sensitivity)
        n3_cur = float(observed["n3_fraction"]) if isinstance(observed["n3_fraction"], (int, float)) else 0.15
        n3_pert = predict_m0_linear({"n3_fraction": min(0.6, n3_cur + 0.10)}) - predict_m0_linear({"n3_fraction": n3_cur})

        return {
            "research_estimate": {
                "target": "sleep_physiology_state",
                "value": round(point_val, 4),
                "unit": "normalized_research_scale",
                "confidence_interval": [ci_low, ci_high],
                "uncertainty": {
                    "epistemic": unc["epistemic"],
                    "aleatoric": unc["aleatoric"],
                },
            },
            "evidence": {
                "available_modalities": available_modalities,
                "missing_modalities": missing_modalities,
                "signal_quality": quality_label,
                "signal_quality_score": round(signal_quality_score, 4),
            },
            "physiological_hypotheses": phys_hyp,
            "n3_associated_feature_sensitivity": round(n3_pert, 4),
            "limitations": build_limitations(available_modalities, missing_modalities, has_simulated=is_simulated),
            "model_stage": stage,
            "model_version": MODEL_VERSION,
            "claim_guardrail": CLAIM_GUARDRAIL,
        }
