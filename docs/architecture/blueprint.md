# NEXORA Architecture Baseline (v1)

Locked decisions:

| Area | Decision |
|---|---|
| Product | NEXORA — intelligent life platform |
| Modules v1 | Move, Assistant, Health, Finance, Work |
| Mobile | React Native + TypeScript |
| Backend | Go + Chi, modular monolith |
| ML | Python + PyTorch, separate inference service |
| DB | PostgreSQL + PostGIS, per-module logical schemas |
| Events | Redpanda (Kafka-compatible), at-least-once, idempotent consumers |
| First geography | Hyderabad, India |

Key principles:
1. One app, not five. Common identity, navigation, design system, assistant.
2. Modules are independently usable; the assistant is an interface, not a gate.
3. Tool-level authorization on every agent invocation; explicit approval for external writes.
4. Provider adapters for routing/traffic/transit — no vendor lock-in.
5. Baseline-first intelligence: rules and provider data before trained models (ST-GNN arrives in M5).

Deployment units: `nexora-api`, `nexora-ml`, `nexora-worker` + shared infra.

Database schemas: identity, platform, intelligence, mobility, health, finance, work, notifications, audit.
