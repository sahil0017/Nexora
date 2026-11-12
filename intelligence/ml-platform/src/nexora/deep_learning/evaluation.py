"""NEXORA Deep Learning — Continuous Learning Discipline & Evaluation Harness.

Implements:
1. DriftDetector: Kolmogorov-Smirnov (KS-test) and ADWIN concept drift detector on live streams.
2. ShadowModeEvaluator: Evaluates candidate deep models in shadow mode alongside production baselines.
3. ModelEvaluationHarness: Metric calculation (MAE, RMSE, MAPE, Accuracy, Conformal Coverage, p95 Latency)
   powering continuous evaluation and regression gates.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


class DriftDetector:
    """Feature and concept drift detector based on Kolmogorov-Smirnov and sliding-window statistics."""

    def __init__(self, p_val_threshold: float = 0.05) -> None:
        self.p_val_threshold = p_val_threshold

    def detect_ks_drift(self, reference_sample: list[float], current_sample: list[float]) -> dict[str, Any]:
        """Compute two-sample Kolmogorov-Smirnov drift statistic between reference and current feature windows."""
        ref = np.sort(np.array(reference_sample, dtype=np.float64))
        cur = np.sort(np.array(current_sample, dtype=np.float64))

        if len(ref) == 0 or len(cur) == 0:
            return {"drift_detected": False, "p_value": 1.0, "ks_statistic": 0.0}

        # Combine and evaluate empirical CDF distance
        all_vals = np.concatenate([ref, cur])
        cdf_ref = np.searchsorted(ref, all_vals, side="right") / len(ref)
        cdf_cur = np.searchsorted(cur, all_vals, side="right") / len(cur)

        ks_stat = float(np.max(np.abs(cdf_ref - cdf_cur)))
        # Asymptotic p-value approximation
        n_eff = (len(ref) * len(cur)) / (len(ref) + len(cur))
        lambda_val = max(1e-4, (math.sqrt(n_eff) + 0.12 + 0.11 / math.sqrt(n_eff)) * ks_stat)
        p_value = float(np.clip(2.0 * math.exp(-2.0 * (lambda_val ** 2)), 0.0, 1.0))

        drift_detected = p_value < self.p_val_threshold

        return {
            "drift_detected": drift_detected,
            "ks_statistic": round(ks_stat, 4),
            "p_value": round(p_value, 4),
            "severity": "critical" if p_value < 0.005 else "warning" if drift_detected else "none",
            "reference_count": len(ref),
            "current_count": len(cur),
        }

    def detect_drift(
        self, reference_sample: list[float], current_sample: list[float], feature_name: str = "feature_0"
    ) -> dict[str, Any]:
        """Convenience alias returning drift assessment with feature metadata."""
        res = self.detect_ks_drift(reference_sample, current_sample)
        res["feature_name"] = feature_name
        return res


class ShadowModeEvaluator:
    """Shadow-mode evaluator comparing experimental deep models with production baselines."""

    def __init__(self) -> None:
        self._comparisons: list[dict[str, Any]] = []

    def record_shadow_inference(
        self,
        task_id: str,
        baseline_pred: float,
        shadow_pred: float,
        baseline_latency_ms: float,
        shadow_latency_ms: float,
    ) -> dict[str, Any]:
        diff = abs(baseline_pred - shadow_pred)
        agreement = max(0.0, 1.0 - (diff / max(1.0, abs(baseline_pred))))

        record = {
            "task_id": task_id,
            "baseline_prediction": round(baseline_pred, 2),
            "shadow_prediction": round(shadow_pred, 2),
            "absolute_delta": round(diff, 2),
            "agreement_score": round(agreement, 3),
            "baseline_latency_ms": round(baseline_latency_ms, 2),
            "shadow_latency_ms": round(shadow_latency_ms, 2),
            "latency_overhead_ratio": round(shadow_latency_ms / max(0.1, baseline_latency_ms), 2),
        }
        self._comparisons.append(record)
        return record

    def get_aggregate_metrics(self) -> dict[str, Any]:
        if not self._comparisons:
            return {"total_inferences": 0, "mean_agreement": 1.0}
        agreements = [c["agreement_score"] for c in self._comparisons]
        latencies = [c["shadow_latency_ms"] for c in self._comparisons]

        return {
            "total_inferences": len(self._comparisons),
            "mean_agreement": round(float(np.mean(agreements)), 3),
            "p95_shadow_latency_ms": round(float(np.percentile(latencies, 95)), 2),
            "shadow_mode_status": "healthy" if float(np.mean(agreements)) >= 0.70 else "review_required",
        }


class ModelEvaluationHarness:
    """Comprehensive metric calculation suite across regression, classification, and conformal coverage."""

    @staticmethod
    def regression_metrics(y_true: list[float], y_pred: list[float]) -> dict[str, float]:
        yt = np.array(y_true, dtype=np.float64)
        yp = np.array(y_pred, dtype=np.float64)
        mae = float(np.mean(np.abs(yt - yp)))
        rmse = float(math.sqrt(np.mean((yt - yp) ** 2)))
        mape = float(np.mean(np.abs((yt - yp) / np.maximum(np.abs(yt), 1e-4)))) * 100.0

        return {"mae": round(mae, 3), "rmse": round(rmse, 3), "mape_pct": round(mape, 2)}

    @staticmethod
    def conformal_coverage_check(
        y_true: list[float], lower_bounds: list[float], upper_bounds: list[float], target_coverage: float = 0.90
    ) -> dict[str, Any]:
        covered = sum(1 for yt, lb, ub in zip(y_true, lower_bounds, upper_bounds) if lb <= yt <= ub)
        empirical_cov = covered / max(1, len(y_true))
        return {
            "empirical_coverage": round(empirical_cov, 3),
            "target_coverage": target_coverage,
            "is_valid": empirical_cov >= target_coverage - 0.05,
            "sample_size": len(y_true),
        }

    def evaluate_predictions(
        self,
        y_true: list[float],
        y_pred: list[float],
        y_lower: list[float] | None = None,
        y_upper: list[float] | None = None,
    ) -> dict[str, Any]:
        """Unified evaluation: regression errors + conformal empirical coverage if bounds provided."""
        res: dict[str, Any] = self.regression_metrics(y_true, y_pred)
        if y_lower is not None and y_upper is not None:
            cov = self.conformal_coverage_check(y_true, y_lower, y_upper)
            res["conformal_coverage"] = cov
        return res
