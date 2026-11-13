"""Tests for NEXORA Health — 3-Pipeline Architecture (Measurement, Inference, Clinical Validation)."""

from __future__ import annotations

import math

from nexora.health import (
    CLAIM_GUARDRAIL,
    MeasurementStatus,
    ResearchInferenceEngine,
    SignalSource,
    can_source_measure,
    evaluate_cohort_agreement,
    participant_temporal_split,
    process_eeg_window,
    process_imu_window,
    process_ppg_window,
)


def _make_imu_frames(n: int = 125, fs: float = 25.0) -> list[dict[str, float]]:
    frames: list[dict[str, float]] = []
    for i in range(n):
        t = i / fs
        resp = 0.12 * math.sin(2.0 * math.pi * 0.22 * t)
        frames.append({"ax": 0.04, "ay": 0.02, "az": 9.81 + resp})
    return frames


def test_capability_registry_blocks_invalid_cross_sensor_inference() -> None:
    assert can_source_measure(SignalSource.PHONE_IMU, "device_orientation") is True
    assert can_source_measure(SignalSource.PHONE_IMU, "eeg_delta_power") is False
    assert can_source_measure(SignalSource.PHONE_IMU, "ppg_pulsatility") is False
    assert can_source_measure(SignalSource.PHONE_IMU, "hrv_rmssd") is False


def test_imu_and_ppg_provenance_never_fabricates_missing_sensors() -> None:
    frames = _make_imu_frames()
    imu_out = process_imu_window(frames, sample_rate_hz=25.0, is_simulated=False)
    assert imu_out["device_orientation"].value == "face_up_supine_proxy"
    assert imu_out["device_orientation"].provenance.measurement_status == MeasurementStatus.MEASURED

    ppg_out = process_ppg_window(frames, sample_rate_hz=25.0)
    assert ppg_out["ppg_pulsatility_index"].value is None
    assert ppg_out["hrv_rmssd_ms"].value is None
    assert ppg_out["ppg_pulsatility_index"].provenance.measurement_status == MeasurementStatus.UNAVAILABLE

    sim_imu = process_imu_window(frames, sample_rate_hz=25.0, is_simulated=True)
    assert sim_imu["device_orientation"].provenance.measurement_status == MeasurementStatus.SIMULATED


def test_eeg_window_requires_actual_eeg_samples() -> None:
    missing = process_eeg_window(None)
    assert missing["eeg_delta_ratio"].value is None
    assert missing["eeg_delta_ratio"].provenance.measurement_status == MeasurementStatus.UNAVAILABLE

    fs = 128.0
    samples = [25.0 * math.sin(2.0 * math.pi * 1.2 * (i / fs)) for i in range(256)]
    measured = process_eeg_window(samples, sample_rate_hz=fs)
    assert measured["eeg_delta_ratio"].value is not None
    assert measured["eeg_delta_ratio"].value > 0.6
    assert measured["eeg_delta_ratio"].provenance.measurement_status == MeasurementStatus.MEASURED


def test_staged_inference_distinguishes_phone_only_vs_multimodal() -> None:
    engine = ResearchInferenceEngine()
    phone_only = engine.infer_research_state(
        {"model_stage": "M1", "frames": _make_imu_frames(), "is_simulated": True}
    )
    multimodal = engine.infer_research_state(
        {
            "model_stage": "M1",
            "eeg_delta_ratio": 0.48,
            "n3_fraction": 0.24,
            "ppg_pulsatility_index": 0.78,
            "hrv_rmssd_ms": 54.0,
            "respiratory_rate_bpm": 13.0,
            "device_orientation": "lateral_right_proxy",
            "signal_quality_score": 0.90,
        }
    )
    assert phone_only["claim_guardrail"] == CLAIM_GUARDRAIL
    assert "eeg" in phone_only["evidence"]["missing_modalities"]
    assert phone_only["research_estimate"]["target"] == "sleep_physiology_state"
    assert (
        phone_only["research_estimate"]["uncertainty"]["epistemic"]
        > multimodal["research_estimate"]["uncertainty"]["epistemic"]
    )
    assert multimodal["research_estimate"]["value"] != phone_only["research_estimate"]["value"]


def test_validation_agreement_icc_coverage_and_temporal_split() -> None:
    pred = [1.22, 1.31, 1.45, 1.50, 1.28, 1.39, 1.61, 1.44, 1.35, 1.55, 1.48, 1.30]
    ref = [1.20, 1.33, 1.42, 1.52, 1.25, 1.40, 1.58, 1.46, 1.36, 1.53, 1.49, 1.31]
    ci_low = [p - 0.06 for p in pred]
    ci_high = [p + 0.06 for p in pred]
    nights = [[1.21, 1.23, 1.22], [1.45, 1.47, 1.44], [1.55, 1.53, 1.56]]

    res = evaluate_cohort_agreement(
        pred, ref, night_groups=nights, ci_low=ci_low, ci_high=ci_high, surrogate_target="dti_alps_index"
    )
    assert res["icc_formulation"] == "ICC(2,1) random-effects absolute agreement"
    assert res["multi_night_icc"] is not None and res["multi_night_icc"] > 0.85
    assert res["interval_coverage_95"] == 1.0
    assert res["within_person_variance"] is not None
    assert res["n3_associated_feature_sensitivity"] > 0
    assert res["validation_passed"] is True

    records = [
        {"participant_id": "p1", "timestamp": "2026-11-01T01:00:00Z"},
        {"participant_id": "p2", "timestamp": "2026-11-01T02:00:00Z"},
        {"participant_id": "p3", "timestamp": "2026-11-02T01:00:00Z"},
    ]
    train, test = participant_temporal_split(records, train_participant_frac=0.7)
    train_ids = {r["participant_id"] for r in train}
    test_ids = {r["participant_id"] for r in test}
    assert train_ids.isdisjoint(test_ids)


def test_conformal_calibration_clock_alignment_and_subgroup_audit() -> None:
    from nexora.health.models.calibration import (
        apply_conformal_interval,
        estimate_participant_random_effects,
        fit_grouped_conformal_quantile,
    )
    from nexora.health.signal_processing.alignment import align_multimodal_streams

    q = fit_grouped_conformal_quantile(
        predicted=[1.2, 1.3, 1.4, 1.5],
        reference=[1.24, 1.28, 1.46, 1.53],
        participant_ids=["p1", "p1", "p2", "p3"],
    )
    assert q >= 0.04
    lo, hi = apply_conformal_interval(1.4, 1.35, 1.45, q)
    assert lo <= 1.35 and hi >= 1.45

    re = estimate_participant_random_effects([
        {"participant_id": "p1", "predicted": 1.2, "mri_reference": 1.25},
        {"participant_id": "p1", "predicted": 1.3, "mri_reference": 1.35},
    ])
    assert re["p1"] == 0.05

    aligned = align_multimodal_streams([
        {"device_timestamp_ms": 1700000001000, "monotonic_ms": 10000, "sync_uncertainty_ms": 12.0},
        {"device_timestamp_ms": 1700000001005, "monotonic_ms": 10002, "sync_uncertainty_ms": 15.0},
    ])
    assert aligned["aligned_count"] == 2
    assert aligned["alignment_quality"] == "good"

    sub_res = evaluate_cohort_agreement(
        predicted=[1.2, 1.3, 1.4, 1.5],
        mri_reference=[1.22, 1.31, 1.39, 1.48],
        subgroups=[
            {"device_model": "iphone_15"},
            {"device_model": "iphone_15"},
            {"device_model": "pixel_9"},
            {"device_model": "pixel_9"},
        ],
    )
    assert len(sub_res["stratified_metrics"]) == 2
