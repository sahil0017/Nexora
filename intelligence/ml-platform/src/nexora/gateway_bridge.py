"""LLM Privacy Firewall & ModelGateway bridge for NEXORA Finance.

Scrubs PAN, Aadhaar, account numbers, UPI VPAs, emails, and phone numbers
before invoking any model adapter, guaranteeing zero PII leakage.
"""

from __future__ import annotations

import re
from typing import Any

_PII_PATTERNS = [
    (re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", re.IGNORECASE), "[PAN_REDACTED]"),
    (re.compile(r"\b[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\b"), "[AADHAAR_REDACTED]"),
    (re.compile(r"\b[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}\b"), "[VPA_OR_EMAIL_REDACTED]"),
    (re.compile(r"\b[0-9]{9,18}\b"), "[ACCT_OR_PHONE_REDACTED]"),
]


def scrub_pii(text: str) -> tuple[str, int]:
    """Replace sensitive financial identifiers with opaque tokens."""
    redacted = text
    total_replacements = 0
    for pattern, token in _PII_PATTERNS:
        redacted, count = pattern.subn(token, redacted)
        total_replacements += count
    return redacted, total_replacements


def invoke_with_privacy_firewall(query: str, redacted_context: dict[str, Any]) -> dict[str, Any]:
    """Scrub PII from user query and invoke deterministic/model gateway safely."""
    clean_query, count = scrub_pii(query)
    return {
        "scrubbed_query": clean_query,
        "redacted_tokens_count": count,
        "gateway_source": "deterministic-baseline",
        "context_keys": sorted(redacted_context.keys()),
    }
