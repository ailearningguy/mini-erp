# 🔍 Architecture Compliance Review — mini-erp Backend

**Date:** 2026-04-01  
**Reference Docs:** [Architecture-v2.2.md](file:///Users/ryanho/Dev/business-project/mini-erp/docs/Architecture-v2.2.md) · [PROJECT-STANDARD.md](file:///Users/ryanho/Dev/business-project/mini-erp/PROJECT-STANDARD.md)  
**Scope:** All 38 source files, 12 test files, OpenAPI spec, ESLint rules, configs

---

## Executive Summary

The codebase demonstrates **strong foundational compliance** with Architecture v2.2. Core patterns (Outbox, EventBus tx enforcement, Drizzle schema conventions, DI container, plugin system) are correctly implemented. However, there are **17 critical/high-severity issues** and **12 medium-severity issues** that could **break the architecture** as the system scales.

---

## 🔴 CRITICAL Issues (Will Break Architecture)

### C1. Optimistic Locking Race Condition — TOCTOU Bug

**File:** [product.service.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.service.ts#L102-L158)

The [update()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.controller.ts#55-65) method reads the version **outside** the transaction, then checks it inside. Between [getById()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.controller.ts#11-23) and `db.transaction()`, another request can update the same product.

```diff
  async update(id: string, dto: UpdateProductDto): Promise<Product> {
-   const existing = await this.getById(id);   // ← READ outside transaction
-   if (!existing) { ... }
-   if (existing.version !== dto.version) { ... }
-
-   const result = await (this.db as any).transaction(async (tx_) => {
+   const result = await (this.db as any).transaction(async (tx_) => {
+     const existing = await tx_.select()...;  // ← READ inside transaction
+     if (!existing) { throw ... }
+     if (existing.version !== dto.version) { throw ... }
      // update with version + 1
```

> [!CAUTION]
> This is a classic Time-Of-Check-Time-Of-Use (TOCTOU) vulnerability. Under concurrent requests, data loss WILL occur because the version check is not atomic with the update.

Architecture ref: **Section 9 — Concurrency Control** requires optimistic locking with version field. The version check MUST be inside the same transaction as the write.

---

### C2. OutboxRepository.insert() — `tx` is Optional, Violating ADR-005

**File:** [outbox.repository.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.repository.ts#L11)

```typescript
async insert(event: EventEnvelope, tx?: AnyDb): Promise<void> {
  const db = (tx ?? this.db) as any;  // ← Falls back to non-transactional db!
```

ADR-005 states: _"EventBus.emit() MUST throw if tx is missing"_. While `EventBus.emit()` checks for `tx`, the underlying `OutboxRepository.insert()` silently accepts `undefined` and falls back to `this.db`. This means:

- A bug in EventBus or direct call to `outboxRepo.insert()` bypasses the transaction guarantee
- The outbox write could be in a **separate transaction** from domain data

**Fix:** Make `tx` required in `OutboxRepository.insert()`.

---

### C3. `src/database/` Directory Is Empty — No Migrations Exist

**Architecture ref:** Section 5 requires migrations in `database/migrations/`.

The `database/` directory is **completely empty**. There are no Drizzle migrations despite having 4 schema files (`products`, `outbox`, `outbox_dlq`, `saga_state`, `processed_events`). This means:

- The database cannot be set up reproducibly
- Zero-downtime migration workflow (ADR-009) is untested
- `npm run lint:migration` passes vacuously (no files to lint)

---

### C4. Saga Orchestrator State Updates Are Not Atomic

**File:** [saga-orchestrator.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts)

Each saga operation ([updateStatus](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts#190-196), [updateCurrentStep](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts#197-203), [updateCompletedSteps](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts#204-210)) is a **separate database call with no transaction wrapping**. If the process crashes between [updateStatus(RUNNING)](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts#190-196) and [updateCurrentStep(i)](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts#197-203), the saga state becomes inconsistent.

Per **Section 10 — Saga Orchestration**, the saga state machine should be DB-backed with crash recovery. Without atomic state transitions, recovery is unreliable.

---

### C5. EventConsumer SimpleQueue Has No Error Handling — Will Crash Process

**File:** [consumer.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/consumer.ts#L68-L87)

```typescript
class SimpleQueue {
  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();  // ← Unhandled rejection crashes process
    }
    this.running = false;
  }
}
```

If `fn()` throws an unhandled error, the entire queue halts and `this.running` stays `true` forever, meaning no new tasks will be processed for that aggregate. Per **Section 6**, consumer failures should be handled with retry + DLQ, not crash.

---

## 🟠 HIGH Issues (Architecture Erosion Risk)

### H1. Auth Middleware Calls [loadConfig()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/config/config.ts#29-65) On Every Request

**File:** [auth.middleware.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/auth/auth.middleware.ts#L29)

```typescript
export function authMiddleware(req, _res, next): void {
  const config = loadConfig();  // ← Parses env + validates Zod on EVERY request!
```

[loadConfig()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/config/config.ts#29-65) reads `process.env`, builds the config object, and runs Zod validation **on every single request**. This is a performance issue and violates the fail-fast startup pattern (ADR-004). Config should be validated once at startup and injected.

---

### H2. API Idempotency Middleware NOT Integrated

**Files:** [api-idempotency.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/idempotency/api-idempotency.ts) · [main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts)

[ApiIdempotencyStore](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/idempotency/api-idempotency.ts#9-35) is implemented but **never registered in the DI container or applied as middleware**. Per **Section 11 — Idempotency**, API POST/PUT endpoints MUST use the `Idempotency-Key` header for deduplication.

---

### H3. API Rate Limiter NOT Integrated

**Files:** [rate-limiter.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/rate-limiter.ts) · [main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts)

[createRateLimiter()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/rate-limiter.ts#33-58) is implemented but **never used in middleware chain**. Per **§10 Security** in PROJECT-STANDARD, rate limiting is required (100 req/min per user, 60 req/min per IP, 5 req/min for auth).

Also, the rate limiter uses in-memory `Map` instead of **Redis-backed sliding window** as specified in **§10**.

---

### H4. AnalyticsPlugin Does NOT Subscribe to EventBus

**File:** [analytics.plugin.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/plugins/analytics/analytics.plugin.ts)

The plugin creates an [eventHandler](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/plugins/analytics/analytics.plugin.ts#45-53) function but **never actually subscribes it to the EventConsumer**. Event tracking is entirely non-functional. The `events` array stays empty forever.

Per **Section 4 — Data Ownership**, plugins should _"Subscribe to domain events"_ via the EventBus/Consumer mechanism.

---

### H5. Saga Retention/Cleanup Not Implemented

**Architecture ref:** Section 10 — Saga Retention Strategy (v2.2)

The [saga.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga.schema.ts) has the `ttlAt` field, but:
- No `SagaCleanupJob` class exists
- No cron job scheduled for daily cleanup
- `ttlAt` is never set when creating/completing sagas

The saga table will grow unboundedly in production.

---

### H6. OutboxWorker Not Started From [main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts)

**File:** [main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts)

The [OutboxWorker](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox-worker.ts#20-136) is not instantiated or started anywhere in the application bootstrap. The outbox worker has a separate script in [package.json](file:///Users/ryanho/Dev/business-project/mini-erp/backend/package.json) (`outbox-worker`), but this script points to the module file itself which **has no entry point code** — it only exports the class.

This means events written to the outbox table are **never published to RabbitMQ**.

---

### H7. [convertKeys()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#116-135) Response Middleware Recursively Converts ALL Nested Objects

**File:** [response.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#L116-L134)

The [convertKeys()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#116-135) function recursively converts **every nested object key**, including JSONB payload data. This means if a domain entity has a `metadata` JSONB field containing `{"custom_key": "value"}`, the response middleware will incorrectly convert it to `{"customKey": "value"}` on the way out, and the request middleware will convert `customKey` back to `customkey` (note: not `custom_key` — the [camelCase()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#108-111) function only handles `snake_case → camelCase`, not the reverse of already-snake-case keys).

> [!WARNING]
> This will corrupt arbitrary JSONB data. The middleware should skip known payload/metadata fields or use a whitelist approach.

---

### H8. Product [delete](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.controller.ts#66-75) Does Soft Delete But Response Says 204

**File:** [product.service.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.service.ts#L161-L189) · [product.events.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/events/product.events.ts#L41-L55)

The [delete](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.controller.ts#66-75) method soft-deletes (sets `isActive: false`) but emits `product.deleted.v1`. Consumers of this event will assume the product is permanently deleted, but the product still exists in the database and can still be queried. The event name is misleading and will cause data inconsistency across modules.

---

## 🟡 MEDIUM Issues (Standards Violations)

### M1. Missing `@plugins/*` Path Alias Guard in ESLint

The ESLint rules enforce `no-cross-module-import` for `@modules/*` but **do not guard against module code importing plugin internals**. Per §1 of PROJECT-STANDARD: _"modules cannot import from plugins"_.

---

### M2. DTO Properties Use [camelCase](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#108-111) But controller Parses Request Body Before [snakeCaseMiddleware](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#42-48)

The [snakeCaseMiddleware](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#42-48) converts request body keys from `snake_case → camelCase` before they reach the controller. The DTO schemas (`CreateProductDtoSchema`) expect [camelCase](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#108-111) properties (`productName`, `basePrice`). This is **correct** per AGENTS.md §6. ✅

However, the middleware runs **globally** including for JSON patch or nested objects — it will corrupt nested keys that should remain as-is.

---

### M3. No `Idempotency-Key` Security Headers in OpenAPI Spec

**File:** [openapi.yaml](file:///Users/ryanho/Dev/business-project/mini-erp/backend/specs/openapi.yaml)

The OpenAPI spec does not document the `Idempotency-Key` header for POST/PUT endpoints, even though the architecture requires it (§11). This means auto-generated frontend types will be incomplete.

---

### M4. No Security Scheme Defined in OpenAPI Spec

The spec has no `securitySchemes` or `security` block. API docs don't document JWT Bearer auth. Per §5 in PROJECT-STANDARD this is required.

---

### M5. Missing `@shared/*` Barrel Export Pattern

[shared/types/index.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/shared/types/index.ts) and [shared/errors/index.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/shared/errors/index.ts) have barrel exports, but [shared/utils/index.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/shared/utils/index.ts) exports individual functions without re-exporting from constants. The pattern is inconsistent.

Also: [shared/constants/index.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/shared/constants/index.ts) re-exports `ErrorCode` from `@shared/errors/app-error` — a utility barrel file should not cross-reference other barrels; this creates a circular-ish import path.

---

### M6. Plugin Module Docs Not Created

Per **§9 Documentation Requirements**, each module/plugin needs `docs/README.md`, `API.md`, `ARCHITECTURE.md`, `CHANGELOG.md`. Neither `product` module nor `analytics` plugin has a `docs/` directory.

---

### M7. Test Coverage Gaps — Critical Subsystems Untested

| Subsystem | Test File | Status |
|-----------|-----------|--------|
| OutboxRepository | ❌ None | **No tests at all** |
| OutboxWorker | ❌ None | **No tests at all** |
| EventConsumer | ❌ None | **No tests at all** |
| EventRateLimiter | ❌ None | **No tests at all** |
| PluginLoader | ❌ None | **No tests at all** |
| PluginGuard | ❌ None | **No tests at all** |
| CircuitBreaker | ❌ None | **No tests at all** |
| ArchitectureValidator | ❌ None | **No tests at all** |
| ApiIdempotency | ❌ None | **No tests at all** |
| SagaCleanupJob | N/A | Not implemented |

12 test files exist covering 9 areas, but **9 critical subsystems have zero test coverage**. This violates §7 (_"80% minimum code coverage"_) and the TDD mandate.

---

### M8. `processedEvents` Index Is Redundant

**File:** [processed-event.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/processed-event.schema.ts#L10)

`eventId` already has `.unique()` which creates a unique index. The additional `index('processed_events_event_id_idx').on(table.eventId)` creates a redundant non-unique index. Wasted storage + write overhead.

---

### M9. [saga.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga.schema.ts) Missing `defaultNow()` for `startedAt` and `updatedAt`

**File:** [saga.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga.schema.ts#L15-L16)

```typescript
startedAt: timestamp('started_at').notNull(),  // ← No defaultNow()
updatedAt: timestamp('updated_at').notNull(),  // ← No defaultNow()
```

Unlike [outbox.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.schema.ts) and [product.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/modules/product/product.schema.ts) which use `.defaultNow()`, saga timestamps require the caller to always provide them. The [persistState()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/saga/saga-orchestrator.ts#175-189) method doesn't pass them either — this will throw a NOT NULL constraint violation on insert.

---

### M10. [outbox.schema.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.schema.ts) Missing `nextAttemptAt` Default

The `nextAttemptAt` column has no default. When `OutboxRepository.insert()` is called, `nextAttemptAt` is `NULL`. But [fetchPending()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.repository.ts#25-39) queries `lte(outbox.nextAttemptAt, new Date())` — `NULL` comparisons return `false` in SQL, meaning newly inserted outbox entries are **invisible to the worker** until they fail at least once (which sets `nextAttemptAt`).

> [!CAUTION]
> **New events will never be published by the outbox worker!** The [fetchPending()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.repository.ts#25-39) query filters on `nextAttemptAt <= NOW()` but new entries have `nextAttemptAt = NULL`, which is never `<= NOW()` in SQL.

---

### M11. DIContainer [validateGraph()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/di/container.ts#49-89) Uses Actual Factory Calls

**File:** [container.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/di/container.ts#L49-L88)

The [validateGraph()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/di/container.ts#49-89) method calls `reg.factory()` on each service to detect cycles. But this:
1. Creates real instances during validation (side effects: DB pools, Redis connections)
2. Silently catches all errors (`catch {}`) including non-cycle errors
3. Doesn't actually validate the declared `deps` array — it validates the runtime call graph

The `ArchitectureValidator.validateDIGraph()` in main.ts uses the `deps` array correctly. The `DIContainer.validateGraph()` method is **dead code** and misleading.

---

### M12. `EventRateLimiter.checkLimit()` Returns `boolean` Synchronously

**File:** [rate-limiter.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/rate-limiter.ts#L49)

Architecture spec (Section 6) shows [checkLimit()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/rate-limiter.ts#49-54) returning `Promise<boolean>` for Redis-backed rate limiting. The implementation uses in-memory [TokenBucket](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/rate-limiter.ts#7-36), which means:
- Not shared across consumer instances (each instance has independent limits)
- State lost on restart

This will be a scaling issue when multiple OutboxWorker/consumer instances run.

---

## ✅ Compliance Strengths

| Area | Status | Notes |
|------|--------|-------|
| Drizzle Schema Convention | ✅ | All pgTable definitions use explicit `camelCase → snake_case` mapping |
| EventBus tx enforcement | ✅ | ADR-005 correctly throws without `tx` |
| Event Schema Registry | ✅ | ADR-008 schemas validated before emit |
| Config Validation (Zod) | ✅ | ADR-004 fail-fast on startup |
| Outbox Pattern | ✅ | Core pattern implemented (ADR-001) |
| DI Container + Cycle Detection | ✅ | Both DIContainer and ArchitectureValidator check for cycles |
| Plugin Trusted Flag | ✅ | PluginLoader rejects `trusted: false` plugins |
| Plugin Permission Manifest | ✅ | PluginGuard validates permissions |
| OpenAPI Spec-First | ✅ | Spec exists with `snake_case` properties |
| Path Aliases | ✅ | `@core/*`, `@modules/*`, `@plugins/*`, `@shared/*` configured |
| ESLint Architecture Rules | ✅ | 5 custom rules enforce ADR-006 boundaries |
| Migration Linter | ✅ | ADR-009 rules implemented in [lint-migrations.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/scripts/lint-migrations.ts) |
| Error Handling Pattern | ✅ | [AppError](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/shared/errors/app-error.ts#14-27) with `ErrorCode` enum matches §11.7 |
| Constants Extraction | ✅ | No magic numbers, all extracted to [constants/index.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/shared/constants/index.ts) |
| Circuit Breaker | ✅ | Correct state machine with fallback support |
| Naming Convention | ✅ | All files use `kebab-case`, classes `PascalCase` |

---

## 🏗️ Hidden Architectural Risks

### Risk 1: No Module Isolation Enforcement at Runtime

The ESLint rules catch **static** cross-module imports. However, nothing prevents a module from receiving a reference to another module's service via the DI container and calling methods it shouldn't. The DI container has no permission model — any code can `container.resolve('AnyService')`.

**Impact:** As modules grow, accidental coupling via DI will be hard to detect.

### Risk 2: Schema Aggregation Is Manual

Each module's schema must be imported manually into AppModule/main.ts. There's no schema registry or auto-discovery. As modules grow, forgetting to import a schema will cause silent migration gaps.

### Risk 3: Event Consumer Aggregate Queues Grow Without Bound

`EventConsumer.aggregateQueues` creates a new [SimpleQueue](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/consumer/consumer.ts#68-88) for each unique `aggregate_id` but **never cleans them up**. Over time, the `Map` grows unboundedly, leaking memory.

### Risk 4: [snakeCase()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#112-115) Utility Handles Only `camelCase → snake_case`

The function `str.replace(/[A-Z]/g, ...)` doesn't handle edge cases:
- `HTTPRequest` → `h_t_t_p_request` (should be `http_request`)
- Already-snake-case strings get double-converted
- Numeric boundaries (`price2` → `price2`, correct but fragile)

This will cause subtle bugs as more complex property names are used.

### Risk 5: No Graceful Shutdown

[main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts) has no shutdown hook (`SIGTERM`, `SIGINT`). On restart:
- Open database connections are abandoned (pool leak)
- In-flight requests are dropped
- OutboxWorker (if started) doesn't drain its queue

Per **Section 32.5**, Green instances should be _"drained (finish in-flight requests, max 30s)"_.

---

## Priority Action Items

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 P0 | Fix TOCTOU race in `ProductService.update()` | 1h |
| 🔴 P0 | Fix [fetchPending()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/outbox/outbox.repository.ts#25-39) NULL query bug in OutboxRepository | 30min |
| 🔴 P0 | Make `OutboxRepository.insert()` tx required | 15min |
| 🟠 P1 | Add SimpleQueue error handling | 1h |
| 🟠 P1 | Add graceful shutdown to [main.ts](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/main.ts) | 2h |
| 🟠 P1 | Integrate API rate limiter + idempotency middleware | 2h |
| 🟠 P1 | Wire up AnalyticsPlugin event subscription | 1h |
| 🟠 P1 | Fix saga `startedAt`/`updatedAt` defaults | 30min |
| 🟠 P1 | Fix saga state updates to be transactional | 3h |
| 🟡 P2 | Generate initial Drizzle migrations | 1h |
| 🟡 P2 | Add tests for 9 untested subsystems | 8h |
| 🟡 P2 | Implement SagaCleanupJob | 2h |
| 🟡 P2 | Add OpenAPI security scheme | 30min |
| 🟡 P2 | Add module/plugin docs | 2h |
| 🟡 P2 | Fix [convertKeys()](file:///Users/ryanho/Dev/business-project/mini-erp/backend/src/core/api/response.ts#116-135) JSONB corruption | 2h |
| 🟡 P2 | Aggregate queue memory leak cleanup | 1h |
| 🟡 P3 | Cache auth middleware config | 15min |
