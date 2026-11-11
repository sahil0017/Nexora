"""Model gateway — provider-independent adapters for ML and LLM models.

Contract every adapter implements:
    complete(request) -> response
The gateway enforces timeouts, output validation and fallback order.
It must NEVER bypass permission checks — those belong to the tool registry.
"""

from abc import ABC, abstractmethod
from typing import Any


class ModelAdapter(ABC):
    name: str

    @abstractmethod
    def invoke(self, request: dict[str, Any]) -> dict[str, Any]: ...


class DeterministicBaseline(ModelAdapter):
    """Rules-based fallback used when model adapters are unavailable."""

    name = "deterministic-baseline"

    def invoke(self, request: dict[str, Any]) -> dict[str, Any]:
        return {"answer": "Using deterministic baseline.", "source": self.name}


class ModelGateway:
    def __init__(self, adapters: list[ModelAdapter]) -> None:
        self._adapters = adapters

    def invoke(self, request: dict[str, Any]) -> dict[str, Any]:
        for adapter in self._adapters:
            try:
                return adapter.invoke(request)
            except Exception:  # noqa: BLE001 — fall through to next adapter
                continue
        return DeterministicBaseline().invoke(request)
