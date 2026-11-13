"""Event-driven intelligence consumer for AWS SQS (Always Free Tier: 1M requests/month).
Consumes SNS/SQS mobility events with 20s long-polling and updates online models in real time.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections import deque
from datetime import datetime, timezone
from typing import Any

from nexora.geospatial.h3_grid import clean_trajectory, discover_hotspots, latlon_to_h3
from nexora.models.demand_forecaster import MobilityDemandForecaster
from nexora.models.traffic_forecaster import SpatioTemporalTrafficForecaster

logger = logging.getLogger("nexora.events")


class OnlineIntelligenceState:
    """Thread-safe online feature store updated by SQS / webhook events with disk checkpointing."""

    def __init__(
        self,
        traffic: SpatioTemporalTrafficForecaster,
        demand: MobilityDemandForecaster,
        checkpoint_path: str = "/tmp/nexora_brain_checkpoint.json",
    ) -> None:
        self.traffic = traffic
        self.demand = demand
        self.checkpoint_path = checkpoint_path
        self.gps_buffer: deque[dict[str, Any]] = deque(maxlen=1000)
        self.active_hazards: deque[dict[str, Any]] = deque(maxlen=200)
        self.finance_events: deque[dict[str, Any]] = deque(maxlen=500)
        self.voice_events: deque[dict[str, Any]] = deque(maxlen=500)
        self.health_events: deque[dict[str, Any]] = deque(maxlen=500)
        self.processed_event_ids: deque[str] = deque(maxlen=2000)
        self.events_processed: int = 0
        self.sqs_polls: int = 0
        self.last_event_at: str | None = None
        self._load_checkpoint()

    def _load_checkpoint(self) -> None:
        if not self.checkpoint_path or not os.path.exists(self.checkpoint_path):
            return
        try:
            with open(self.checkpoint_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            self.events_processed = int(data.get("events_processed", 0))
            self.last_event_at = data.get("last_event_at")
            for hz in data.get("active_hazards", [])[-200:]:
                if isinstance(hz, dict):
                    self.active_hazards.append(hz)
            for pt in data.get("gps_buffer", [])[-500:]:
                if isinstance(pt, dict):
                    self.gps_buffer.append(pt)
        except Exception as exc:
            logger.debug("checkpoint load skipped: %s", exc)

    def _save_checkpoint(self) -> None:
        if not self.checkpoint_path:
            return
        try:
            payload = {
                "events_processed": self.events_processed,
                "last_event_at": self.last_event_at,
                "active_hazards": list(self.active_hazards)[-50:],
                "gps_buffer": list(self.gps_buffer)[-200:],
            }
            with open(self.checkpoint_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
        except Exception as exc:
            logger.debug("checkpoint save skipped: %s", exc)

    def handle_event(self, raw_event: dict[str, Any]) -> bool:
        """Process a single NEXORA event envelope idempotently. Returns True if newly processed."""
        # Unwrap SNS notification wrapper if non-raw delivery was used
        if "Message" in raw_event and isinstance(raw_event["Message"], str):
            try:
                raw_event = json.loads(raw_event["Message"])
            except Exception:
                pass

        event_id = str(raw_event.get("event_id") or "")
        if event_id and event_id in self.processed_event_ids:
            return False
        if event_id:
            self.processed_event_ids.append(event_id)

        etype = str(raw_event.get("event_type") or "")
        payload = raw_event.get("payload") if isinstance(raw_event.get("payload"), dict) else raw_event

        if etype.startswith("traffic.observed"):
            seg_id = str(payload.get("segment_id") or "")
            spd = payload.get("speed_kmph")
            if seg_id and spd is not None:
                self.traffic.record_observation(seg_id, float(spd))

        elif etype.startswith("location.observed") or etype.startswith("location.batch"):
            samples = payload.get("samples")
            if isinstance(samples, list):
                cleaned = clean_trajectory(samples)["cleaned"]
                for pt in cleaned:
                    self.gps_buffer.append(pt)
                    self.demand.record_cell_ping(pt["h3_index"], 1)
            elif "latitude" in payload and "longitude" in payload:
                lat, lon = float(payload["latitude"]), float(payload["longitude"])
                cell = latlon_to_h3(lat, lon, 8)
                self.gps_buffer.append({"latitude": lat, "longitude": lon, "speed_mps": float(payload.get("speed_mps", 6.0)), "h3_index": cell})
                self.demand.record_cell_ping(cell, 1)

        elif etype.startswith("trip.started"):
            lat = payload.get("latitude")
            lon = payload.get("longitude")
            if lat is not None and lon is not None:
                self.demand.record_cell_ping(latlon_to_h3(float(lat), float(lon), 8), 2)

        elif etype.startswith("hazard.reported"):
            self.active_hazards.append(payload)

        elif etype.startswith("finance."):
            self.finance_events.append({"event_type": etype, "payload": payload})

        elif etype.startswith("voice."):
            self.voice_events.append({"event_type": etype, "payload": payload})

        elif etype.startswith("health.consent.revoked"):
            uid = str(payload.get("user_id") or "")
            self.health_events = deque(
                [e for e in self.health_events if str(e.get("payload", {}).get("user_id") or "") != uid],
                maxlen=500,
            )

        elif etype.startswith("health."):
            self.health_events.append({"event_type": etype, "payload": payload})

        self.events_processed += 1
        self.last_event_at = datetime.now(timezone.utc).isoformat()
        self._save_checkpoint()
        return True

    def current_hotspots(self) -> list[dict[str, Any]]:
        return discover_hotspots(list(self.gps_buffer))


async def run_sqs_consumer_loop(state: OnlineIntelligenceState, stop_event: asyncio.Event) -> None:
    """Long-polls AWS SQS when SQS_INTELLIGENCE_QUEUE_URL is configured."""
    queue_url = os.getenv("SQS_INTELLIGENCE_QUEUE_URL", "").strip()
    region = os.getenv("AWS_REGION", "ap-south-1").strip()
    if not queue_url:
        logger.info("SQS_INTELLIGENCE_QUEUE_URL not set; SQS background poller idle (HTTP event ingestion active)")
        return

    try:
        import boto3  # type: ignore
    except Exception:
        logger.warning("boto3 not installed; SQS consumer disabled")
        return

    sqs = boto3.client("sqs", region_name=region)
    logger.info("starting SQS intelligence consumer on %s", queue_url)

    while not stop_event.is_set():
        try:
            resp = await asyncio.to_thread(
                sqs.receive_message,
                QueueUrl=queue_url,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=20,  # long polling keeps requests well inside 1M/mo free tier
            )
            state.sqs_polls += 1
            messages = resp.get("Messages", [])
            for msg in messages:
                body_str = msg.get("Body", "{}")
                try:
                    event = json.loads(body_str)
                    state.handle_event(event)
                except Exception as exc:
                    logger.warning("invalid SQS message payload: %s", exc)
                receipt = msg.get("ReceiptHandle")
                if receipt:
                    await asyncio.to_thread(
                        sqs.delete_message,
                        QueueUrl=queue_url,
                        ReceiptHandle=receipt,
                    )
        except Exception as exc:
            logger.warning("SQS poll error (retrying in 5s): %s", exc)
            await asyncio.sleep(5.0)
