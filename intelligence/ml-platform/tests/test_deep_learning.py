"""Unit tests for NEXORA Deep Learning Platform.

Tests all 16 Deep Learning architectures and their FastAPI inference endpoints:
- Mobility: ST-GNN, Conformal ETA, Trajectory Transformer, Trip Autoencoder, Road Vision, Demand TFT, Offline RL.
- Finance: Neural Txn Classifier, Deep SVDD Anomaly, DeepAR Cash Flow, Regime Risk, GNN Risk, Doc Intelligence.
- Voice: Whisper Telephony Adapter, Speaker Diarizer, Dense Memory Retriever, Cross-Encoder, Urgency/Affect.
- Cross-Cutting & Continuous Learning: Multi-modal User Twin Fusion, Drift Detector, Evaluation Harness.
"""

from __future__ import annotations

import unittest
from fastapi.testclient import TestClient

from nexora.deep_learning import hub
from nexora.inference.api import app


class TestDeepLearningPlatform(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    # =========================================================================
    # 1. Platform Status & Model Registry
    # =========================================================================
    def test_deep_platform_status(self) -> None:
        res = self.client.get("/v1/deep/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "online")
        self.assertEqual(data["models_loaded"], 16)
        self.assertGreaterEqual(len(data["architecture_families"]), 10)

    # =========================================================================
    # 2. Mobility Deep Learning Models & Endpoints
    # =========================================================================
    def test_st_gnn_speed_forecasting(self) -> None:
        speeds = [42.0, 35.0, 50.0, 28.0]
        res = self.client.post("/v1/deep/mobility/st-gnn/predict", json={"current_speeds": speeds})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("forecasts", body)
        for h in ("5_min", "15_min", "30_min", "60_min"):
            self.assertEqual(len(body["forecasts"][h]), len(speeds))
            # Speeds should be physically plausible
            for s in body["forecasts"][h]:
                self.assertGreater(s, 0.0)
                self.assertLess(s, 120.0)

    def test_conformal_eta_intervals(self) -> None:
        res = self.client.post(
            "/v1/deep/mobility/eta/conformal",
            json={"distance_km": 15.0, "free_flow_speed": 50.0, "congestion_factor": 1.4, "rain_mm": 10.0},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        eta_min = body["point_prediction_min"]
        p80_low, p80_high = body["conformal_intervals"]["80%"]
        p90_low, p90_high = body["conformal_intervals"]["90%"]

        self.assertGreater(eta_min, 0.0)
        self.assertLessEqual(p80_low, eta_min)
        self.assertGreaterEqual(p80_high, eta_min)
        # 90% interval must be wider or equal to 80% interval
        self.assertLessEqual(p90_low, p80_low)
        self.assertGreaterEqual(p90_high, p80_high)

    def test_trajectory_transformer_and_anomaly(self) -> None:
        crumbs = [[17.3850, 78.4867], [17.3910, 78.4912], [17.4020, 78.4980]]
        res = self.client.post(
            "/v1/deep/mobility/trajectory/predict",
            json={"breadcrumbs": crumbs, "user_favorites": [[17.4400, 78.5100]]},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("destination_prediction", body)
        self.assertIn("trajectory_anomaly", body)
        self.assertIn("predicted_lat_lon", body["destination_prediction"])
        self.assertIn("reconstruction_error", body["trajectory_anomaly"])

    def test_road_vision_inspection(self) -> None:
        res = self.client.post(
            "/v1/deep/mobility/vision/inspect",
            json={"sensor_telemetry": {"accel_z": 14.5, "vibration_rms": 0.85}},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn(body["detected_hazard"], ["clear", "pothole", "waterlogging", "flooding"])
        self.assertGreaterEqual(body["confidence"], 0.0)
        self.assertLessEqual(body["confidence"], 1.0)

    def test_demand_tft_surge_forecasting(self) -> None:
        res = self.client.post(
            "/v1/deep/mobility/demand/forecast",
            json={"h3_index": "8860145b23fffff", "history_30d": [18, 22, 19, 25, 30, 28, 26], "event_distance_km": 1.5},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertGreaterEqual(body["surge_multiplier"], 1.0)
        self.assertGreaterEqual(body["forecasted_demand"], body["base_daily_demand"])

    def test_offline_rl_policy_evaluation(self) -> None:
        res = self.client.post(
            "/v1/deep/mobility/policy/evaluate",
            json={"state": [12.0, 18.0, 8.0, 15.0, 45.0], "action": 1},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("optimal_policy_action", body)
        self.assertIn("q_value_estimates", body)
        self.assertGreater(body["expected_delay_reduction_pct"], 0.0)

    # =========================================================================
    # 3. Finance Deep Learning Models & Endpoints
    # =========================================================================
    def test_neural_transaction_classification(self) -> None:
        res = self.client.post(
            "/v1/deep/finance/classify-alert",
            json={"raw_text": "INR 540 debited for Zomato order", "amount": 540.0},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["merchant"], "Zomato")
        self.assertEqual(body["category"], "Food Dining")
        self.assertTrue(body["is_discretionary"])

    def test_deep_svdd_anomaly_detection(self) -> None:
        # Standard lunch purchase vs foreign middle-of-the-night spending spike
        normal_res = self.client.post(
            "/v1/deep/finance/anomaly",
            json={"amount": 350.0, "hour_of_day": 13, "merchant": "Subway", "category": "food", "is_foreign": False},
        )
        spike_res = self.client.post(
            "/v1/deep/finance/anomaly",
            json={"amount": 185000.0, "hour_of_day": 3, "merchant": "Casino Vegas", "category": "gambling", "is_foreign": True},
        )
        self.assertEqual(normal_res.status_code, 200)
        self.assertEqual(spike_res.status_code, 200)
        self.assertFalse(normal_res.json()["is_anomaly"])
        self.assertTrue(spike_res.json()["is_anomaly"])
        self.assertEqual(spike_res.json()["anomaly_type"], "unusual_timing_or_foreign")

    def test_deepar_cashflow_forecasting(self) -> None:
        res = self.client.post(
            "/v1/deep/finance/cashflow-forecast",
            json={"current_balance": 180000.0, "recent_daily_net_flows": [-800.0, -1200.0, -450.0], "fixed_obligations_monthly": 35000.0},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("trajectory_30d", body)
        self.assertEqual(len(body["trajectory_30d"]), 30)
        for pt in body["trajectory_30d"]:
            self.assertLessEqual(pt["p10"], pt["p50"])
            self.assertLessEqual(pt["p50"], pt["p90"])

    def test_regime_switching_risk_model(self) -> None:
        res = self.client.post(
            "/v1/deep/finance/regime-risk",
            json={"volatility_30d": 0.28, "drawdown_pct": -0.08, "yield_spread_bps": 220.0},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn(body["current_regime"], ["expansion_bull", "high_volatility", "mean_reverting", "liquidity_squeeze"])
        self.assertIn("recommended_factor_tilts", body)

    def test_gnn_risk_propagation(self) -> None:
        nodes = [
            {"id": "n1", "type": "equity", "value": 500000.0, "beta": 1.2},
            {"id": "n2", "type": "debt_fund", "value": 300000.0, "duration_years": 4.0},
        ]
        res = self.client.post(
            "/v1/deep/finance/graph/propagate",
            json={"asset_nodes": nodes, "stress_shocks": {"equity_drawdown": -0.20, "repo_hike_bps": 75.0}},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("propagated_nodes", body)
        self.assertEqual(body["total_nodes"], 2)
        prop_nodes = body["propagated_nodes"]
        self.assertLess(prop_nodes[0]["shocked_value"], prop_nodes[0]["original_value"])

    def test_neural_doc_intelligence(self) -> None:
        sample_doc = "Salary Slip for Emp PAN: ABCDE1234F IFSC: HDFC0001234 Gross Salary Rs. 145,000 Basic Rs. 80,000 HRA Rs. 40,000"
        res = self.client.post("/v1/deep/finance/doc/extract", json={"text": sample_doc})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["detected_pan"], "ABCDE1234F")
        self.assertEqual(body["detected_ifsc"], "HDFC0001234")
        self.assertTrue(body["has_salary_slip_markers"])
        self.assertIn(145000.0, body["extracted_amounts"])

    def test_dynamic_merchant_registration_and_policy_integration(self) -> None:
        # Dynamically register a new niche merchant at runtime
        reg_res = self.client.post(
            "/v1/deep/finance/merchants/register",
            json={"keyword": "thirdwave", "name": "Third Wave Coffee", "category": "food_dining", "recurring": False},
        )
        self.assertEqual(reg_res.status_code, 200)
        reg_data = reg_res.json()
        self.assertEqual(reg_data["status"], "success")
        self.assertEqual(reg_data["registered_count"], 1)

        # Batch registration
        batch_res = self.client.post(
            "/v1/deep/finance/merchants/register",
            json={
                "merchants": [
                    {"keyword": "urbancompany", "name": "Urban Company", "category": "utilities_bills", "recurring": False},
                    {"keyword": "cultfit", "name": "Cult.fit", "category": "health_medical", "recurring": True},
                ]
            },
        )
        self.assertEqual(batch_res.status_code, 200)
        self.assertEqual(batch_res.json()["registered_count"], 2)

        # Verify dynamic classification immediately picks up the new merchants
        classify_res = self.client.post(
            "/v1/deep/finance/classify-alert",
            json={"raw_text": "INR 320 paid at thirdwave roasters via UPI", "amount": 320.0},
        )
        self.assertEqual(classify_res.status_code, 200)
        self.assertEqual(classify_res.json()["merchant"], "Third Wave Coffee")
        self.assertEqual(classify_res.json()["category"], "Food Dining")

        # Verify listing endpoint
        list_res = self.client.get("/v1/deep/finance/merchants")
        self.assertEqual(list_res.status_code, 200)
        self.assertIn("thirdwave", list_res.json()["merchants"])
        self.assertIn("urbancompany", list_res.json()["merchants"])

    # =========================================================================
    # 4. Voice Deep Learning Models & Endpoints
    # =========================================================================
    def test_whisper_telephony_adapter(self) -> None:
        res = self.client.post(
            "/v1/deep/voice/asr/adapt",
            json={"sample_rate_hz": 8000, "snr_db": 12.0, "text_sample": "Haan bhai kal theek hai, repu call cheddam"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["has_code_switching"])
        self.assertGreaterEqual(body["acoustic_clarity_score"], 0.2)
        self.assertEqual(body["telephony_codec"], "G.711 Narrowband")

    def test_dynamic_code_switch_registration_and_dialects(self) -> None:
        # Dynamically register custom Tamil & Malayalam dialect tokens at runtime
        reg_res = self.client.post(
            "/v1/deep/voice/code-switch/register",
            json={
                "tokens": {
                    "eppadi": "ta",
                    "nandri": "ta",
                    "sherikkum": "ml",
                    "enthaanu": "ml",
                }
            },
        )
        self.assertEqual(reg_res.status_code, 200)
        reg_data = reg_res.json()
        self.assertEqual(reg_data["status"], "success")
        self.assertIn("en-ta", reg_data["supported_languages"])
        self.assertIn("en-ml", reg_data["supported_languages"])

        # Test audio adaptation with Malayalam code-switching
        adapt_res = self.client.post(
            "/v1/deep/voice/asr/adapt",
            json={"sample_rate_hz": 8000, "snr_db": 22.0, "text_sample": "Hello sir, enthaanu situation, sherikkum report venam"},
        )
        self.assertEqual(adapt_res.status_code, 200)
        adapt_data = adapt_res.json()
        self.assertTrue(adapt_data["has_code_switching"])
        self.assertEqual(adapt_data["primary_language"], "en-ml")
        self.assertIn("ml", adapt_data["detected_code_switch_languages"])

        # Verify listing lexicon endpoint
        lex_res = self.client.get("/v1/deep/voice/code-switch/lexicon")
        self.assertEqual(lex_res.status_code, 200)
        self.assertGreater(lex_res.json()["total_tokens"], 30)

    def test_neural_speaker_diarizer(self) -> None:
        res = self.client.post("/v1/deep/voice/diarize", json={"num_speakers": 2})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertGreaterEqual(body["speaker_count"], 1)
        self.assertIn("diarized_segments", body)

    def test_dense_semantic_search_and_reranker(self) -> None:
        corpus = [
            "We discussed home loan prepayment and reducing EMI interest rates.",
            "Weather in Hyderabad is pleasant with clear skies.",
            "Doctor prescription for blood pressure medication.",
        ]
        query = "How to pay off loan faster and lower EMI?"
        search_res = self.client.post("/v1/deep/voice/dense-search", json={"query": query, "corpus": corpus, "top_k": 2})
        self.assertEqual(search_res.status_code, 200)
        search_body = search_res.json()
        self.assertEqual(len(search_body["results"]), 2)
        self.assertIn("home loan prepayment", search_body["results"][0]["text"])

        rerank_res = self.client.post("/v1/deep/voice/rerank", json={"query": query, "passages": corpus})
        self.assertEqual(rerank_res.status_code, 200)
        rerank_body = rerank_res.json()
        self.assertEqual(len(rerank_body["ranked_passages"]), 3)
        self.assertIn("home loan prepayment", rerank_body["ranked_passages"][0]["text"])

    def test_urgency_and_affect_detector(self) -> None:
        calm_res = self.client.post(
            "/v1/deep/voice/urgency",
            json={"pitch_variance": 15.0, "energy_rms": 0.10, "speech_rate_wpm": 120.0, "sentiment_polarity": 0.4},
        )
        urgent_res = self.client.post(
            "/v1/deep/voice/urgency",
            json={"pitch_variance": 75.0, "energy_rms": 0.90, "speech_rate_wpm": 210.0, "sentiment_polarity": -0.8},
        )
        self.assertEqual(calm_res.status_code, 200)
        self.assertEqual(urgent_res.status_code, 200)
        self.assertEqual(calm_res.json()["escalation_risk"], "normal")
        self.assertIn(urgent_res.json()["escalation_risk"], ["elevated", "critical"])
        self.assertTrue(urgent_res.json()["priority_callback_required"])

    # =========================================================================
    # 5. Cross-Cutting & Continuous Learning
    # =========================================================================
    def test_multimodal_user_twin(self) -> None:
        res = self.client.post(
            "/v1/deep/multimodal/user-twin",
            json={
                "voice_summary": [0.5, 0.2, -0.1, 0.4, 0.3, 0.1, 0.0, 0.2],
                "finance_summary": [15000.0, 4200.0, -0.4, 0.8, 0.5, 0.1, 0.9, 0.3],
                "mobility_summary": [18.5, 42.0, 1.4, 0.2, 0.6, 0.8, 0.3, 0.1],
                "user_id": "usr_test_twin",
            },
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["user_twin_latent_dim"], 32)
        self.assertIn("modality_contributions", body)
        self.assertGreater(len(body["cross_modal_correlations"]), 0)

    def test_kolmogorov_smirnov_drift_detector(self) -> None:
        import numpy as np

        rng = np.random.default_rng(101)
        ref = rng.normal(loc=20.0, scale=3.0, size=80).tolist()
        shifted = rng.normal(loc=35.0, scale=4.0, size=80).tolist()

        res = self.client.post(
            "/v1/deep/evaluation/drift",
            json={"reference_sample": ref, "current_sample": shifted, "feature_name": "eta_error"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["drift_detected"])
        self.assertLess(body["p_value"], 0.05)

    def test_evaluation_benchmark_endpoint(self) -> None:
        res = self.client.post(
            "/v1/deep/evaluation/benchmark",
            json={
                "y_true": [10.0, 20.0, 30.0, 40.0],
                "y_pred": [10.5, 19.8, 29.5, 40.2],
                "y_lower": [8.0, 17.0, 27.0, 37.0],
                "y_upper": [12.0, 23.0, 33.0, 43.0],
            },
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("mae", body)
        self.assertIn("rmse", body)
        self.assertIn("conformal_coverage", body)
        self.assertEqual(body["conformal_coverage"]["empirical_coverage"], 1.0)
        self.assertTrue(body["conformal_coverage"]["is_valid"])


if __name__ == "__main__":
    unittest.main()
