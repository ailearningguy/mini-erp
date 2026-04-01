# ERP Architecture v2.2 — Implementation Checklist

## Phase 0 — Foundation

### Project Structure

* [ ] Separate layers: core / modules / plugins
* [ ] Prevent cross-module imports
* [ ] Prevent plugin access to module internals

### Architecture Enforcement

* [ ] ESLint rules:

  * [ ] No cross-module imports
  * [ ] No repository injection in plugins
  * [ ] No domain event emission from plugins
* [ ] Runtime validation:

  * [ ] DI graph validation
  * [ ] Plugin permission validation
  * [ ] Service binding validation

### Config System

* [ ] Zod config schema
* [ ] Validate at startup
* [ ] Fail-fast on invalid config

---

## Phase 1 — Database & Migration

### ORM (Drizzle)

* [ ] Setup Drizzle ORM
* [ ] Use schema.ts as source of truth
* [ ] Enforce camelCase (TS) / snake_case (DB)

### Migration

* [ ] Setup drizzle-kit
* [ ] Create migration pipeline

### Migration Rules (CI enforced)

* [ ] No NOT NULL without default

* [ ] Must include statement_timeout

* [ ] Detect destructive SQL

* [ ] Ensure rollback support

* [ ] Setup migration linter in CI

---

## Phase 2 — Event System

### EventBus

* [ ] Implement emit(event, tx)
* [ ] Throw if tx missing
* [ ] Outbox write in same transaction

### Outbox

* [ ] Create outbox table
* [ ] Worker to poll and publish
* [ ] Use FOR UPDATE SKIP LOCKED

### Event Schema Registry

* [ ] Implement schema registry (Zod/JSON)
* [ ] Register all event schemas
* [ ] Validate on produce and consume

### Event Consumer

* [ ] Dedup via processed-event store
* [ ] Double-check pattern
* [ ] Per-aggregate FIFO queue
* [ ] ACK after commit

### Event Rate Limiting

* [ ] Token bucket per event type
* [ ] Configure limits and burst

---

## Phase 3 — Idempotency

### API

* [ ] Redis idempotency store
* [ ] TTL = 24h

### Event

* [ ] processed_events table
* [ ] Dedup logic

### Jobs

* [ ] BullMQ jobId dedup
* [ ] Retry + backoff

---

## Phase 4 — Saga

### Orchestrator

* [ ] Implement centralized saga orchestrator
* [ ] Execute + compensate steps

### Persistence

* [ ] saga_state table
* [ ] Track status, steps, context

### Recovery

* [ ] Resume RUNNING sagas
* [ ] Resume COMPENSATING sagas

### Retention

* [ ] Add ttlAt field
* [ ] Daily cleanup job

---

## Phase 5 — Plugin System

### Core

* [ ] Plugin lifecycle (activate, deactivate, dispose)

### Permissions

* [ ] Define permission manifest
* [ ] Validate at activation

### Security

* [ ] Enforce trusted-only plugins (Phase 1)
* [ ] Block untrusted plugins

### Storage

* [ ] Enforce naming convention: plugin_{name}_*

---

## Phase 6 — External Integration

### Proxy Layer

* [ ] All external calls via proxy
* [ ] Permission validation

### Circuit Breaker

* [ ] Implement CLOSED / OPEN / HALF-OPEN
* [ ] Configure thresholds

### Fallback

* [ ] Define fallback per service

---

## Phase 7 — API

### Validation

* [ ] Global validation pipe

### Response Format

* [ ] Enforce {data, meta} / {error}
* [ ] Include request_id

### Rate Limiting

* [ ] Redis-based limits

### Security

* [ ] Helmet
* [ ] JWT RS256
* [ ] Token rotation + revocation

---

## Phase 8 — Cache & Read Model

### Cache

* [ ] Redis cache-aside
* [ ] TTL per entity
* [ ] Event-driven invalidation

### Fail-safe Cache

* [ ] Fallback to DB on cache failure

---

## Phase 9 — Deployment & Ops

### Deployment

* [ ] Blue/Green deployment
* [ ] Smoke + integration tests

### Migration Flow

* [ ] DB migrate before deploy

### Rollback

* [ ] Auto rollback rules
* [ ] Rollback under 60s

### Monitoring

* [ ] Event metrics
* [ ] Saga metrics
* [ ] DLQ alerts

---

## Phase 10 — Production Hardening

* [ ] Cache stampede protection
* [ ] Outbox optimization (optional CDC)
* [ ] Schema lifecycle management
* [ ] Plugin process isolation (Phase 2)

---

## Definition of Done

* [ ] All ADR rules enforced by code/CI
* [ ] Event system idempotent and ordered
* [ ] Migration linter passes
* [ ] Saga recovery works
* [ ] Plugin permissions validated
* [ ] Rollback tested
