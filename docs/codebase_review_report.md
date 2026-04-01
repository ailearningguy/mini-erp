# ERP Codebase Review Report

**Date:** 2026-04-01  
**Scope:** Full backend codebase vs PROJECT-STANDARD.md, Architecture-v2.2.md, Implementation Checklist  
**Files Reviewed:** 33+ source files across `core/`, `modules/`, `plugins/`, `shared/`, `scripts/`

---

## Executive Summary

The codebase is a **well-structured skeleton** that correctly maps the Architecture v2.2 design into code. Layer separation, naming conventions, and interface contracts closely follow the standards. However, most implementations are **stubs** — the infrastructure wiring (DB, Redis, RabbitMQ) is mocked with `{} as any`, persistence methods are empty, and there are **zero tests**. The project is at roughly **Phase 0–1 skeleton** stage.

| Rating | Area |
|--------|------|
| 🟢 **Strong** | Architecture structure, naming conventions, type system, event schema design |
| 🟡 **Partial** | Core services (stubs, not connected), plugin system, saga orchestrator |
| 🔴 **Missing** | Tests (0%), OpenAPI spec, real DB/Redis/RabbitMQ connections, CI/CD pipeline, monitoring |

---

## Phase-by-Phase Checklist Assessment

### Phase 0 — Foundation

| Item | Status | Notes |
|------|--------|-------|
| Separate layers: core / modules / plugins | ✅ DONE | `src/core/`, `src/modules/`, `src/plugins/`, `src/shared/` |
| Prevent cross-module imports | ✅ DONE | ESLint rule in [eslint-rules.js](file:///Users/ryanho/Dev/business-project/mini-erp/backend/scripts/eslint-rules.js) + runtime [validator.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/architecture-validator/validator.ts) |
| Prevent plugin access to module internals | ✅ DONE | ESLint `no-repository-in-plugin` + `no-outbox-direct-access` rules |
| ESLint architecture rules | 🟡 PARTIAL | Rules defined but **not wired** — no `.eslintrc` / `eslint.config.js` found to load [scripts/eslint-rules.js](file:///Users/ryanho/Dev/business-project/mini-erp/backend/scripts/eslint-rules.js) |
| Runtime DI graph validation | 🟡 PARTIAL | [validator.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/architecture-validator/validator.ts) exists but startup call in [main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts) uses dummy [() => []](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/consumer.ts#25-31) |
| Plugin permission validation | ✅ DONE | [plugin-loader.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/plugin-system/plugin-loader.ts) validates permissions, trusted flag |
| Zod config schema | ✅ DONE | [config.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/config/config.ts) with fail-fast `process.exit(1)` |
| `config/` plugins.json | 🔴 MISSING | `backend/config/` directory is empty |

### Phase 1 — Database & Migration

| Item | Status | Notes |
|------|--------|-------|
| Setup Drizzle ORM | 🟡 PARTIAL | `drizzle.config.ts` exists, schemas defined, but DB connection is `{} as any` |
| Schema as source of truth | ✅ DONE | All schemas use `pgTable()` with explicit column mapping |
| camelCase (TS) / snake_case (DB) | ✅ DONE | Consistent across all schema files |
| Setup drizzle-kit | ✅ DONE | `package.json` scripts: `migrate`, `migrate:generate`, `migrate:rollback` |
| Migration pipeline | 🟡 PARTIAL | `database/migrations/` dir exists but is empty |
| Migration linter (CI) | ✅ DONE | [lint-migrations.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/scripts/lint-migrations.ts) with 3 rules matching ADR-009 |

### Phase 2 — Event System

| Item | Status | Notes |
|------|--------|-------|
| EventBus emit(event, tx) | ✅ DONE | [event-bus.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/event-bus/event-bus.ts) throws without tx (ADR-005) |
| Outbox write in same tx | ✅ DONE | `outboxRepo.insert(event, tx)` in EventBus.emit() |
| Outbox table | ✅ DONE | [outbox.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.schema.ts) + DLQ table |
| Worker to poll and publish | 🟡 STUB | [outbox-worker.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox-worker.ts) coded but not runnable (no real AMQP) |
| FOR UPDATE SKIP LOCKED | ✅ DONE | In [outbox.repository.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.repository.ts#L37) |
| Event Schema Registry | ✅ DONE | [registry.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/event-schema-registry/registry.ts) — validate on produce |
| Consumer-side validation | ✅ DONE | [consumer.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/consumer.ts) validates via registry on consume |
| Dedup via processed_events | ✅ DONE | [processed-event.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/processed-event.schema.ts) with double-check |
| Per-aggregate FIFO queue | ✅ DONE | `SimpleQueue` per aggregate_id in consumer.ts |
| Event rate limiting | ✅ DONE | [rate-limiter.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/rate-limiter.ts) with TokenBucket |

### Phase 3 — Idempotency

| Item | Status | Notes |
|------|--------|-------|
| Redis idempotency store | ✅ DONE | [api-idempotency.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/idempotency/api-idempotency.ts) |
| TTL = 24h | ✅ DONE | `IDEMPOTENCY_TTL_SECONDS: 86_400` in constants |
| processed_events table | ✅ DONE | Defined in processed-event.schema.ts |
| BullMQ jobId dedup | 🔴 MISSING | No BullMQ integration |

### Phase 4 — Saga

| Item | Status | Notes |
|------|--------|-------|
| Centralized saga orchestrator | 🟡 STUB | [saga-orchestrator.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts) — logic coded but persistence methods are empty |
| saga_state table | ✅ DONE | [saga.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga.schema.ts) with ttlAt field |
| Resume RUNNING/COMPENSATING sagas | 🔴 MISSING | No recovery startup logic |
| Daily cleanup job | 🔴 MISSING | Retention constants defined but no cron job |

### Phase 5 — Plugin System

| Item | Status | Notes |
|------|--------|-------|
| Plugin lifecycle (activate, deactivate, dispose) | ✅ DONE | [plugin-loader.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/plugin-system/plugin-loader.ts) |
| Permission manifest + validation | ✅ DONE | `PluginGuard` + `validatePermissions()` |
| Enforce trusted-only (Phase 1) | ✅ DONE | Blocks `trusted: false` plugins |
| Plugin table naming convention | 🟡 PARTIAL | `PLUGIN_TABLE_PREFIX` constant exists but no enforcement code |

### Phase 6 — External Integration

| Item | Status | Notes |
|------|--------|-------|
| All external calls via proxy | ✅ DONE | [proxy.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/external-integration/proxy.ts) |
| Circuit breaker CLOSED/OPEN/HALF_OPEN | ✅ DONE | [circuit-breaker.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/external-integration/circuit-breaker.ts) |
| Fallback per service | ✅ DONE | `execute(fn, fallback?)` in CircuitBreaker |

### Phase 7 — API

| Item | Status | Notes |
|------|--------|-------|
| Global validation pipe | 🟡 PARTIAL | Zod parsing in controller, but no global pipe middleware |
| Response format {data, meta} / {error} | ✅ DONE | [response.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts) with request_id |
| Redis-based rate limiting | 🔴 MISSING | Constants defined but no middleware implementation |
| Helmet | ✅ DONE | `app.use(helmet())` in main.ts |
| JWT RS256 | 🔴 MISSING | Config schema exists but no auth middleware |
| Token rotation + revocation | 🔴 MISSING | No implementation |

### Phase 8 — Cache & Read Model

| Item | Status | Notes |
|------|--------|-------|
| Redis cache-aside | ✅ DONE | [cache.service.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/cache/cache.service.ts) |
| TTL per entity | ✅ DONE | `cacheDefaults` config per entity type |
| Fail-safe cache (fallback to DB) | ✅ DONE | `getWithFallback()` method |
| Event-driven invalidation | 🔴 MISSING | `invalidate()` exists but no event handler wiring |

### Phase 9–10 — Deployment, Monitoring, Production Hardening

| Item | Status | Notes |
|------|--------|-------|
| All items | 🔴 MISSING | No Docker, CI/CD, monitoring, or production hardening |

---

## Critical Findings

### 🔴 P0 — Must Fix

| # | Finding | Standard Reference |
|---|---------|-------------------|
| 1 | **Zero tests** — `tests/` is empty, 0% coverage vs 80% target | §7 Testing, TDD Rules |
| 2 | **OpenAPI spec missing** — `specs/` directory is empty, violates spec-first workflow | §5 API Standards |
| 3 | **ESLint rules not wired** — `scripts/eslint-rules.js` exists but no `.eslintrc` / `eslint.config.js` loads it | ADR-006 |
| 4 | **DB/Redis/RabbitMQ connections mocked** — `{} as any` in main.ts | Phase 1 |
| 5 | **No auth system** — JWT RS256, RBAC decorators, token rotation absent | §10 Security |

### 🟡 P1 — Should Fix

| # | Finding | Standard Reference |
|---|---------|-------------------|
| 6 | **DI validation uses dummy resolver** — `main.ts:87` passes `() => []` | ADR-006 |
| 7 | **Saga persistence methods empty** — All `updateStatus()`, `getState()` etc. are no-ops | Phase 4 |
| 8 | **No API rate limiting middleware** — Constants defined but no Redis-backed middleware | §10 Security |
| 9 | **No BullMQ/job queue** — Background job idempotency (Phase 3) absent | §11 Idempotency |
| 10 | **`snakeCaseMiddleware` only converts request** — response snake_case conversion not implemented as interceptor | §6 Naming Convention |
| 11 | **`product.deleted.v1` event schema not registered** — Only `created` and `updated` registered in module | §6 Event-Driven |
| 12 | **`plugins.json` missing** — `config/` directory is empty | AGENTS.md §7.5 |
| 13 | **No `onInstall`/`onUninstall` lifecycle** — `IPlugin` declares them optional but analytics plugin omits them | Architecture §12 |

### 🟢 P2 — Nice to Have

| # | Finding | Standard Reference |
|---|---------|-------------------|
| 14 | **shared/utils/ is empty** — Placeholder directory | §4 Shared Packages |
| 15 | **No Prettier config file** — `.prettierrc` not found | §8 Linting |
| 16 | **No `ErrorCode` re-export from `@shared/constants`** — `circuit-breaker.ts` imports from both `@shared/constants` and `@shared/errors/app-error` | §11 Coding Standards |
| 17 | **Cache stampede protection** — `getOrSet` uses in-memory mutex, not distributed lock | Phase 10 |

---

## Compliance Summary by Standard

### vs PROJECT-STANDARD.md

| Section | Compliance |
|---------|-----------|
| §1 Architecture | ✅ Layer structure correct, communication rules followed |
| §2 Backend Standards | ✅ Module structure follows template exactly |
| §3 Frontend | N/A (not built yet) |
| §4 Shared Packages | 🟡 Types/errors present, utils empty |
| §5 API Standards | 🔴 No OpenAPI spec file |
| §6 Event-Driven | ✅ EventEnvelope, outbox, schema validation all match |
| §7 Testing | 🔴 Zero tests |
| §8 Linting | 🟡 Rules written but not wired into ESLint config |
| §9 Git & CI/CD | 🟡 Scripts defined in package.json but no CI pipeline |
| §10 Security | 🔴 No auth/RBAC/rate-limiting |
| §11 Coding Standards | ✅ Naming, error handling, DI patterns followed |

### vs Architecture v2.2

| ADR | Compliance |
|-----|-----------|
| ADR-001 Outbox (no Event Sourcing) | ✅ Correct — outbox only, no event store |
| ADR-002 aggregate_id required | ✅ Top-level in EventEnvelope |
| ADR-003 Log retention | 🟡 Saga retention constants defined, no implementation |
| ADR-004 Config validation | ✅ Zod + fail-fast |
| ADR-005 emit(event, tx) | ✅ Throws without tx |
| ADR-006 Architecture enforcement | 🟡 ESLint rules exist but not wired; runtime validator partially connected |
| ADR-007 Drizzle ORM | ✅ Schema conventions correct |
| ADR-008 Event Schema Registry | ✅ Producer + consumer validation |
| ADR-009 Migration linter | ✅ Linter script with 3 required rules |

### vs Implementation Checklist

**Overall: 25/56 items DONE, 12 PARTIAL/STUB, 19 MISSING**

| Phase | Done | Partial | Missing |
|-------|------|---------|---------|
| Phase 0 — Foundation | 5 | 2 | 1 |
| Phase 1 — Database | 4 | 2 | 0 |
| Phase 2 — Event System | 9 | 1 | 0 |
| Phase 3 — Idempotency | 3 | 0 | 1 |
| Phase 4 — Saga | 1 | 1 | 2 |
| Phase 5 — Plugin | 3 | 1 | 0 |
| Phase 6 — External | 3 | 0 | 0 |
| Phase 7 — API | 2 | 1 | 3 |
| Phase 8 — Cache | 3 | 0 | 1 |
| Phase 9–10 — Ops | 0 | 0 | 11 |

---

## Recommended Next Steps (Priority Order)

1. **Wire real DB connection** — Replace `{} as any` with actual Drizzle + pg Pool
2. **Create OpenAPI spec** — `specs/openapi.yaml` for the product module endpoints
3. **Wire ESLint rules** — Create `eslint.config.js` that loads `scripts/eslint-rules.js`
4. **Write tests** — Start with product.service (TDD: RED → GREEN → REFACTOR)
5. **Implement auth** — JWT RS256 + RBAC middleware
6. **Fix response snake_case** — Add response interceptor to convert camelCase → snake_case
7. **Register `product.deleted.v1` event schema** in ProductModule
8. **Create `config/plugins.json`** with analytics plugin configuration
9. **Implement saga persistence** — Connect saga-orchestrator to real DB
10. **Implement API rate limiting** — Redis-backed sliding window middleware
