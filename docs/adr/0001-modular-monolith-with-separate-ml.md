# ADR-0001: Modular monolith with independently deployed ML service

Date: 2026-11-11
Status: Accepted

## Context
NEXORA launches with five modules but a small team. Full microservices would
multiply operational overhead before load justifies it; a single codebase risks
module coupling.

## Decision
- One Go deployment unit (`nexora-api`) with strict internal package boundaries
  (platform / intelligence / modules). Modules never import each other's
  repositories directly.
- ML inference and training live in a separate Python service (`nexora-ml`).
- Background/event processing runs in a worker binary built from the same Go tree.
- Communication across modules happens through versioned events (Redpanda).

## Consequences
+ Single deploy initially, clear extraction seams later.
+ ML stack can iterate independently of product API.
− Discipline required to keep package boundaries honest.
