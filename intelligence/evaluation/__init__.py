"""NEXORA Continuous Learning & Model Evaluation Harness.

Provides benchmark suites, drift monitoring, and conformal coverage verification
for the unified Deep Learning platform (Mobility, Finance, Voice, and Multi-Modal).
"""

from __future__ import annotations

from intelligence.evaluation.benchmark import run_all_benchmarks

__all__ = ["run_all_benchmarks"]
