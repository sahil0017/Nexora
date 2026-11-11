"""Unit tests for the 5 NEXORA Mobility Intelligence pillars & event pipeline."""

from __future__ import annotations

import unittest

from nexora.inference.api import (
    assistant_query,
    detect_road_hazards,
    events_status,
    health,
    hotspots_discover,
    ingest_event,
    list_city_events,
    list_engineering_libraries,
    predict_demand,
    predict_journey,
    predict_traffic,
    register_city_event,
    traffic_anomalies,
)


class TestMobilityIntelligence(unittest.TestCase):
    def test_pillar1_traffic_stgcn_dcrnn_and_online_update(self) -> None:
        base = predict_traffic({"segment_ids": ["seg-hitech-1", "seg-hitech-2"], "weather": "clear"})
        self.assertEqual(len(base["predictions"]), 2)
        self.assertEqual(base["predictions"][0]["horizons_minutes"], [15, 30, 60, 120])

        # Ingest live congestion event and verify online River residual adapts forecast
        ingest_event(
            {
                "event_id": "evt-traffic-1",
                "event_type": "traffic.observed.v1",
                "payload": {"segment_id": "seg-hitech-1", "speed_kmph": 10.0},
            }
        )
        updated = predict_traffic({"segment_ids": ["seg-hitech-1"], "weather": "rain"})
        self.assertLess(updated["predictions"][0]["speed_kph"], base["predictions"][0]["speed_kph"])

    def test_pillar2_eta_and_h3_hdbscan_hotspots(self) -> None:
        pts = [
            {"latitude": 17.4435, "longitude": 78.3772, "speed_mps": 2.1},
            {"latitude": 17.4438, "longitude": 78.3775, "speed_mps": 1.8},
            {"latitude": 17.4440, "longitude": 78.3770, "speed_mps": 0.4},
        ]
        hs = hotspots_discover({"points": pts, "resolution": 8})
        self.assertGreaterEqual(len(hs["hotspots"]), 1)
        self.assertIsNotNone(hs["hotspots"][0]["hotspot_cluster"])

        eta = predict_journey(
            {
                "segment_ids": ["seg-1", "seg-2", "seg-3"],
                "mode": "two_wheeler",
                "distance_meters": 8500,
                "weather": "rain",
            }
        )
        self.assertLess(eta["p50_seconds"], eta["p80_seconds"])
        self.assertLess(eta["p80_seconds"], eta["p90_seconds"])

    def test_pillar3_demand_tft_prophet_xgb(self) -> None:
        res = predict_demand({"latitude": 17.385, "longitude": 78.486, "weather": "rain", "rain_mm": 8.0})
        self.assertEqual(len(res["zones"]), 1)
        zone = res["zones"][0]
        self.assertEqual(len(zone["horizons"]), 4)
        self.assertGreaterEqual(zone["surge_pressure"], 1.0)

    def test_pillar4_road_vision_hazard_detection(self) -> None:
        det = detect_road_hazards(
            {
                "latitude": 17.412,
                "longitude": 78.448,
                "hint_type": "pothole",
                "accelerometer_rms": 4.2,
            }
        )
        self.assertEqual(det["hazard_type"], "pothole")
        self.assertGreaterEqual(det["confidence"], 0.75)
        self.assertEqual(len(det["bounding_boxes"]), 1)

    def test_pillar5_multilingual_assistant_en_te_hi(self) -> None:
        en = assistant_query({"query": "What is the fastest metro route during traffic?"})
        self.assertEqual(en["language"], "en")
        self.assertIn("metro", en["detected_intents"])

        te = assistant_query({"query": "ట్రాఫిక్ ఎక్కువగా ఉన్నప్పుడు మెట్రో మంచిదా?"})
        self.assertEqual(te["language"], "te")
        self.assertTrue(len(te["reply"]) > 10)

        hi = assistant_query({"query": "सुबह कब निकलना सही रहेगा ताकि ट्रैफिक जाम न मिले?"})
        self.assertEqual(hi["language"], "hi")
        self.assertIn("departure", hi["detected_intents"])

    def test_stack_libraries_and_health(self) -> None:
        libs = list_engineering_libraries()
        self.assertEqual(len(libs["layers"]), 6)
        st = events_status()
        self.assertGreaterEqual(st["events_processed"], 1)
        self.assertEqual(health()["status"], "ok")

    def test_traffic_anomalies_event_aware_and_explainability(self) -> None:
        from nexora.models.event_intelligence import EventIntelligenceEngine

        # Ensure EventIntelligenceEngine has no hardcoded static events on startup
        fresh_engine = EventIntelligenceEngine()
        self.assertEqual(fresh_engine.active_events_near(17.4435, 78.3772), [])

        # Dynamic synthesis from telemetry anomalies/hotspots (no static fixture needed)
        fresh_engine.sync_from_telemetry(
            hotspots=[{"h3_index": "8860a25a19fffff", "latitude": 12.9716, "longitude": 77.5946, "congestion_score": 0.88}],
            fallback_lat=12.9716,
            fallback_lon=77.5946,
        )
        synthesized = fresh_engine.active_events_near(12.9716, 77.5946)
        self.assertEqual(len(synthesized), 1)
        self.assertEqual(synthesized[0]["source"], "live_telemetry")

        # Force an extreme slowdown observation to trigger EWMA anomaly detection
        ingest_event(
            {
                "event_id": "evt-anom-1",
                "event_type": "traffic.observed.v1",
                "payload": {"segment_id": "seg-anom-9", "speed_kmph": 6.5},
            }
        )
        anom = traffic_anomalies({"segment_ids": ["seg-anom-9"], "weather": "clear"})
        self.assertGreaterEqual(anom["active_anomaly_count"], 1)
        self.assertTrue(anom["anomalies"][0]["is_anomaly"])

        # Mock / register a city event in test code and verify corridor ETA + CI + reliability breakdown
        reg = register_city_event(
            {
                "title": "Test Tech Expo",
                "latitude": 17.445,
                "longitude": 78.380,
                "radius_m": 4000,
                "road_delay_multiplier": 1.25,
                "peak_hours_ist": list(range(24)),
            }
        )
        self.assertEqual(reg["event"]["title"], "Test Tech Expo")
        events_list = list_city_events(lat=17.445, lon=78.380)
        self.assertGreaterEqual(len(events_list["events"]), 1)

        eta = predict_journey(
            {
                "segment_ids": ["seg-anom-9"],
                "mode": "car",
                "distance_meters": 6000,
                "origin": {"latitude": 17.445, "longitude": 78.380},
                "destination": {"latitude": 17.450, "longitude": 78.385},
            }
        )
        self.assertIn("confidence_interval", eta)
        self.assertIn("reliability_breakdown", eta)
        self.assertGreater(eta["event_multiplier"], 1.0)

        # Explainable AI route recommendation
        expl = assistant_query(
            {
                "query": "Why is this route recommended?",
                "route_context": {
                    "mode": "METRO",
                    "optimize_for": "RELIABILITY",
                    "duration_seconds": 1140,
                    "p90_seconds": 1260,
                    "reliability_score": 0.94,
                    "cost_inr": 35,
                    "compared_mode": "CAR",
                    "compared_duration_seconds": 1680,
                },
            }
        )
        self.assertIn("explain_route", expl["detected_intents"])
        self.assertIn("explainability", expl)
        self.assertGreaterEqual(len(expl["explainability"]["factors"]), 3)

    def test_twelve_pillar_city_digital_twin_safety_memory_and_privacy(self) -> None:
        from nexora.inference.api import (
            assistant_proactive_brief,
            assess_pedestrian_safety,
            get_digital_twin_state,
            observe_road_memory,
            predict_animal_conflict,
            predict_crowd,
            privacy_aggregate,
            query_road_memory,
            record_animal_sighting,
            simulate_urban_intervention,
        )

        # 1. Road Memory quorum verification & persistence
        n1 = observe_road_memory(
            {
                "latitude": 12.9716,
                "longitude": 77.5946,
                "condition_type": "chronic_waterlogging",
                "severity": "high",
            }
        )
        n2 = observe_road_memory(
            {
                "latitude": 12.9717,
                "longitude": 77.5947,
                "condition_type": "chronic_waterlogging",
                "severity": "high",
            }
        )
        self.assertEqual(n2["node"]["observation_count"], 2)
        self.assertGreater(n2["node"]["confidence"], n1["node"]["confidence"])
        corridor_mem = query_road_memory(lat=12.9716, lon=77.5946)
        self.assertGreaterEqual(len(corridor_mem["nodes"]), 1)

        # 2. Animal-Vehicle Conflict + Sighting Ingestion
        record_animal_sighting(
            {
                "latitude": 12.9718,
                "longitude": 77.5948,
                "species_group": "stray_cattle",
                "severity": "high",
            }
        )
        animal = predict_animal_conflict(
            {"latitude": 12.9718, "longitude": 77.5948, "vehicle_speed_kph": 55.0, "weather": "rain"}
        )
        self.assertGreater(animal["conflict_risk_score"], 0.45)
        self.assertGreaterEqual(len(animal["nearby_zones"]), 1)

        # 3. Pedestrian Safety Intelligence
        ped = assess_pedestrian_safety(
            {"latitude": 12.9716, "longitude": 77.5946, "avg_vehicle_speed_kph": 52.0, "active_hazards": 2, "weather": "rain"}
        )
        self.assertIn("walk_safety_score", ped)
        self.assertLess(ped["walk_safety_score"], 85.0)

        # 4. Predictive Crowd & Unified City Digital Twin State
        crowd = predict_crowd({"latitude": 12.9716, "longitude": 77.5946})
        self.assertEqual(len(crowd["forecasts"]), 3)
        twin = get_digital_twin_state({"latitude": 12.9716, "longitude": 77.5946})
        self.assertIn("cross_domain", twin)
        self.assertIn("pedestrian_safety", twin)
        self.assertIn("animal_conflict", twin)

        # 5. Urban What-If Simulation
        sim = simulate_urban_intervention(
            {"latitude": 12.9716, "longitude": 77.5946, "intervention_type": "car_free_zone", "intensity_pct": 50}
        )
        self.assertGreater(sim["deltas"]["pedestrian_safety_delta"], 0)
        self.assertGreater(sim["deltas"]["co2_reduction_pct"], 0)

        # 6. Privacy-Preserving Crowd Intelligence (k-anonymity suppression + DP publish)
        low_cohort = [{"latitude": 12.9716, "longitude": 77.5946, "ephemeral_token": "u1", "speed_kph": 28}]
        suppressed = privacy_aggregate({"samples": low_cohort, "k_min": 5, "epsilon": 0.5})
        self.assertEqual(suppressed["published_count"], 0)
        self.assertEqual(suppressed["suppressed_count"], 1)
        self.assertTrue(suppressed["cells"][0]["suppressed_below_k"])

        high_cohort = [
            {"latitude": 12.9716, "longitude": 77.5946, "ephemeral_token": f"tok-{i}", "speed_kph": 26 + i}
            for i in range(6)
        ]
        published = privacy_aggregate({"samples": high_cohort, "k_min": 5, "epsilon": 0.5})
        self.assertEqual(published["published_count"], 1)
        self.assertFalse(published["cells"][0]["suppressed_below_k"])

        # 7. Autonomous Mobility Agent Proactive Brief
        brief = assistant_proactive_brief({"latitude": 12.9716, "longitude": 77.5946})
        self.assertIn("headline", brief)
        self.assertIn("alerts", brief)


if __name__ == "__main__":
    unittest.main()
