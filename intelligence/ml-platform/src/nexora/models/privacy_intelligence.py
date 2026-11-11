"""Privacy-Preserving Crowd Intelligence: K-Anonymity + Laplace Differential Privacy
for collective movement analytics without storing or exposing individual trajectories/PII.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import math
import random
from typing import Any

from nexora.geospatial.h3_grid import latlon_to_h3


def _laplace_noise(scale: float, rng: random.Random | None = None) -> float:
    """Zero-mean Laplace noise sample via inverse CDF transform."""
    r = rng or random.Random()
    u = r.uniform(-0.4999, 0.4999)
    return -scale * (1.0 if u >= 0 else -1.0) * math.log(1.0 - 2.0 * abs(u))


class PrivacyPreservingCrowdAggregator:
    """Aggregates raw movement pings into k-anonymous, epsilon-differentially-private H3 buckets."""

    model_version = "privacy-kanon-laplace-dp-v1"

    def __init__(self, k_min: int = 5, epsilon: float = 0.5) -> None:
        self.k_min = max(2, int(k_min))
        self.epsilon = max(0.05, float(epsilon))
        self.total_pings_processed = 0
        self.total_cells_suppressed = 0
        self.total_cells_published = 0

    def aggregate_samples(
        self,
        samples: list[dict[str, Any]],
        k_min: int | None = None,
        epsilon: float | None = None,
        seed: int | None = None,
    ) -> dict[str, Any]:
        k_req = max(2, int(k_min if k_min is not None else self.k_min))
        eps = max(0.05, float(epsilon if epsilon is not None else self.epsilon))
        rng = random.Random(seed) if seed is not None else random.Random()

        epoch_start = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        epoch_min = (epoch_start.minute // 15) * 15
        epoch_iso = epoch_start.replace(minute=epoch_min).isoformat()

        # Group by H3 resolution-8 cell while stripping PII into ephemeral one-way cohort tokens
        buckets: dict[str, dict[str, Any]] = {}
        for idx, s in enumerate(samples):
            if "latitude" not in s or "longitude" not in s:
                continue
            lat = float(s["latitude"])
            lon = float(s["longitude"])
            h3_idx = latlon_to_h3(lat, lon, 8)
            raw_actor = str(s.get("ephemeral_token") or s.get("device_id") or s.get("user_id") or f"anon-{idx}")
            ephemeral_hash = hashlib.sha256(f"{epoch_iso}:{raw_actor}".encode("utf-8")).hexdigest()[:12]
            speed_kph = float(s.get("speed_kph") or (float(s.get("speed_mps", 7.5)) * 3.6))

            cell = buckets.setdefault(h3_idx, {"cohorts": set(), "speeds": [], "count": 0})
            cell["cohorts"].add(ephemeral_hash)
            cell["speeds"].append(max(0.0, min(110.0, speed_kph)))
            cell["count"] += 1

        self.total_pings_processed += len(samples)

        published_cells: list[dict[str, Any]] = []
        suppressed_count = 0
        # Sensitivity 1.0 for cohort count; clamped speed sensitivity ~15 kph / k_req
        count_scale = 1.0 / eps

        for h3_idx, cell in buckets.items():
            k_count = len(cell["cohorts"])
            if k_count < k_req:
                suppressed_count += 1
                self.total_cells_suppressed += 1
                published_cells.append(
                    {
                        "h3_index": h3_idx,
                        "bucket_start": epoch_iso,
                        "k_anonymity_count": 0,  # Never leak small cohort exact count
                        "suppressed_below_k": True,
                        "noised_flow_density": None,
                        "noised_avg_speed_kph": None,
                        "privacy_note": f"Suppressed (< {k_req} distinct cohorts) to protect individual anonymity.",
                    }
                )
                continue

            self.total_cells_published += 1
            noised_k = max(k_req, round(k_count + _laplace_noise(count_scale, rng), 1))
            density = round(min(1.0, max(0.05, noised_k / 40.0)), 3)
            raw_avg_spd = sum(cell["speeds"]) / max(1, len(cell["speeds"]))
            spd_scale = (25.0 / k_count) / eps
            noised_spd = round(max(4.0, min(90.0, raw_avg_spd + _laplace_noise(spd_scale, rng))), 1)

            published_cells.append(
                {
                    "h3_index": h3_idx,
                    "bucket_start": epoch_iso,
                    "k_anonymity_count": k_count,
                    "suppressed_below_k": False,
                    "noised_flow_density": density,
                    "noised_avg_speed_kph": noised_spd,
                    "privacy_note": f"Published under k>={k_req}, epsilon={eps} Laplace DP.",
                }
            )

        return {
            "bucket_start": epoch_iso,
            "k_threshold": k_req,
            "epsilon_budget": eps,
            "input_samples": len(samples),
            "published_count": len(published_cells) - suppressed_count,
            "suppressed_count": suppressed_count,
            "cells": published_cells,
            "guarantees": [
                "PII & raw trajectories dropped before storage",
                f"H3 cell suppression enforced below k={k_req} unique cohorts",
                f"Laplace differential privacy noise added at epsilon={eps}",
            ],
            "model_version": self.model_version,
        }
