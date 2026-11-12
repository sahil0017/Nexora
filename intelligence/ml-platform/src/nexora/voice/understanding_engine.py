"""Workstreams 4, 5, 6, 7 & 8 — Conversation Understanding, Reasoning, Memory, Actions & Verification.

Implements:
- WS4 Conversation Intelligence: Topics, dialogue acts, intents, and ConversationEventIR
  (request, proposal, commitment, decision, question, disagreement).
- WS5 Reasoning Intelligence: Contradiction detection, negotiation shifts, causal links,
  temporal changes, and explicit uncertainty findings.
- WS6 Memory Intelligence: Entity resolution, temporal knowledge graph triples, and
  hybrid lexical + deterministic dense vector similarity search.
- WS7 Action Intelligence: Human-in-the-loop suggested notes, reminders, tasks, follow-ups.
- WS8 Verification Intelligence: Calibrated confidence tiers and SourceEvidenceRef grounding
  so every answer and extracted claim traces directly back to exact utterance timestamps.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import math
import re
import time
import uuid
from typing import Any

from nexora.voice.ir import (
    ActionSuggestionIR,
    ConversationEventIR,
    ExtractedKnowledgeIR,
    InteractionEdgeIR,
    KnowledgeEdgeIR,
    KnowledgeEntityIR,
    ModelTelemetryIR,
    ParticipantIR,
    ReasoningResultIR,
    SourceEvidenceRef,
    UtteranceIR,
)

_TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "finance_budget": ("budget", "cost", "price", "invoice", "lakhs", "crore", "inr", "rupees", "payment", "quote"),
    "engineering_delivery": ("deploy", "release", "api", "migration", "sprint", "deadline", "bug", "architecture", "test"),
    "product_roadmap": ("launch", "feature", "milestone", "scope", "design", "customer", "pilot", "roadmap"),
    "legal_compliance": ("contract", "nda", "consent", "audit", "retention", "compliance", "policy", "hold"),
    "scheduling_ops": ("meeting", "tomorrow", "friday", "monday", "next week", "calendar", "schedule", "call"),
}

_DATE_RE = re.compile(
    r"\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"next week|next month|q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}-\d{2}-\d{2})\b",
    re.IGNORECASE,
)
_AMOUNT_RE = re.compile(r"(?:₹|rs\.?|inr|\$|usd)\s*[0-9,]+(?:\.[0-9]+)?(?:\s*(?:k|lakh|lakhs|cr|crore|m))?", re.IGNORECASE)
_PROPER_NOUN_RE = re.compile(r"\b([A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]{2,})?)\b")


def deterministic_embedding(text: str, dims: int = 32) -> list[float]:
    """Generate a normalized deterministic dense feature vector for portable pgvector/lexical search."""
    vec = [0.0] * dims
    tokens = re.findall(r"[a-z0-9\u0900-\u097F\u0C00-\u0C7F]+", text.lower())
    if not tokens:
        return vec
    for tok in tokens:
        digest = hashlib.sha256(tok.encode("utf-8")).digest()
        idx = digest[0] % dims
        sign = 1.0 if (digest[1] % 2 == 0) else -1.0
        vec[idx] += sign * (1.0 + (digest[2] / 255.0) * 0.5)
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 5) for v in vec]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return round(sum(x * y for x, y in zip(a, b)), 4)


def _classify_utterance(text: str) -> tuple[str, str, str, str]:
    """Return (event_type, dialogue_act, intent, topic) for an utterance."""
    lower = text.lower()
    topic = "general"
    best_hits = 0
    for t_name, kws in _TOPIC_KEYWORDS.items():
        hits = sum(1 for kw in kws if kw in lower)
        if hits > best_hits:
            best_hits = hits
            topic = t_name

    if "?" in text or lower.startswith(("can we", "could we", "when ", "what ", "why ", "how ", "who ")):
        return "question", "question", "seek_clarification", topic
    if any(p in lower for p in ("disagree", "cannot", "can't", "won't work", "no, ", "push back", "concern", "risk")):
        return "disagreement", "reject", "raise_objection", topic
    if any(p in lower for p in ("decided", "finalized", "approved", "let's go with", "agreed on", "we will lock")):
        return "decision", "declaration", "confirm_decision", topic
    if any(p in lower for p in ("i will", "i'll", "we will", "we'll", "i promise", "by friday", "by tomorrow", "commit")):
        return "commitment", "commissive", "commit_deliverable", topic
    if any(p in lower for p in ("propose", "suggest", "how about", "what if we", "option is", "recommend")):
        return "proposal", "offer", "propose_option", topic
    if any(p in lower for p in ("please", "need you to", "can you", "send me", "prepare", "share the")):
        return "request", "directive", "request_action", topic
    return "statement", "inform", "share_update", topic


def resolve_interaction_dynamics(
    utterances: list[UtteranceIR],
    participants: list[ParticipantIR] | None = None,
) -> list[InteractionEdgeIR]:
    """Resolve who is speaking to whom and what each speaker is communicating dynamically."""
    name_by_label: dict[str, str] = {}
    label_by_first_name: dict[str, str] = {}
    for p in participants or []:
        name_by_label[p.speaker_label] = p.display_name
        first_tok = p.display_name.strip().split()[0].lower() if p.display_name.strip() else ""
        if first_tok and len(first_tok) >= 2 and first_tok not in {"speaker", "remote", "user"}:
            label_by_first_name[first_tok] = p.speaker_label

    edge_acc: dict[tuple[str, str], dict[str, Any]] = {}

    for idx, utt in enumerate(utterances):
        ev_type, d_act, _, topic = _classify_utterance(utt.original_text)
        lower = utt.original_text.lower()
        tokens = [t.strip(".,?!:;\"'@") for t in lower.split()]

        # 1. Detect direct vocative mention ("Ananya, ...", "@Vikram", "Hey Sahil")
        vocative_targets: list[str] = []
        for fname, lbl in label_by_first_name.items():
            if lbl != utt.speaker_label and fname in tokens:
                vocative_targets.append(lbl)

        # 2. Detect reply / counter-offer / reaction to recent prior speaker
        prev_utt = utterances[idx - 1] if idx > 0 and utterances[idx - 1].speaker_label != utt.speaker_label else None
        is_counter = any(
            kw in lower for kw in ("counter-propose", "counteroffer", "counter offer", "instead of", "instead because")
        ) or (
            (bool(_AMOUNT_RE.search(utt.original_text)) or bool(_DATE_RE.search(utt.original_text)))
            and idx > 0
            and any(
                (_AMOUNT_RE.search(u.original_text) or _DATE_RE.search(u.original_text))
                for u in utterances[:idx]
                if u.speaker_label != utt.speaker_label
            )
            and any(kw in lower for kw in ("instead", "how about", "rather", "move ", "counter"))
        )

        if vocative_targets:
            utt.to_speakers = vocative_targets
            utt.addressing_mode = "direct_vocative"
            for prev in reversed(utterances[:idx]):
                if prev.speaker_label in vocative_targets:
                    utt.addressed_utterance_id = prev.utterance_id
                    break
        elif is_counter and prev_utt is not None:
            utt.to_speakers = [prev_utt.speaker_label]
            utt.addressing_mode = "counter_offer"
            utt.addressed_utterance_id = prev_utt.utterance_id
        elif prev_utt is not None and (
            ev_type in ("disagreement", "decision", "commitment", "proposal")
            or any(u_prev_ev == "question" for u_prev_ev in [_classify_utterance(prev_utt.original_text)[0]])
            or (utt.start_ms - prev_utt.end_ms) <= 8000
        ):
            utt.to_speakers = [prev_utt.speaker_label]
            utt.addressing_mode = "reply_to_previous"
            utt.addressed_utterance_id = prev_utt.utterance_id
        else:
            other_labels = [lbl for lbl in name_by_label if lbl != utt.speaker_label]
            utt.to_speakers = ["ALL"] if len(other_labels) > 1 or not other_labels else other_labels
            utt.addressing_mode = "group_broadcast"

        # 3. Synthesize concise dynamic "what is spoken"
        amounts = _AMOUNT_RE.findall(utt.original_text)
        dates = _DATE_RE.findall(utt.original_text)
        highlights = []
        if amounts:
            highlights.append(", ".join(amounts[:2]))
        if dates:
            highlights.append(f"timeline: {', '.join(dates[:2])}")
        from_name = name_by_label.get(utt.speaker_label, utt.speaker_label)
        to_names = [name_by_label.get(t, t) for t in utt.to_speakers]
        act_label = ev_type if ev_type != "statement" else d_act
        topic_label = topic.replace("_", " ")
        detail = f" ({'; '.join(highlights)})" if highlights else ""
        utt.what_is_spoken = f"{from_name} -> {', '.join(to_names)}: {act_label} on {topic_label}{detail}"

        # 4. Aggregate directed speaker-to-speaker interaction graph edges
        for target_lbl in utt.to_speakers:
            key = (utt.speaker_label, target_lbl)
            if key not in edge_acc:
                edge_acc[key] = {
                    "from_speaker": utt.speaker_label,
                    "from_name": from_name,
                    "to_speaker": target_lbl,
                    "to_name": name_by_label.get(target_lbl, "All Participants" if target_lbl == "ALL" else target_lbl),
                    "turn_count": 0,
                    "last_topic": topic,
                    "acts": [],
                    "sample_summary": utt.what_is_spoken,
                }
            rec = edge_acc[key]
            rec["turn_count"] += 1
            rec["last_topic"] = topic
            if act_label not in rec["acts"]:
                rec["acts"].append(act_label)
            rec["sample_summary"] = utt.what_is_spoken

    total_turns = max(1, len(utterances))
    edges = [
        InteractionEdgeIR(
            from_speaker=v["from_speaker"],
            from_name=v["from_name"],
            to_speaker=v["to_speaker"],
            to_name=v["to_name"],
            turn_count=v["turn_count"],
            last_topic=v["last_topic"],
            primary_acts=v["acts"],
            strength=round(v["turn_count"] / total_turns, 3),
            sample_summary=v["sample_summary"],
        )
        for v in edge_acc.values()
    ]
    edges.sort(key=lambda e: e.turn_count, reverse=True)
    return edges


def analyze_conversation(
    conversation_id: str,
    utterances: list[UtteranceIR],
    participants_names: list[str] | None = None,
    participants: list[ParticipantIR] | None = None,
) -> dict[str, Any]:
    """Execute Workstreams 4, 5, 6, 7 & 8 over aligned UtteranceIR objects."""
    t0 = time.perf_counter()
    now_iso = datetime.now(timezone.utc).isoformat()
    interaction_edges = resolve_interaction_dynamics(utterances, participants=participants)
    events: list[ConversationEventIR] = []
    evidence_refs: list[SourceEvidenceRef] = []
    topics_seen: list[str] = []

    for utt in utterances:
        ev_type, d_act, intent, topic = _classify_utterance(utt.original_text)
        if topic != "general" and topic not in topics_seen:
            topics_seen.append(topic)

        if ev_type != "statement":
            due_match = _DATE_RE.search(utt.original_text)
            ev_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:ev:{utt.utterance_id}"))
            ev_conf = round(max(0.4, min(0.96, utt.confidence * 0.96)), 3)
            events.append(
                ConversationEventIR(
                    event_id=ev_id,
                    event_type=ev_type,
                    summary=utt.original_text[:200],
                    actor_speaker=utt.speaker_label,
                    topic=topic,
                    dialogue_act=d_act,
                    intent=intent,
                    confidence=ev_conf,
                    source_utterance_ids=[utt.utterance_id],
                    due_at=due_match.group(0) if due_match else None,
                    status="open",
                )
            )
            evidence_refs.append(
                SourceEvidenceRef(
                    ref_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ref:{ev_id}")),
                    target_kind="conversation_event",
                    target_id=ev_id,
                    utterance_id=utt.utterance_id,
                    speaker_label=utt.speaker_label,
                    start_ms=utt.start_ms,
                    end_ms=utt.end_ms,
                    quote=utt.original_text,
                    confidence=ev_conf,
                )
            )

    if not topics_seen:
        topics_seen = ["general"]

    # Workstream 5 — Reasoning Intelligence (Contradictions, Negotiation, Causality, Temporal, Uncertainty)
    findings: list[ReasoningResultIR] = []

    # 1. Contradiction / timeline or numeric tension across utterances
    dates_by_utt: list[tuple[UtteranceIR, str]] = []
    amounts_by_utt: list[tuple[UtteranceIR, str]] = []
    for utt in utterances:
        for m in _DATE_RE.findall(utt.original_text):
            dates_by_utt.append((utt, m.lower()))
        for m in _AMOUNT_RE.findall(utt.original_text):
            amounts_by_utt.append((utt, m.lower()))

    distinct_dates = sorted({d for _, d in dates_by_utt})
    if len(distinct_dates) >= 2:
        u1 = dates_by_utt[0][0]
        u2 = next((u for u, d in dates_by_utt if d != dates_by_utt[0][1]), dates_by_utt[-1][0])
        findings.append(
            ReasoningResultIR(
                finding_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:reason:date_shift")),
                finding_type="temporal_change",
                severity="medium",
                title=f"Multiple timeline anchors referenced ({', '.join(distinct_dates[:3])})",
                explanation=f"Speakers referenced shifting dates across utterances ({dates_by_utt[0][1]} vs {distinct_dates[-1]}). Verify final commitment deadline.",
                confidence=0.81,
                evidence_utterance_ids=[u1.utterance_id, u2.utterance_id],
            )
        )

    distinct_amounts = sorted({a for _, a in amounts_by_utt})
    if len(distinct_amounts) >= 2:
        u1 = amounts_by_utt[0][0]
        u2 = next((u for u, a in amounts_by_utt if a != amounts_by_utt[0][1]), amounts_by_utt[-1][0])
        findings.append(
            ReasoningResultIR(
                finding_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:reason:negotiation")),
                finding_type="negotiation_shift",
                severity="high",
                title=f"Value/pricing negotiation detected ({' vs '.join(distinct_amounts[:2])})",
                explanation="Multiple monetary figures appeared in the exchange, indicating an offer/counter-offer or budget revision.",
                confidence=0.84,
                evidence_utterance_ids=[u1.utterance_id, u2.utterance_id],
            )
        )

    # Disagreement vs commitment/decision contradiction check
    disagreements = [e for e in events if e.event_type == "disagreement"]
    decisions = [e for e in events if e.event_type in ("decision", "commitment")]
    if disagreements and decisions:
        findings.append(
            ReasoningResultIR(
                finding_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:reason:contradiction")),
                finding_type="contradiction",
                severity="high",
                title="Unresolved tension between objection and decision",
                explanation=f"'{disagreements[0].summary[:90]}' conflicts with '{decisions[0].summary[:90]}'.",
                confidence=0.79,
                evidence_utterance_ids=disagreements[0].source_utterance_ids + decisions[0].source_utterance_ids,
            )
        )

    # Causal links
    for utt in utterances:
        lower = utt.original_text.lower()
        if any(cue in lower for cue in ("because ", "due to ", "therefore ", "so that ", "as a result")):
            findings.append(
                ReasoningResultIR(
                    finding_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:causal:{utt.utterance_id}")),
                    finding_type="causal_link",
                    severity="low",
                    title="Causal rationale stated in conversation",
                    explanation=utt.original_text[:180],
                    confidence=round(min(0.92, utt.confidence), 3),
                    evidence_utterance_ids=[utt.utterance_id],
                )
            )
            break

    # Explicit uncertainty reporting
    low_conf_utts = [u for u in utterances if u.confidence < 0.72 or u.uncertainty_reason]
    if low_conf_utts:
        findings.append(
            ReasoningResultIR(
                finding_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:uncertainty")),
                finding_type="uncertainty",
                severity="medium",
                title=f"{len(low_conf_utts)} utterance(s) flagged for acoustic or overlap uncertainty",
                explanation="Human review recommended before treating flagged turns as verified facts.",
                confidence=0.9,
                evidence_utterance_ids=[u.utterance_id for u in low_conf_utts[:5]],
            )
        )

    # Workstream 6 — Entity Resolution & Temporal Knowledge Graph
    entities_map: dict[tuple[str, str], KnowledgeEntityIR] = {}
    edges: list[KnowledgeEdgeIR] = []

    def add_entity(name: str, etype: str, extra: dict[str, Any] | None = None) -> str:
        clean = name.strip()
        key = (etype, clean.lower())
        if key not in entities_map:
            ent_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ent:{etype}:{clean.lower()}"))
            entities_map[key] = KnowledgeEntityIR(
                entity_id=ent_id,
                canonical_name=clean,
                entity_type=etype,
                aliases=[clean],
                attributes=extra or {},
                embedding=deterministic_embedding(f"{etype} {clean}"),
            )
        return entities_map[key].entity_id

    for p_name in participants_names or []:
        if p_name.strip():
            add_entity(p_name.strip(), "person", {"source": "speaker_attribution"})
    for topic in topics_seen:
        add_entity(topic.replace("_", " ").title(), "topic")

    for utt in utterances:
        for amt in _AMOUNT_RE.findall(utt.original_text):
            amt_id = add_entity(amt.strip(), "amount")
            spk_id = add_entity(utt.speaker_label, "person")
            edges.append(
                KnowledgeEdgeIR(
                    from_entity=spk_id,
                    to_entity=amt_id,
                    relation_type="referenced_amount",
                    confidence=utt.confidence,
                    valid_from=now_iso,
                    evidence_utterance_id=utt.utterance_id,
                )
            )
        for dt in _DATE_RE.findall(utt.original_text):
            dt_id = add_entity(dt.strip(), "date")
            spk_id = add_entity(utt.speaker_label, "person")
            edges.append(
                KnowledgeEdgeIR(
                    from_entity=spk_id,
                    to_entity=dt_id,
                    relation_type="referenced_date",
                    confidence=utt.confidence,
                    valid_from=now_iso,
                    evidence_utterance_id=utt.utterance_id,
                )
            )
        for noun in _PROPER_NOUN_RE.findall(utt.original_text):
            if noun.lower() not in {"speaker", "today", "tomorrow", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}:
                add_entity(noun, "deliverable")

    knowledge = ExtractedKnowledgeIR(entities=list(entities_map.values()), edges=edges[:30])

    # Workstream 7 — Action Intelligence (Human-in-the-Loop suggestions)
    actions: list[ActionSuggestionIR] = []
    # Always produce a structured summary note suggestion
    note_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:action:note"))
    note_refs = [
        SourceEvidenceRef(
            ref_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"noteref:{u.utterance_id}")),
            target_kind="action_suggestion",
            target_id=note_id,
            utterance_id=u.utterance_id,
            speaker_label=u.speaker_label,
            start_ms=u.start_ms,
            end_ms=u.end_ms,
            quote=u.original_text[:140],
            confidence=u.confidence,
        )
        for u in utterances[:2]
    ]
    actions.append(
        ActionSuggestionIR(
            action_id=note_id,
            action_type="note",
            title=f"Structured summary note ({topics_seen[0].replace('_', ' ')})",
            rationale=f"Captures {len(events)} key conversational event(s) with speaker attribution.",
            confidence=0.88,
            requires_approval=True,
            status="suggested",
            payload={"topics": topics_seen, "event_count": len(events)},
            evidence_refs=note_refs,
        )
    )

    for ev in events:
        if ev.event_type in ("commitment", "request", "decision", "question"):
            act_type = "reminder" if ev.due_at else ("follow_up" if ev.event_type == "question" else "task")
            act_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{conversation_id}:action:{ev.event_id}"))
            ev_ref = [r for r in evidence_refs if r.target_id == ev.event_id]
            actions.append(
                ActionSuggestionIR(
                    action_id=act_id,
                    action_type=act_type,
                    title=ev.summary[:100],
                    rationale=f"Derived from {ev.event_type} by {ev.actor_speaker}" + (f" (due: {ev.due_at})" if ev.due_at else ""),
                    confidence=ev.confidence,
                    requires_approval=True,
                    status="suggested",
                    payload={"event_id": ev.event_id, "due_at": ev.due_at, "speaker": ev.actor_speaker},
                    evidence_refs=ev_ref,
                )
            )

    # Workstream 8 — Calibrated Confidence & Summary
    mean_utt_conf = sum(u.confidence for u in utterances) / max(1, len(utterances))
    overall_confidence = round(max(0.1, min(0.98, mean_utt_conf - (0.08 if low_conf_utts else 0.0))), 3)
    if not utterances:
        tier = "INSUFFICIENT_DATA"
    elif overall_confidence >= 0.85 and not low_conf_utts:
        tier = "HIGH"
    elif overall_confidence >= 0.65:
        tier = "MEDIUM"
    else:
        tier = "LOW"

    summary_parts = [
        f"{len(utterances)} speaker-attributed utterance(s)",
        f"{len(events)} structured event(s)",
    ]
    if findings:
        summary_parts.append(f"{len(findings)} reasoning finding(s)")
    summary = " · ".join(summary_parts) + f" across topics: {', '.join(topics_seen)}."

    latency_ms = round((time.perf_counter() - t0) * 1000.0, 3)
    telemetry = ModelTelemetryIR(
        stage="understanding",
        adapter_name="nexora-conversation-reasoner-v1",
        routing_reason="Deterministic dialogue-act, contradiction, causal & KG extractor",
        fallback_used=False,
        latency_ms=latency_ms,
        confidence=overall_confidence,
        cost_units=0.01,
    )

    return {
        "summary": summary,
        "topics": topics_seen,
        "overall_confidence": overall_confidence,
        "confidence_tier": tier,
        "events": events,
        "findings": findings,
        "knowledge": knowledge,
        "actions": actions,
        "evidence_refs": evidence_refs,
        "interaction_edges": interaction_edges,
        "telemetry": telemetry,
    }


_QA_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "did", "do", "does",
    "for", "from", "had", "has", "have", "how", "i", "in", "is", "it", "of", "on",
    "or", "that", "the", "this", "to", "was", "we", "were", "what", "when", "where",
    "which", "who", "why", "will", "with", "would", "you",
}


def answer_grounded_question(
    question: str,
    conversation_records: list[dict[str, Any]],
) -> dict[str, Any]:
    """Workstream 6 & 8: Hybrid lexical + dense vector retrieval & source-grounded Q&A."""
    q_clean = question.strip()
    if not q_clean:
        return {
            "answer": "Please provide a specific question to search your recorded conversations.",
            "confidence": 0.0,
            "confidence_tier": "INSUFFICIENT_DATA",
            "citations": [],
        }
    raw_tokens = set(re.findall(r"[a-z0-9\u0900-\u097F\u0C00-\u0C7F]+", q_clean.lower()))
    q_tokens = {t for t in raw_tokens if t not in _QA_STOPWORDS and len(t) > 1} or raw_tokens
    q_vec = deterministic_embedding(" ".join(sorted(q_tokens)))
    scored: list[tuple[float, dict[str, Any]]] = []

    for conv in conversation_records:
        conv_id = str(conv.get("conversation_id") or "")
        conv_title = str(conv.get("title") or "")
        for utt in conv.get("utterances") or []:
            text = str(utt.get("original_text") or "")
            u_raw = set(re.findall(r"[a-z0-9\u0900-\u097F\u0C00-\u0C7F]+", text.lower()))
            u_tokens = {t for t in u_raw if t not in _QA_STOPWORDS and len(t) > 1}
            overlap = q_tokens & u_tokens
            lexical = len(overlap) / max(1, len(q_tokens))
            semantic = max(0.0, cosine_similarity(q_vec, deterministic_embedding(text)))
            score = round(0.65 * lexical + 0.35 * semantic, 4)
            if overlap and score >= 0.14:
                scored.append(
                    (
                        score,
                        {
                            "conversation_id": conv_id,
                            "conversation_title": conv_title,
                            "utterance_id": utt.get("utterance_id"),
                            "speaker_label": utt.get("speaker_label"),
                            "start_ms": utt.get("start_ms", 0),
                            "end_ms": utt.get("end_ms", 0),
                            "quote": text,
                            "score": score,
                            "utterance_confidence": utt.get("confidence", 0.8),
                        },
                    )
                )

    scored.sort(key=lambda item: item[0], reverse=True)
    top = [item[1] for item in scored[:4]]
    if not top:
        return {
            "answer": "No grounded evidence found in stored utterances for this question.",
            "confidence": 0.15,
            "confidence_tier": "INSUFFICIENT_DATA",
            "citations": [],
        }

    best = top[0]
    avg_conf = round(min(0.95, max(0.35, (best["score"] * 0.5 + float(best["utterance_confidence"]) * 0.5))), 3)
    tier = "HIGH" if avg_conf >= 0.8 else ("MEDIUM" if avg_conf >= 0.6 else "LOW")
    answer_lines = [
        f"Based on {len(top)} grounded utterance(s), {best['speaker_label']} stated: \"{best['quote']}\""
    ]
    if len(top) > 1:
        answer_lines.append(
            f"Related context from {top[1]['speaker_label']}: \"{top[1]['quote']}\""
        )
    return {
        "answer": " ".join(answer_lines),
        "confidence": avg_conf,
        "confidence_tier": tier,
        "citations": top,
    }
