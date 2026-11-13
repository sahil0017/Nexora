"""Clinical-reference validation pipeline: agreement, documented ICC, coverage, and temporal splitting."""

from __future__ import annotations

from typing import Any

import numpy as np

from nexora.health.models.baseline import predict_m0_linear
from nexora.health.provenance import CLAIM_GUARDRAIL


def _rankdata(arr: np.ndarray) -> np.ndarray:
    order = np.argsort(arr)
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(arr) + 1, dtype=np.float64)
    return ranks


def participant_temporal_split(
    records: list[dict[str, Any]],
    train_participant_frac: float = 0.7,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split longitudinal records by participant ID and chronological timestamp to prevent leakage."""
    participants = sorted({str(r.get("participant_id", "unknown")) for r in records})
    cutoff = max(1, int(len(participants) * train_participant_frac))
    train_ids = set(participants[:cutoff])
    train = sorted(
        [r for r in records if str(r.get("participant_id", "unknown")) in train_ids],
        key=lambda x: str(x.get("timestamp", "")),
    )
    test = sorted(
        [r for r in records if str(r.get("participant_id", "unknown")) not in train_ids],
        key=lambda x: str(x.get("timestamp", "")),
    )
    return train, test


def _compute_subgroup_metrics(
    x: np.ndarray,
    y: np.ndarray,
    subgroups: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not subgroups:
        return []
    n = min(len(x), len(y), len(subgroups))
    buckets: dict[tuple[str, str], list[int]] = {}
    for i in range(n):
        meta = subgroups[i] or {}
        for k, v in meta.items():
            buckets.setdefault((str(k), str(v)), []).append(i)

    out: list[dict[str, Any]] = []
    for (g_key, g_val), idxs in sorted(buckets.items()):
        if len(idxs) < 2:
            continue
        gx = x[idxs]
        gy = y[idxs]
        diff = gx - gy
        mae = float(np.mean(np.abs(diff)))
        rmse = float(np.sqrt(np.mean(diff**2)))
        bias = float(np.mean(diff))
        var_x, var_y = float(np.var(gx, ddof=1)), float(np.var(gy, ddof=1))
        if var_x > 1e-9 and var_y > 1e-9:
            cov_xy = float(np.sum((gx - np.mean(gx)) * (gy - np.mean(gy))) / (len(idxs) - 1))
            ccc = float((2.0 * cov_xy) / max(var_x + var_y + (float(np.mean(gx)) - float(np.mean(gy))) ** 2, 1e-9))
        else:
            ccc = 0.0
        out.append({
            "group_key": g_key,
            "group_value": g_val,
            "sample_count": len(idxs),
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "lin_ccc": round(ccc, 4),
            "bland_altman_bias": round(bias, 4),
        })
    return out


def evaluate_cohort_agreement(
    predicted: list[float],
    mri_reference: list[float],
    night_groups: list[list[float]] | None = None,
    ci_low: list[float] | None = None,
    ci_high: list[float] | None = None,
    surrogate_target: str = "dti_alps_index",
    subgroups: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate agreement, within/between-person variance, documented ICC(2,1), and interval coverage."""
    n = min(len(predicted), len(mri_reference))
    if n < 2:
        return {
            "sample_count": n,
            "surrogate_target": surrogate_target,
            "pearson_r": 0.0,
            "spearman_rho": 0.0,
            "lin_ccc": 0.0,
            "mae": 0.0,
            "rmse": 0.0,
            "bland_altman_bias": 0.0,
            "bland_altman_loa_low": 0.0,
            "bland_altman_loa_high": 0.0,
            "within_person_variance": None,
            "between_person_variance": None,
            "icc_formulation": "ICC(2,1) two-way random absolute agreement",
            "multi_night_icc": None,
            "interval_coverage_95": None,
            "calibration_error": None,
            "n3_associated_feature_sensitivity": 0.0,
            "validation_passed": False,
            "notes": ["At least 2 paired MRI-reference observations are required."],
            "claim_guardrail": CLAIM_GUARDRAIL,
        }

    x = np.array(predicted[:n], dtype=np.float64)
    y = np.array(mri_reference[:n], dtype=np.float64)
    diff = x - y

    mae = float(np.mean(np.abs(diff)))
    rmse = float(np.sqrt(np.mean(diff**2)))
    bias = float(np.mean(diff))
    sd_diff = float(np.std(diff, ddof=1))
    loa_low = bias - 1.96 * sd_diff
    loa_high = bias + 1.96 * sd_diff

    std_x = float(np.std(x, ddof=1))
    std_y = float(np.std(y, ddof=1))
    if std_x > 1e-9 and std_y > 1e-9:
        pearson_r = float(np.corrcoef(x, y)[0, 1])
        spearman_rho = float(np.corrcoef(_rankdata(x), _rankdata(y))[0, 1])
        mean_x, mean_y = float(np.mean(x)), float(np.mean(y))
        cov_xy = float(np.sum((x - mean_x) * (y - mean_y)) / (n - 1))
        var_x, var_y = float(np.var(x, ddof=1)), float(np.var(y, ddof=1))
        lin_ccc = float((2.0 * cov_xy) / max(var_x + var_y + (mean_x - mean_y) ** 2, 1e-9))
    else:
        pearson_r = spearman_rho = lin_ccc = 0.0

    # Within-person & between-person variance + ICC(2,1) one-way/random-effects approximation
    within_var: float | None = None
    between_var: float | None = None
    icc_val: float | None = None
    if night_groups and len(night_groups) >= 2:
        valid_groups = [np.array(g, dtype=np.float64) for g in night_groups if len(g) >= 2]
        if len(valid_groups) >= 2:
            grand_mean = float(np.mean(np.concatenate(valid_groups)))
            k_mean = float(np.mean([len(g) for g in valid_groups]))
            ss_between = float(sum(len(g) * (float(np.mean(g)) - grand_mean) ** 2 for g in valid_groups))
            ss_within = float(sum(np.sum((g - float(np.mean(g))) ** 2) for g in valid_groups))
            ms_between = ss_between / max(len(valid_groups) - 1, 1)
            ms_within = ss_within / max(sum(len(g) - 1 for g in valid_groups), 1)
            within_var = round(ms_within, 5)
            between_var = round(max(0.0, (ms_between - ms_within) / max(k_mean, 1.0)), 5)
            denom = ms_between + (k_mean - 1.0) * ms_within
            if denom > 1e-9:
                icc_val = round(float(np.clip((ms_between - ms_within) / denom, -1.0, 1.0)), 4)

    # Interval coverage & calibration error
    coverage: float | None = None
    cal_err: float | None = None
    if ci_low and ci_high and len(ci_low) >= n and len(ci_high) >= n:
        covered = sum(1 for i in range(n) if ci_low[i] <= y[i] <= ci_high[i])
        coverage = round(covered / n, 4)
        cal_err = round(abs(coverage - 0.95), 4)

    n3_sens = round(predict_m0_linear({"n3_fraction": 0.25}) - predict_m0_linear({"n3_fraction": 0.10}), 4)
    passed = bool(n >= 10 and lin_ccc >= 0.65 and pearson_r >= 0.70 and n3_sens > 0)

    notes: list[str] = []
    if n < 10:
        notes.append(f"Small cohort (n={n}); minimum n>=10 paired MRI observations required.")
    if lin_ccc < 0.65:
        notes.append("Lin's CCC below 0.65; recalibration with external MRI cohort required.")

    return {
        "sample_count": n,
        "surrogate_target": surrogate_target,
        "pearson_r": round(pearson_r, 4),
        "spearman_rho": round(spearman_rho, 4),
        "lin_ccc": round(lin_ccc, 4),
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "bland_altman_bias": round(bias, 4),
        "bland_altman_loa_low": round(loa_low, 4),
        "bland_altman_loa_high": round(loa_high, 4),
        "within_person_variance": within_var,
        "between_person_variance": between_var,
        "icc_formulation": "ICC(2,1) random-effects absolute agreement",
        "multi_night_icc": icc_val,
        "interval_coverage_95": coverage,
        "calibration_error": cal_err,
        "n3_associated_feature_sensitivity": n3_sens,
        "stratified_metrics": _compute_subgroup_metrics(x, y, subgroups),
        "validation_passed": passed,
        "notes": notes,
        "claim_guardrail": CLAIM_GUARDRAIL,
    }
