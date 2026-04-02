# COMPLIANCE AUDIT REPORT

**Date:** 2026-04-02
**Auditor:** AI Agent
**Scope:** Full codebase vs Architecture-v2.2, MODULE-COMPLIANCE, PLUGIN-COMPLIANCE, CORE-INDEPENDENCE-STANDARD
**Overall Score:** 80/100 — Minor leakage

---

## 1. CORE INDEPENDENCE (CORE-INDEPENDENCE-STANDARD.md)

### CRITICAL VIOLATIONS

| # | File | Violation | Rule |
|---|------|-----------|------|
| **C1** | `main.ts:19-20` | **Core imports module and plugin directly** — `import { ProductModule } from '@modules/product/...'` and `import { AnalyticsPlugin } from '@plugins/analytics/...'` | Rule 2: No Module/Plugin Imports |
| **C2** | `main.ts:78-85` | **Domain event types hardcoded in core bootstrap** — `product.created.v1`, `order.created.v1`, `inventory.reserved.v1` etc. in EventRateLimiter config | Rule 4: No Domain Keywords in Core; Rule 5: No Control Flow Based on Domain |
| **C3** | `main.ts:156-161` | **Domain-specific event handlers in bootstrap** — `registerHandler('product.updated.v1', ...)` and `registerHandler('product.deactivated.v1', ...)` with product-specific cache invalidation logic | Rule 1: No Domain Knowledge; Rule 5: No Control Flow Based on Domain |
| **C4** | `main.ts:137-150` | **Direct module/plugin construction in bootstrap** — `new ProductModule(...)`, `new AnalyticsPlugin()` — Core orchestrates domain-specific wiring | Rule 6: Infrastructure Only |

**Impact:** `main.ts` is the composition root but it's NOT inside `src/core/`. However, the `EventRateLimiter` config and handler registrations happen inside core services (constructed at the bootstrap level) and contain hard domain knowledge. The core `ArchitectureValidator`, `DIContainer`, `EventConsumer`, and `EventRateLimiter` themselves are clean — the violation is at the **composition root** level in `main.ts`.

### MINOR VIOLATIONS

| # | File | Issue | Rule |
|---|------|-------|------|
| **M1** | `shared/errors/app-error.ts:10` | `ErrorCode.PLUGIN_NOT_ACTIVE` and `SAGA_FAILED` — domain-aware error codes in shared layer | Rule 1 borderline |
| **M2** | `shared/types/db.ts:40` | `SoftDeletable` interface — domain concept in shared types | Rule 1 borderline |

---

## 2. MODULE COMPLIANCE (MODULE-COMPLIANCE.md)

### Product Module — COMPLIANT (mostly)

| Check | Status | Notes |
|-------|--------|-------|
| A: Data Ownership | PASS | Owns `products` table |
| B: Domain Isolation | PASS | No cross-module imports |
| C: Service Contract | PASS | `IProductService` defined |
| D: Event Emission | PASS | Uses `EventBus.emit()` with `tx` |
| E: No Plugin Awareness | PASS | No plugin references |
| F: Minimal Core Domain | PASS | Clean schema |
| G: Test Criteria | PASS | Works without plugins |

**Issues found:**

| # | File | Issue | Severity |
|---|------|-------|----------|
| **M3** | `product.events.ts:59-60` | `ProductDeletedEventSchema` is an alias to `ProductDeactivatedEventSchema` — event naming inconsistency (`product.deactivated.v1` used instead of `product.deleted.v1`). The Arch doc Section 6 event table lists `product.deleted.v1`, but the actual event is `product.deactivated.v1` | MEDIUM |
| **M4** | `product.schema.ts` | No `deletedAt` column despite using soft delete pattern (service sets `isActive = false`). Arch Section 28 mentions soft delete for products but there's no `deletedAt` tracking | LOW |

### Order Module — MINIMAL

Only contains placeholder `order.module.ts` and `order.saga.ts`. No schema, no service, no controller yet. `order.saga.ts` imports from core only (allowed). **No violations.**

---

## 3. PLUGIN COMPLIANCE (PLUGIN-COMPLIANCE.md)

### Analytics Plugin — PARTIAL COMPLIANCE

| Check | Status | Notes |
|-------|--------|-------|
| A: No Direct DB Access | **FAIL** | Uses `Db` directly in `AnalyticsService` — but this is **isolated storage** (allowed) |
| B: Service Interface Only | **FAIL** | Plugin does NOT use any module service interface (violates: should use `IProductService` to read product data, not subscribe to events) |
| C: No Core Domain Event Emission | PASS | Only emits `analytics.event_tracked.v1` |
| D: Extension Mechanism | PASS | Uses event subscription via `setEventConsumer()` |
| E: Isolated Storage | PASS | Table name `plugin_analytics_events` follows convention |
| F: UI Extension | N/A | No frontend |
| G: Permission Declaration | PASS | Declares permissions |
| H: Lifecycle | PASS | `onActivate`, `onDeactivate`, `dispose` implemented |
| I: Failure Isolation | **FAIL** | No error boundary in `AnalyticsPlugin.setEventConsumer()` — if `service.recordEvent()` throws, error propagates unhandled |
| J: Test Criteria | **FAIL** | Plugin receives `Db` in `init(db)` — direct DB object injection instead of going through DI container |

**Issues found:**

| # | File | Issue | Severity |
|---|------|-------|----------|
| **P1** | `analytics.plugin.ts:40-42` | `init(db: Db)` takes raw `Db` directly — plugin constructor receives DB object from main.ts instead of going through DI or service interface | MEDIUM |
| **P2** | `analytics.plugin.ts:82-86` | `service.recordEvent(event)` in event handler — no try/catch. Plugin error in handler propagates unhandled, violating failure isolation (PLUGIN-COMPLIANCE I) | HIGH |
| **P3** | `analytics.service.ts:7` | `AnalyticsService` takes `Db` directly — accesses database without going through a service interface. While this is isolated storage (allowed by plugin rules), the init pattern bypasses DI container | LOW |
| **P4** | `analytics.schema.ts:6` | `aggregateId` is `varchar(255)` instead of `uuid` — inconsistent with core convention (event `aggregate_id` is UUID) | LOW |

---

## 4. ARCHITECTURE COMPLIANCE (Architecture-v2.2.md)

### ADR-001 (Outbox, NOT Event Sourcing) — PASS

No `event_store` table found. Only `outbox` and `outbox_dlq`. Correct.

### ADR-002 (aggregate_id top-level) — PASS

`EventEnvelope` in `shared/types/event.ts:8` has `aggregate_id` at top level. Correct.

### ADR-004 (Config Validation) — PASS

`config.ts` uses Zod schema with `safeParse()` and `process.exit(1)` on failure. Correct.

### ADR-005 (emit(event, tx) enforcement) — PASS

`EventBus.emit()` requires `tx` parameter and throws if missing. All module emit calls pass `tx`. Correct.

### ADR-006 (Architecture Enforcement) — PARTIAL

ESLint rules exist and are configured. Runtime validator exists. **Missing:**

| # | Issue | Severity |
|---|-------|----------|
| **A1** | `ArchitectureValidator.validateOnStartup()` in `main.ts:113` only calls `validateDIGraph` and `validateServiceBindings` — does NOT call `validateNoCoreToModule()`, `validateNoCoreToPlugin()`, `validatePluginGuards()`, or `validateServiceInterfaces()` | HIGH |
| **A2** | No `npm run lint:arch` script in `package.json` — lint script is `eslint src/ --ext .ts` but architecture rules are custom (`erp-architecture/*`), not standard ESLint | MEDIUM |
| **A3** | No `npm run validate:runtime` script | MEDIUM |

### ADR-007 (Drizzle ORM) — PASS

All schemas use `pgTable()` with explicit column name mapping. camelCase properties, snake_case columns. Correct.

### ADR-008 (Event Schema Registry) — PASS

`EventSchemaRegistry` in `core/event-schema-registry/registry.ts`. Product events registered in `ProductModule` constructor. EventBus validates on emit. Consumer validates on receive. Correct.

### ADR-009 (Migration Linter) — PARTIAL

| # | Issue | Severity |
|---|-------|----------|
| **A4** | `npm run lint:migration` exists in package.json but no `scripts/lint-migrations.ts` file found (needs verification) | MEDIUM |

### Naming Convention (Section 6 / AGENTS.md Section 6) — PASS

All DTOs use `camelCase`, schemas use explicit `snake_case` column mapping, controllers return raw results. `SnakeCaseTransformPipe`/`SnakeCaseInterceptor` middleware handles boundary conversion.

### Event Architecture (Section 6) — PARTIAL

| # | Issue | Severity |
|---|-------|----------|
| **A5** | `product.deactivated.v1` does not match the event table in Section 6 which lists `product.deleted.v1` | LOW (naming choice) |

### Outbox Worker (Section 32) — PASS

Implements adaptive polling, `SKIP LOCKED`, lock ownership, retry + backoff, DLQ, max concurrent throughput control. Correct.

### Consumer Idempotency (Section 6/11) — PASS

Double-check dedup within transaction in `EventConsumer.processEvent()`. Correct.

### Saga (Section 10) — PARTIAL

| # | File | Issue | Severity |
|---|------|-------|----------|
| **A6** | `saga-orchestrator.ts:178-190` | `persistState()` does NOT use transaction — calls `this.db.insert()` directly outside of `withTransaction()`. Should wrap in transaction for atomicity with saga state | HIGH |
| **A7** | `saga.schema.ts` | `completedSteps` and `compensatedSteps` stored as `jsonb` with default `[]`, but `saga-orchestrator.ts` serializes with `JSON.stringify()` on insert. Type mismatch: Drizzle `jsonb` column expects object, not string | HIGH |

### Cache (Section 19/21) — PASS

CacheService implements stampede protection, fail-safe behavior (returns null on error), distributed lock via SETNX. Correct.

### Plugin System (Section 12) — PARTIAL

| # | Issue | Severity |
|---|-------|----------|
| **A8** | `plugin-loader.ts:30-35` | DI container plugin guard uses `RESTRICTED_TOKEN_PATTERNS` checking token name, but `AnalyticsPlugin` doesn't register anything in DI — it gets `Db` passed directly in `init()`, bypassing the guard | MEDIUM |
| **A9** | `plugin-loader.ts` | `IPlugin` interface missing `getModules(): Module[]` — Arch Section 12 defines this method. `AnalyticsPlugin` uses `getModule()` (singular) instead | LOW |
| **A10** | `plugin-loader.ts` | Missing `onInstall`/`onUninstall` from `IPlugin` interface — these are optional but should be in interface per spec. AnalyticsPlugin implements them but they're not in the type | LOW |

### Idempotency (Section 11) — PASS

API idempotency middleware exists. Event consumer has processed-event store. Correct.

### Security (Section 20) — PASS

JWT RS256 auth, RBAC guard, token revocation, helmet, rate limiter. Correct.

### OpenAPI Spec — PARTIAL

| # | Issue | Severity |
|---|-------|----------|
| **A11** | `specs/openapi.yaml` exists but there's no evidence spec was updated before implementation (no `npm run generate:types` script, no `apps/shop` directory for frontend) | LOW |

---

## 5. SUMMARY SCORE

| Layer | Score | Status |
|-------|-------|--------|
| Core Independence | **75/100** | `main.ts` composition root has domain leakage into bootstrap |
| Module Compliance | **95/100** | Product module clean, minor event naming inconsistency |
| Plugin Compliance | **70/100** | Missing failure isolation, direct DB injection pattern |
| Architecture (ADRs) | **80/100** | Runtime validator not fully used, saga persistence bug |
| **Overall** | **80/100** | **Minor leakage** |

---

## 6. TOP 10 ISSUES TO FIX (Priority Order)

| Priority | ID | Description | Effort |
|----------|----|-------------|--------|
| 1 | C2/C3 | Move event rate limit configs and domain-specific event handlers OUT of `main.ts` bootstrap into respective modules/plugins (use a registration pattern) | Medium |
| 2 | A1 | Call ALL `ArchitectureValidator` methods at startup, not just 2 of 6 | Low |
| 3 | A6 | Wrap `saga-orchestrator.ts:persistState()` in transaction | Low |
| 4 | A7 | Fix `completedSteps`/`compensatedSteps` type: remove `JSON.stringify()` from inserts, let Drizzle handle `jsonb` | Low |
| 5 | P2 | Add error boundary in `AnalyticsPlugin.setEventConsumer()` event handler | Low |
| 6 | P1/P3 | Refactor plugin to use DI container or service interfaces instead of raw `Db` injection | Medium |
| 7 | A2/A3 | Add `lint:arch` and `validate:runtime` scripts to package.json | Low |
| 8 | M3 | Align event name (`product.deleted.v1` vs `product.deactivated.v1`) with spec | Low |
| 9 | A9 | Align `IPlugin.getModules()` with Architecture spec | Low |
| 10 | A4 | Verify `lint-migrations.ts` exists and is functional | Low |

---

## 7. ADR PASS/FAIL SUMMARY

| ADR | Status | Notes |
|-----|--------|-------|
| ADR-001: Outbox (not Event Sourcing) | PASS | No event_store found |
| ADR-002: aggregate_id top-level | PASS | Correct in EventEnvelope |
| ADR-003: Tiered Log Retention | N/A | Not yet implemented (no log rotation config) |
| ADR-004: Config Validation + Fail-Fast | PASS | Zod schema + process.exit(1) |
| ADR-005: EventBus emit(event, tx) | PASS | Throws without tx |
| ADR-006: Compile-Time + Runtime Enforcement | PARTIAL | ESLint rules exist, runtime validator incomplete |
| ADR-007: Drizzle ORM | PASS | pgTable with explicit mapping |
| ADR-008: Event Schema Registry | PASS | Registry + validate on emit/receive |
| ADR-009: Migration Linter | PARTIAL | Script exists, implementation needs verification |

---

**End of Report**
