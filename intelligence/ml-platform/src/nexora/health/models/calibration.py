"""Grouped split-conformal calibration and hierarchical participant random-effects estimation."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np


def fit_grouped_conformal_quantile(
    predicted: list[float],
    reference: list[float],
    participant_ids: list[str] | None = None,
    alpha: float = 0.05,
) -> float:
    """Compute finite-sample conformal residual quantile grouped by participant to prevent leakage."""
    n = min(len(predicted), len(reference))
    if n < 2:
        return 0.08

    residuals_by_group: dict[str, list[float]] = defaultdict(list)
    for i in range(n):
        gid = str(participant_ids[i]) if participant_ids and i < len(participant_ids) else f"p_{i}"
        residuals_by_group[gid].append(abs(float(reference[i]) - float(predicted[i])))

    # One representative residual (median) per participant prevents repeated-measures inflation
    group_residuals = np.array([float(np.median(vals)) for vals in residuals_by_group.values()], dtype=np.float64)
    g = len(group_residuals)
    level = min(1.0, max(0.0, (1.0 - alpha) * (1.0 + 1.0 / max(g, 1))))
    return round(float(np.quantile(group_residuals, level)), 4)


def apply_conformal_interval(
    point_estimate: float,
    base_low: float,
    base_high: float,
    conformal_quantile: float | None,
) -> tuple[float, float]:
    """Widen or calibrate a prediction interval using a fitted conformal quantile."""
    if conformal_quantile is None or conformal_quantile <= 0:
        return round(base_low, 4), round(base_high, 4)
    low = min(base_low, point_estimate - conformal_quantile)
    high = max(base_high, point_estimate + conformal_quantile)
    return round(float(low), 4), round(float(high), 4)


def estimate_participant_random_effects(records: list[dict[str, Any]]) -> dict[str, float]:
    """Estimate participant-level random intercepts (mean residual per participant) for longitudinal calibration."""
    grouped: dict[str, list[float]] = defaultdict(list)
    for rec in records:
        pid = str(rec.get("participant_id", "unknown"))
        pred = float(rec.get("predicted", 0.0))
        ref = float(rec.get("mri_reference", pred))
        grouped[pid].append(ref - pred)

    return {pid: round(float(np.mean(res)), 4) for pid, res in grouped.items() if res}
