# ERP Architecture v2.1 (Canonical)

**Version:** 2.1  
**Date:** 2026-04-01  
**Status:** Canonical Source of Truth  
**Supersedes:** architecture-v2.md (deprecated), architecture-v1.md (deprecated), architecture-design.md (deprecated), architecture-design-short.md (draft)  
**Changelog:** See bottom of document

---

# 1. Core Principles

1. **Module-owned data**
2. **Plugin = extension, not core**
3. **Event-driven (Outbox), NOT Event Sourcing**
4. **Strong contracts (versioned)**
5. **Isolation by default (plugin + runtime)**
6. **Idempotent & retry-safe**
7. **Fail-fast on startup** (NEW in v2)
8. **Enforce architecture at compile-time AND runtime** (NEW in v2)

---

# 2. Architecture Decision Records (ADRs)

## ADR-001: Event System → Outbox + Audit Log (NO Event Sourcing)

### Decision

System uses:
- **Outbox Pattern** - source of truth for event delivery
- **Event Log** - audit only, NOT for replay/rebuild state

### Rationale

- ERP needs high consistency, easy debug, simple rollback
- Event Sourcing adds high complexity (rebuild, snapshot, migration)
- Audit log is sufficient for compliance without operational burden

### Consequences

- ❌ No `event_store` for replay
- ❌ No state rebuild from events
- ✅ Outbox is source of truth for delivery
- ✅ Event log for audit trail only

---

## ADR-002: Event Schema → aggregate_id is REQUIRED + Top-Level

### Decision

```typescript
interface Event {
  id: string;
  type: string;              // Format: "{module}.{action}.v{version}"
  source: string;
  timestamp: string;
  aggregate_id: string;      // REQUIRED, top-level
  payload: object;
  metadata: {
    version: string;         // Schema version: "v1", "v2"
    correlation_id?: string;
    causation_id?: string;
  };
}
```

### Rationale

- Ordering needs clear aggregate association
- Avoids ambiguity (metadata vs payload)
- Simplifies consumer implementation

### Consequences

- ❌ No `metadata.aggregate_id`
- ❌ No `payload.aggregate_id`
- ✅ Core validates presence of top-level `aggregate_id`

---

## ADR-003: Log Retention → Tiered (NOT Forever)

### Decision

| Tier | Retention | Storage |
|------|-----------|---------|
| Hot | 7-30 days | Fast storage (SSD) |
| Cold | 1-3 years | Slow storage (S3/GCS) |
| Archive | 7+ years | Glacier/cold storage |

### Rationale

- "Store forever" causes cost + performance problems
- Tiered approach balances compliance and operational efficiency

---

## ADR-004: Config Validation → Schema Validation + Fail-Fast (NEW in v2)

### Decision

All application configuration MUST be validated at startup using schema validation (zod).

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  database: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    name: z.string().min(1),
  }),
  jwt: z.object({
    publicKey: z.string().min(1),
    privateKey: z.string().min(1),
    accessTokenTtl: z.string().default('15m'),
    refreshTokenTtl: z.string().default('7d'),
  }),
  rabbitmq: z.object({
    url: z.string().url(),
  }),
  redis: z.object({
    url: z.string().min(1),
  }),
});

type AppConfig = z.infer<typeof ConfigSchema>;
```

### Rationale

- Invalid config discovered at runtime causes cryptic errors
- Fail-fast at startup catches misconfiguration before serving traffic
- Schema validation provides clear error messages for operators

### Consequences

- ❌ No optional config without explicit default or `.optional()`
- ✅ Application MUST NOT start if config validation fails
- ✅ Validation error messages MUST identify the exact field and constraint

---

## ADR-005: EventBus → emit(event, tx) Transaction Enforcement (NEW in v2)

### Decision

EventBus `emit()` MUST accept a database transaction parameter. MUST throw if `tx` is missing.

```typescript
class EventBus {
  /**
   * Emit event with outbox write in the SAME transaction.
   * @throws {Error} if tx is not provided
   */
  async emit<T>(event: Event<T>, tx: Transaction): Promise<void> {
    if (!tx) {
      throw new Error('EventBus.emit() requires a transaction parameter. '
        + 'Events MUST be written to outbox within the same DB transaction as domain data.');
    }
    await this.outboxRepository.insert(event, tx);
  }
}
```

### Rationale

- Prevents accidental out-of-transaction event emission
- Enforces ADR-001 transaction rule at API level, not just documentation
- Makes Section 7 (Transaction Rules) a compile-time/runtime guarantee

### Consequences

- ❌ No `emit(event)` without `tx` — call fails immediately
- ✅ All outbox writes are guaranteed to be in the same transaction as domain data
- ✅ Section 7 transaction rules are enforced by the EventBus interface itself

---

## ADR-006: Architecture Enforcement → Compile-Time + Runtime (NEW in v2)

### Decision

Architecture rules are enforced at two levels:

**Compile-time (ESLint):**
- No cross-module imports
- No outbox direct import from outside core module
- No repository injection into plugins
- No core domain event emission from plugins

**Runtime (DI validation):**
- Validate DI graph on startup (detect circular dependencies)
- Validate plugin permissions against manifest
- Validate service interface bindings

### Rationale

- Documentation alone is insufficient — developers (human and AI) make mistakes
- Compile-time catches violations before code runs
- Runtime catches violations that static analysis cannot detect (e.g., dynamic imports)

### Consequences

- ❌ CI fails on architecture violations (ESLint error, not warning)
- ✅ DI graph validated on every startup
- ✅ Plugin guard runs at activation time
- ✅ See **Section 37** for full rule catalog

---

## ADR-007: ORM → Drizzle ORM (NEW in v2)

### Decision

Use **Drizzle ORM** as the database ORM. Schema definitions use `pgTable()` with explicit column name mapping.

```typescript
import { pgTable, uuid, varchar, decimal, timestamp, integer } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  basePrice: decimal('base_price', { precision: 15, scale: 2 }).notNull(),
  stock: integer('stock').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Rationale

- Drizzle provides type-safe queries without runtime overhead of decorators
- Schema-as-code approach: the `pgTable()` definition IS the migration source (via drizzle-kit)
- No need for separate entity classes — schema file is source of truth
- Explicit column name mapping avoids naming strategy ambiguity
- Lightweight, tree-shakable — no hidden magic
- Native PostgreSQL feature support (enums, JSONB, arrays)
- Drizzle Kit handles migration generation from schema diffs

### Consequences

- ❌ No decorator-based entity classes (no `@Entity`, `@Column`)
- ❌ No separate entity files — schema file IS the entity
- ✅ Schema file = source of truth for queries AND migrations
- ✅ TypeScript property `camelCase`, DB column `snake_case` (explicit per-column)
- ✅ Migrations generated via `drizzle-kit generate`
- ✅ See **AGENTS.md Section 6** for naming convention rules

### Naming Convention

| Layer | Convention | Example |
|-------|-----------|---------|
| TypeScript code (services, DTOs, controllers) | `camelCase` | `cartId`, `basePrice` |
| PostgreSQL columns | `snake_case` | `cart_id`, `base_price` |
| API contract (OpenAPI, request/response) | `snake_case` | `cart_id`, `base_price` |
| Drizzle pgTable properties | `camelCase` → `snake_case` mapping | `basePrice: decimal('base_price')` |

---

# 3. System Model

## Layers

```
Core (Kernel)
  ↓
Modules (Domain)
  ↓
Plugins (Extensions)
```

## Layer Responsibilities

| Layer | Responsibility |
|-------|----------------|
| Core | DI, Plugin Loader, Event Bus, Config, Security, Architecture Enforcement |
| Module | Domain logic + DB ownership |
| Plugin | Extend behavior via API + events |

---

# 4. Data Ownership (STRICT)

## Module

**Owns:**
- Domain data (primary tables)
- Schema definition
- Business logic
- Repository layer
- Validation rules

**Can:**
- Access database directly
- Define migrations
- Expose public service interface
- Emit domain events

**Cannot:**
- Import other modules directly
- Access plugin storage

---

## Plugin

**Owns:**
- Extension logic
- Isolated storage (optional)
- Event handlers
- UI components (frontend)

**Can:**
- Subscribe to domain events
- Call service interfaces
- Have isolated storage (own tables)
- React to hooks
- Emit plugin-scoped events (e.g., `analytics.tracked`)

**Cannot:**
- Access module DB directly
- Modify module schema
- Emit core domain events (e.g., `order.created`)
- Import module internal code

---

## Storage Boundary

| Storage Type | Module | Plugin |
|--------------|--------|--------|
| Domain data | ✅ Owns | ❌ No access |
| Isolated storage | ❌ | ✅ Can create |
| Shared config | ✅ Read/Write | ✅ Read only |
| Event log | ✅ Write | ✅ Subscribe |

---

## Plugin Isolated Storage

**Naming Rule (ENFORCED):** `plugin_{pluginName}_{table}`

```
Examples:
plugin_analytics_settings
plugin_analytics_events
plugin_myextension_configs
```

This avoids conflict when multiple plugins create similar tables (e.g., `settings`).

```sql
-- ✅ CORRECT - prefixed with plugin name
CREATE TABLE plugin_analytics_settings (
  id UUID PRIMARY KEY,
  plugin_name VARCHAR(255),
  key VARCHAR(255),
  value JSONB
);

-- ❌ WRONG - missing plugin name prefix
CREATE TABLE plugin_settings (
  id UUID PRIMARY KEY,
  key VARCHAR(255),
  value JSONB
);

-- Plugin CANNOT modify module tables
-- ❌ ALTER TABLE products ADD COLUMN custom_field;
```

---

## Communication Boundary

```
Module A ←→ Service Interface ←→ Module B
     ↓
  Event Bus
     ↓
  Plugin A (subscribes to domain events, can emit plugin-scoped events)
```

---

# 5. Database Architecture

## ORM: Drizzle (ADR-007)

- Schema defined via `pgTable()` in `*.schema.ts` files
- TypeScript property `camelCase`, DB column `snake_case` (explicit per-column mapping)
- Schema file is source of truth for both queries and migrations
- Migrations generated and managed via `drizzle-kit`

### Schema Example

```typescript
import { pgTable, uuid, varchar, decimal, integer, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNumber: varchar('order_number', { length: 50 }).notNull().unique(),
  customerId: uuid('customer_id').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull(),
  metadata: jsonb('metadata'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Schema Rules

- ALL column names MUST be explicitly mapped (no naming strategy)
- TypeScript property `camelCase` → DB column `snake_case`
- Module schemas placed in `backend/src/modules/{module-name}/{module-name}.schema.ts`
- Plugin schemas placed in `backend/src/plugins/{plugin-name}/schema.ts`
- NO dynamic schema registry — explicit schema aggregation in AppModule

## Core

Manages:
- connection pool (via Drizzle `node-postgres` driver)
- transaction context (via `db.transaction()`)

## Module

Defines:
- schema (`*.schema.ts`)
- queries (using Drizzle query builder)
- repositories (optional, for complex queries)

## Plugin DB Access Rule (ENFORCED)

## Plugin DB Access Rule (ENFORCED)

```typescript
// ✅ ĐÚNG - Inject service interface
class MyPlugin {
  constructor(private productService: IProductService) {}
}

// ❌ SAI - Inject repository
class MyPlugin {
  constructor(private productRepo: ProductRepository) {} // KHÔNG ĐƯỢC PHÉP
}
```

---

## Migration Strategy

### Tool

- **drizzle-kit** generates migrations from schema diffs
- Generated SQL migrations placed in `database/migrations/`

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Run migrations
npx drizzle-kit migrate

# Rollback
npx drizzle-kit rollback
```

### Rules

- All schema changes MUST be versioned migrations
- Migrations MUST be reversible (rollback supported)
- Plugin migrations tied to lifecycle (run on install, revert on uninstall)
- Migrations placed in `database/migrations/`
- NEVER modify generated migration SQL manually (regenerate instead)

### Migration Lifecycle

```
Plugin Install  → Run UP migrations
Plugin Uninstall → Run DOWN migrations (optional, configurable)
```

### Naming Convention

```
{timestamp}_{module}_{description}.migration.ts

Example (drizzle-kit generated):
0001_sleepy_wright_product_create_products_table.sql
0002_calm_einstein_product_add_variant_column.sql
```

### Zero-Downtime Migration Strategy (NEW in v2)

| Change Type | Strategy |
|-------------|----------|
| Add column (nullable) | 1-step: ALTER TABLE ADD COLUMN |
| Add column (with default) | 2-step: ADD nullable → backfill → SET NOT NULL |
| Rename column | 3-step: ADD new → migrate data → DROP old |
| Remove column | 2-step: remove code references → DROP column |
| Change column type | 3-step: ADD new column → migrate data → DROP old |
| Create index (concurrent) | `CREATE INDEX CONCURRENTLY` (PostgreSQL) |
| Drop index | 2-step: remove code references → DROP INDEX |

**Rules:**
- NEVER add a NOT NULL column without a default in a single migration
- NEVER remove a column that active code references
- ALWAYS test rollback path
  - Lock timeout: migrations MUST set `statement_timeout` to avoid blocking reads

---

# 32.5. Deployment & Rollout Strategy (NEW in v2.1)

## Deployment Strategy: Blue/Green

The system uses **blue/green deployment** with automated rollback capability.

```
┌─────────────┐          ┌─────────────┐
│   BLUE      │          │   GREEN      │
│  (current)  │          │  (new)       │
│             │          │             │
│  v2.0       │  switch  │  v2.1       │
│             │─────────▶│             │
└─────────────┘          └─────────────┘
       ▲                         │
       │                         │
       └──────── rollback ◀──────┘
```

### Deployment Flow

```
1. Deploy new version to GREEN environment
2. Run smoke tests against GREEN
3. Run integration tests against GREEN
4. Switch load balancer to GREEN (atomic)
5. Monitor GREEN for rollback window (15 min)
6. If healthy → BLUE becomes idle (next deployment target)
7. If unhealthy → switch back to BLUE (atomic rollback)
```

### Multi-Instance Consistency

When multiple instances are running during deployment:

| Concern | Guarantee |
|---------|-----------|
| **Idempotency** | API idempotency keys prevent duplicate writes across instance switches |
| **Event processing** | RabbitMQ prefetch=1 + consumer ACK prevents duplicate processing |
| **Outbox** | `FOR UPDATE SKIP LOCKED` prevents double-publish across worker instances |
| **Saga** | State machine is DB-backed; crash recovery resumes on any instance |
| **Cache** | Redis is shared; cache invalidation via events is instance-agnostic |
| **DB schema** | Zero-downtime migration strategy (Section 5) — old and new code work with same schema |

## Migration Coordination

### Ordering

```
1. Deploy database migration (zero-downtime, backward-compatible)
2. Wait for migration to complete on all schemas
3. Verify migration success (health check)
4. Deploy new application code
5. Run smoke tests
6. Switch traffic
```

### Migration Rollback

```
1. Switch traffic back to old version (BLUE)
2. Wait for old version to be active
3. Run DOWN migration (if needed)
4. Verify rollback success
```

### Backward-Compatible Migration Rule

Every migration MUST work with both the current AND the next application version. This is enforced by the zero-downtime migration strategy in Section 5.

## Version Compatibility

### API Versioning

| Change | Action |
|--------|--------|
| Add new field to response | Deploy migration first, then new code |
| Add new required field to request | New code must handle missing field with default |
| Remove field from response | Deprecate first, remove in next version |
| New API version (`/api/v2/`) | Deploy alongside v1, switch traffic via load balancer |

### Event Version Compatibility

| Scenario | Guarantee |
|----------|-----------|
| Consumer expects v1, publisher sends v1 | Normal operation |
| Consumer expects v1, publisher sends v2 | Consumer ignores unknown fields (JSON parsing) |
| Consumer expects v2, publisher sends v1 | Consumer MUST handle missing optional fields |
| Breaking event change | New event type (e.g., `product.created.v2`) — both versions coexist |

### Consumer Versioning Rule

```
1. Publisher adds new event version (e.g., product.created.v2)
2. Consumers updated to handle v2 (can handle both v1 and v2)
3. Publisher switches to v2
4. Old consumers still work (ignore unknown fields)
5. After all consumers updated → v1 can be deprecated
```

## Rollback Strategy

### Automatic Rollback Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error rate (5xx) | > 5% for 2 minutes | Auto-rollback |
| Latency p99 | > 10x baseline for 3 minutes | Auto-rollback |
| Health check | `degraded` for 1 minute | Auto-rollback |
| DB connection pool | > 90% utilized | Alert (not auto-rollback) |

### Rollback Flow

```
1. Load balancer switches to BLUE (old version)
2. GREEN instances drained (finish in-flight requests, max 30s)
3. GREEN instances terminated
4. Alert sent to ops team
5. If migration was applied: evaluate if DOWN migration is needed
   - Additive migration (new column) → keep, safe for old code
   - Destructive migration → run DOWN migration
6. Post-mortem within 24 hours
```

### Rollback Guarantee

- Rollback MUST complete within 60 seconds (including DNS/traffic switch)
- Rollback MUST NOT require data migration in most cases (additive migrations are safe)
- If data migration IS required for rollback, it MUST be pre-tested

## Deployment Checklist

- [ ] Database migration applied (zero-downtime, backward-compatible)
- [ ] Migration verified on staging
- [ ] Smoke tests pass on new version
- [ ] Integration tests pass
- [ ] Monitoring dashboards ready
- [ ] Rollback procedure tested
- [ ] Event version compatibility verified
- [ ] API version compatibility verified
- [ ] Health checks configured

---

# 6. Event Architecture

## Flow

```
BEGIN TRANSACTION
  → write business data
  → write outbox (SAME transaction)
COMMIT

Async Worker (separate process):
  → poll outbox
  → publish to message broker
  → write audit log
  → mark outbox as processed
```

### Delivery Guarantee: AT-LEAST-ONCE

- Workers MAY publish the same event more than once (crash after publish, before marking processed)
- Consumers MUST be idempotent — see **Section 11 (Idempotency)**

```typescript
async handleEvent(event: Event): Promise<void> {
  const processed = await this.processedEventStore.has(event.id);
  if (processed) return;

  await this.handleBusinessLogic(event);
  await this.processedEventStore.mark(event.id);
}
```

## Event Versioning

### Type Format

```
{module}.{action}.v{version}

Examples:
product.created.v1
order.confirmed.v1
product.created.v2
```

### Breaking vs Non-Breaking Changes

| Change | Breaking? | Migration |
|--------|-----------|-----------|
| Add optional field | No | Consumer ignores |
| Add required field | Yes | Consumer must update |
| Remove field | Yes | Use `null` / deprecate first |
| Change field type | Yes | New version required |

### Version Evolution

```typescript
@EventPattern('product.created.v1')
async handleProductCreatedV1(event: Event) {
  // Handle v1 format
}

@EventPattern('product.created.v2')
async handleProductCreatedV2(event: Event) {
  // Handle v2 format with new fields
}
```

## Event Ordering Rule

- **Sequential per aggregate_id**
- Parallel across aggregates

```typescript
class EventProcessor {
  private queues = new Map<string, PQueue>(); // Per aggregate_id

  async process(event: Event): Promise<void> {
    const aggregateId = event.aggregate_id;
    const queue = this.getOrCreateQueue(aggregateId);
    await queue.add(() => this.handleEvent(event));
  }
}
```

## Event Types by Module

| Module | Event Types |
|--------|------------|
| Product | `product.created.v1`, `product.updated.v1`, `product.deleted.v1` |
| Order | `order.created.v1`, `order.confirmed.v1`, `order.cancelled.v1`, `order.completed.v1` |
| Inventory | `inventory.reserved.v1`, `inventory.released.v1`, `inventory.adjusted.v1` |
| Voucher | `voucher.created.v1`, `voucher.redeemed.v1`, `voucher.expired.v1` |
| Wallet | `wallet.credited.v1`, `wallet.debited.v1`, `wallet.created.v1` |
| Loyalty | `points.earned.v1`, `points.redeemed.v1`, `tier.upgraded.v1` |
| CRM | `customer.created.v1`, `customer.updated.v1`, `tag.added.v1` |

---

## Event Processing Guarantees (Strict) (NEW in v2.1)

### Contract Summary

| Guarantee | Mechanism |
|-----------|-----------|
| Delivery | **At-least-once** (worker may publish duplicate) |
| Ordering | **Sequential per aggregate_id**, parallel across aggregates |
| Deduplication | Consumer-side via processed-event store (Section 11) |
| Concurrency | One consumer per aggregate_id queue, bounded parallelism across aggregates |
| Acknowledgment | Explicit ACK after successful processing + mark |

### Exact Processing Flow (Consumer Side)

```
1. Consumer receives message from RabbitMQ
2. Deserialize and validate event schema
3. Check processed-event store for event.id
   → EXISTS: ACK message, skip (dedup)
   → NOT EXISTS: continue
4. Enqueue onto per-aggregate_id PQueue (sequential ordering)
5. Execute handler:
   a. Start DB transaction
   b. Execute business logic
   c. Write to processed-event store (same transaction)
   d. Commit transaction
   e. ACK RabbitMQ message
6. On handler failure:
   a. Do NOT ACK (RabbitMQ will re-deliver)
   b. Log error with full context
   c. Increment error metric
   d. After max retries → message goes to DLQ
```

### Deduplication Strategy

```typescript
// processed_events table (see Section 11 for full mechanism)
// Check-and-mark is atomic within the handler's DB transaction

async consumeEvent(event: Event): Promise<void> {
  // Step 1: Check dedup (before entering aggregate queue)
  if (await this.processedEventStore.has(event.id)) {
    return; // Already processed — safe to skip
  }

  // Step 2: Enqueue for sequential per-aggregate processing
  await this.aggregateQueue.add(event.aggregate_id, async () => {
    // Step 3: Double-check inside transaction (handles race between check and queue)
    await this.db.transaction(async (tx) => {
      const alreadyProcessed = await this.processedEventStore.has(event.id, tx);
      if (alreadyProcessed) return;

      await this.handler(event, tx);
      await this.processedEventStore.mark(event.id, tx);
    });
  });
}
```

**Why double-check?** Between step 1 (check) and step 3 (mark), another consumer instance might have processed the same event. The transaction-level check guarantees exactly-once semantics despite at-least-once delivery.

### Ordering Guarantees

| Scope | Guarantee | Implementation |
|-------|-----------|----------------|
| Same `aggregate_id` | Strict FIFO order | Per-aggregate PQueue (concurrency: 1) |
| Different `aggregate_id` | Parallel, no ordering guarantee | Separate PQueues per aggregate |
| Same event type, different aggregates | No ordering guarantee | Parallel processing |
| Consumer restart | Resumes from last unprocessed | RabbitMQ does not ACK until processed |

### Failure Scenarios

| Scenario | What Happens | Recovery |
|----------|-------------|----------|
| Worker crashes after publish but before marking outbox processed | Event re-delivered on next poll → consumer deduplicates via processed-event store | Automatic |
| Consumer crashes after DB commit but before RabbitMQ ACK | RabbitMQ re-delivers → consumer deduplicates via processed-event store | Automatic |
| Consumer crashes during handler execution (mid-transaction) | DB transaction rolls back → processed-event not marked → RabbitMQ re-delivers | Automatic |
| Consumer handler throws business error (non-retryable) | After max retries → message goes to DLQ → alert ops team | Manual intervention |
| Duplicate event delivery (at-least-once) | Consumer checks processed-event store → skips if already processed | Automatic |
| RabbitMQ broker restart | Messages in transit lost → outbox worker re-publishes from unprocessed outbox entries | Automatic |
| Multiple consumer instances | Each instance picks different messages via RabbitMQ prefetch; per-aggregate queue ensures no parallel processing of same aggregate | Automatic |

### Worker Restart Behavior

```
Worker starts →
  1. Connect to RabbitMQ
  2. Register consumer for relevant event patterns
  3. Set prefetch = 1 per consumer (process one at a time per instance)
  4. Begin consuming
  5. No explicit "resume from offset" needed — RabbitMQ tracks delivery

Worker crashes →
  1. RabbitMQ detects connection loss
  2. Unacked messages re-queued
  3. Other consumers pick up re-queued messages
  4. If no other consumers: messages wait until worker restarts
  5. No data loss (messages persisted in RabbitMQ)
```

### Concurrency Control

```typescript
// Global concurrency limit per consumer group
const consumerConfig = {
  prefetchCount: 10,            // Max unacked messages per consumer instance
  aggregateConcurrency: 1,      // Strict FIFO per aggregate_id
  globalConcurrency: 50,        // Max parallel aggregate queues
};
```

### Monitoring (Event Processing)

| Metric | Type | Labels | Alert |
|--------|------|--------|-------|
| `event_consumer_lag_seconds` | Histogram | `type` | > 60s |
| `event_consumer_duration_seconds` | Histogram | `type` | > p99 threshold |
| `event_consumer_duplicate_total` | Counter | `type` | High rate (indicates delivery issues) |
| `event_consumer_error_total` | Counter | `type`, `error_code` | > 0 |
| `event_dlq_size` | Gauge | — | > 0 (immediate alert) |
| `event_processed_total` | Counter | `type` | — |

---

# 7. Transaction Rules (STRICT)

> See **Section 6 (Event Architecture → Flow)** for transaction flow diagram.
> Enforced by **ADR-005** (`emit(event, tx)` throws without `tx`).

## MUST NOT

- emit event before transaction commit
- write outbox in separate transaction
- publish before outbox is persisted

---

# 8. Service Contract (Versioning)

## Version Format

- **Date-based**: `YYYY.MM.DD` (e.g., `2026.03.31`)
- **Semver** for public APIs: `major.minor.patch`

## Compatibility Rules

| Change | Compatible? |
|--------|-------------|
| Add new method | ✅ Yes (backward) |
| Add optional param | ✅ Yes (backward) |
| Remove method | ❌ No (breaking) |
| Change param type | ❌ No (breaking) |
| Add required param | ❌ No (breaking) |

## Backward Compatibility

```typescript
interface IProductService {
  // v2026.03.31
  getProduct(id: string): Product;

  // v2026.04.01 - NEW optional param (backward compatible)
  getProduct(id: string, options?: GetProductOptions): Product;
}
```

---

# 9. Concurrency Control

→ **Optimistic locking**

```typescript
interface VersionableEntity {
  id: string;
  version: number; // Increment on every update
  updatedAt: Date;
}
```

On conflict:
- return HTTP 409
- client retry

---

# 10. Saga Orchestration (Production)

## Design: Centralized Orchestrator

The system uses a **centralized orchestrator** pattern. A single SagaOrchestrator service drives execution; participants expose only compensatable actions via service interfaces.

```
┌─────────────────────────────────────────────────┐
│                 SagaOrchestrator                 │
│                                                  │
│  1. validate           (synchronous, in-process) │
│  2. reserveInventory   (IInventoryService)       │
│  3. chargePayment      (IPaymentService)         │
│  4. confirmOrder       (IOrderService)           │
│                                                  │
│  On ANY step failure → compensate in REVERSE     │
│  Completed steps: [2,3] → compensate 3, then 2   │
└─────────────────────────────────────────────────┘
```

## State Machine

```
                 ┌──────────┐
         ┌──────▶│ PENDING  │
         │       └────┬─────┘
         │            │ startSaga()
         │            ▼
         │       ┌──────────┐
         │  ┌───▶│ RUNNING  │◀───┐
         │  │    └────┬─────┘    │
         │  │         │          │ step N succeeds
         │  │         │ all done │──────────┐
         │  │         ▼          │          │
         │  │    ┌──────────┐    │          ▼
         │  │    │COMPLETED │    │    ┌──────────┐
         │  │    └──────────┘    │    │ PENDING  │
         │  │                   │    │ COMPEN-  │
         │  │  step N fails     │    │ SATING   │
         │  │         │          │    └────┬─────┘
         │  │         ▼          │         │
         │  │  ┌──────────┐     │         │ all compensated
         │  │  │COMPEN-   │─────┘         │
         │  │  │SATING    │───────────────┘
         │  │  └────┬─────┘
         │  │       │ compensation fails
         │  │       ▼
         │  │  ┌──────────┐
         │  └──│ FAILED   │
         │     └──────────┘
         │
         └── retrySaga() (from FAILED → PENDING, max retries)
```

### State Definitions

| State | Meaning | Next States |
|-------|---------|-------------|
| `PENDING` | Saga created, not yet started | `RUNNING` |
| `RUNNING` | Executing forward steps | `COMPLETED`, `COMPENSATING`, `FAILED` |
| `COMPLETED` | All steps succeeded | — (terminal) |
| `COMPENSATING` | Reverting completed steps in reverse | `COMPLETED`, `FAILED` |
| `FAILED` | Saga cannot proceed; requires manual intervention or retry | `PENDING` (via retry) |

### Transition Rules

- `PENDING → RUNNING`: `startSaga()` called by orchestrator
- `RUNNING → COMPLETED`: Last step succeeds
- `RUNNING → COMPENSATING`: Any step fails (business error or timeout)
- `COMPENSATING → COMPLETED`: All compensations succeed (saga is safely rolled back)
- `COMPENSATING → FAILED`: Any compensation fails after retries exhausted
- `FAILED → PENDING`: Manual retry or scheduled retry (within `maxRetries`)

## Saga Definition

```typescript
interface ISagaStep<TContext = unknown> {
  name: string;
  execute(ctx: TContext): Promise<void>;
  compensate(ctx: TContext): Promise<void>;
  timeout: number;          // Per-step timeout in ms
  retry: StepRetryConfig;
}

interface StepRetryConfig {
  maxAttempts: number;      // Default: 1 (no retry for saga steps)
  backoffMs: number;        // Default: 0
  retryableErrors: string[];// Error codes that trigger retry
}

interface SagaDefinition<TContext = unknown> {
  name: string;                     // e.g., "create-order"
  aggregateId: string;              // Business aggregate (e.g., order ID)
  steps: ISagaStep<TContext>[];
  maxRetries: number;               // Default: 3 (saga-level retry from FAILED)
  retryDelayMs: number;             // Default: 60000 (1 minute between saga retries)
}
```

## Order Creation Saga Example

```typescript
const createOrderSaga: SagaDefinition<CreateOrderContext> = {
  name: 'create-order',
  aggregateId: '', // Set at runtime
  maxRetries: 3,
  retryDelayMs: 60_000,
  steps: [
    {
      name: 'reserve-inventory',
      timeout: 10_000,
      retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
      async execute(ctx) {
        await this.inventoryService.reserve(ctx.orderId, ctx.items);
      },
      async compensate(ctx) {
        await this.inventoryService.release(ctx.orderId, ctx.items);
      },
    },
    {
      name: 'charge-payment',
      timeout: 30_000,
      retry: { maxAttempts: 2, backoffMs: 5000, retryableErrors: ['PAYMENT_GATEWAY_TIMEOUT'] },
      async execute(ctx) {
        ctx.paymentId = await this.paymentService.charge(ctx.customerId, ctx.total);
      },
      async compensate(ctx) {
        await this.paymentService.refund(ctx.paymentId);
      },
    },
    {
      name: 'confirm-order',
      timeout: 10_000,
      retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
      async execute(ctx) {
        await this.orderService.confirm(ctx.orderId, ctx.paymentId);
      },
      async compensate(ctx) {
        await this.orderService.cancel(ctx.orderId, 'payment_reversed');
      },
    },
  ],
};
```

## Orchestrator

```typescript
class SagaOrchestrator {
  constructor(
    private sagaStateRepo: SagaStateRepository,
    private logger: Logger,
    private metrics: Metrics,
  ) {}

  async start<TContext>(definition: SagaDefinition<TContext>, ctx: TContext): Promise<void> {
    const sagaId = generateUuid();
    await this.sagaStateRepo.create({
      sagaId,
      sagaName: definition.name,
      aggregateId: definition.aggregateId,
      status: 'RUNNING',
      currentStep: 0,
      completedSteps: [],
      context: ctx,
      startedAt: new Date(),
      updatedAt: new Date(),
    });

    await this.executeSteps(sagaId, definition, ctx);
  }

  private async executeSteps<TContext>(
    sagaId: string,
    definition: SagaDefinition<TContext>,
    ctx: TContext,
  ): Promise<void> {
    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];

      try {
        await Promise.race([
          step.execute(ctx),
          this.timeout(step.timeout, `Step ${step.name} timed out after ${step.timeout}ms`),
        ]);

        await this.sagaStateRepo.markStepCompleted(sagaId, step.name, i);
      } catch (error) {
        if (this.isRetryable(error, step) && this.getStepAttempts(sagaId, step.name) < step.retry.maxAttempts) {
          await this.delay(step.retry.backoffMs);
          i--; // Retry same step
          continue;
        }

        this.logger.warn({ sagaId, step: step.name, error }, 'Saga step failed, starting compensation');
        await this.compensate(sagaId, definition, ctx, i);
        return;
      }
    }

    await this.sagaStateRepo.updateStatus(sagaId, 'COMPLETED');
  }

  private async compensate<TContext>(
    sagaId: string,
    definition: SagaDefinition<TContext>,
    ctx: TContext,
    failedStepIndex: number,
  ): Promise<void> {
    await this.sagaStateRepo.updateStatus(sagaId, 'COMPENSATING');

    // Compensate in REVERSE order of completed steps
    for (let i = failedStepIndex - 1; i >= 0; i--) {
      const step = definition.steps[i];
      const isCompleted = await this.sagaStateRepo.isStepCompleted(sagaId, step.name);
      if (!isCompleted) continue;

      try {
        await Promise.race([
          step.compensate(ctx),
          this.timeout(step.timeout * 2, `Compensation ${step.name} timed out`),
        ]);

        await this.sagaStateRepo.markStepCompensated(sagaId, step.name);
      } catch (compensationError) {
        this.logger.error(
          { sagaId, step: step.name, error: compensationError },
          'Saga compensation FAILED — manual intervention required',
        );
        await this.sagaStateRepo.updateStatus(sagaId, 'FAILED');
        this.metrics.increment('saga_compensation_failed', { saga: definition.name, step: step.name });
        return;
      }
    }

    await this.sagaStateRepo.updateStatus(sagaId, 'COMPLETED');
  }
}
```

## Crash Recovery

On application startup, the orchestrator MUST recover incomplete sagas:

```typescript
class SagaRecoveryService {
  async recover(): Promise<void> {
    const incompleteSagas = await this.sagaStateRepo.findByStatus(['RUNNING', 'COMPENSATING']);

    for (const saga of incompleteSagas) {
      const age = Date.now() - saga.updatedAt.getTime();

      if (saga.status === 'RUNNING') {
        // If saga was running and no update for > step timeout * 3, it crashed
        if (age > saga.currentStepTimeout * 3) {
          await this.orchestrator.compensate(
            saga.sagaId,
            saga.definition,
            saga.context,
            saga.currentStep,
          );
        }
      }

      if (saga.status === 'COMPENSATING') {
        // If compensation was in progress and crashed, resume from last compensated step
        await this.orchestrator.resumeCompensation(saga);
      }
    }
  }
}
```

### Recovery Rules

| Scenario | Action |
|----------|--------|
| `RUNNING` + stale (no update > 3x step timeout) | Start compensation from last completed step |
| `RUNNING` + recent (update within timeout) | Skip — may still be in progress on another instance |
| `COMPENSATING` + stale | Resume compensation from last compensated step |
| `FAILED` + within maxRetries | Queue for automatic retry after `retryDelayMs` |
| `FAILED` + retries exhausted | Alert ops team — manual intervention required |

## Persistence Schema (Drizzle)

```typescript
export const sagaState = pgTable('saga_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  sagaId: uuid('saga_id').notNull().unique(),
  sagaName: varchar('saga_name', { length: 100 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  status: varchar('status', { length: 50 }).notNull(), // RUNNING, COMPLETED, COMPENSATING, FAILED
  currentStep: integer('current_step').notNull().default(0),
  completedSteps: jsonb('completed_steps').notNull().default([]), // [{name, completedAt}]
  compensatedSteps: jsonb('compensated_steps').notNull().default([]), // [{name, compensatedAt}]
  context: jsonb('context').notNull(), // Saga-specific context (encrypted if sensitive)
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  startedAt: timestamp('started_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  completedAt: timestamp('completed_at'),
});

// Index for recovery queries
// CREATE INDEX idx_saga_state_status ON saga_state (status, updated_at);
```

## Monitoring

| Metric | Type | Labels | Alert |
|--------|------|--------|-------|
| `saga_duration_seconds` | Histogram | `saga_name` | > p99 threshold |
| `saga_completed_total` | Counter | `saga_name` | — |
| `saga_compensated_total` | Counter | `saga_name`, `failed_step` | > 5 in 10 min |
| `saga_failed_total` | Counter | `saga_name`, `failed_step` | > 0 (immediate) |
| `saga_recovery_total` | Counter | `saga_name`, `status` | — |
| `saga_running_total` | Gauge | `saga_name` | > 0 for > 5 min |

## Guarantees

1. **Atomicity of each step**: Each `execute()` or `compensate()` runs independently. Steps MUST be idempotent.
2. **Compensation in reverse**: Completed steps are compensated in reverse order.
3. **No partial compensation skip**: If compensation fails on step N, steps 0..N-1 are NOT skipped — saga enters `FAILED` state.
4. **Recovery on restart**: All `RUNNING`/`COMPENSATING` sagas are recovered on startup.
5. **Manual intervention**: `FAILED` sagas with exhausted retries MUST alert ops. No auto-retry beyond `maxRetries`.

---

# 11. Idempotency (MANDATORY)

## Applies to

- API (POST/PUT)
- Event consumer
- Background job

## Dual Mechanism (ENHANCED in v2)

| Layer | Store | Key | TTL |
|-------|-------|-----|-----|
| **API** | Redis | `Idempotency-Key` header + user scope | 24h |
| **Event consumer** | Processed-event store (DB) | `event.id` | Same as log retention (ADR-003) |
| **Background job** | BullMQ built-in | Job ID | Job retention |

### API Idempotency

```typescript
interface IdempotencyConfig {
  keyHeader: 'Idempotency-Key';
  scope: 'per-user';
  expiration: '24h';
}

async handleRequest(req: Request, handler: Handler): Promise<Response> {
  const key = req.headers['idempotency-key'];
  const cached = await this.idempotencyStore.get(key);

  if (cached) {
    return cached.response;
  }

  const response = await handler(req);
  await this.idempotencyStore.set(key, response);
  return response;
}
```

### Event Consumer Idempotency (NEW in v2)

```typescript
interface ProcessedEventStore {
  has(eventId: string): Promise<boolean>;
  mark(eventId: string): Promise<void>;
}

async handleEvent(event: Event): Promise<void> {
  const processed = await this.processedEventStore.has(event.id);
  if (processed) return;

  await this.handleBusinessLogic(event);
  await this.processedEventStore.mark(event.id);
}
```

**Why separate stores:**
- API idempotency needs fast Redis lookup + per-user scoping
- Event idempotency needs durable storage aligned with log retention
- Different TTL requirements (24h vs years)
- Different key semantics (user-provided key vs event.id)

---

# 12. Plugin System

## Interface

```typescript
interface IPlugin {
  getMetadata(): PluginMetadata;
  getModules(): Module[];

  // Lifecycle hooks
  onInstall?(): Promise<void>;
  onActivate(): Promise<void>;      // REQUIRED
  onDeactivate(): Promise<void>;    // REQUIRED
  onUninstall?(): Promise<void>;
  dispose(): Promise<void>;         // MANDATORY
}

interface PluginMetadata {
  name: string;
  version: string;        // Date-based: "2026.03.31"
  description: string;
  author?: string;
  dependencies?: {
    name: string;
    version: string;      // e.g., ">=2026.03.01", "^2026.03.31"
  }[];
  enabled: boolean;
  config?: object;
  permissions?: PluginPermission[];  // NEW in v2
}
```

## Permission Manifest (NEW in v2)

Each plugin declares its required permissions in metadata. Core validates at activation.

```typescript
interface PluginPermission {
  resource: string;          // e.g., "product", "order", "external:smtp"
  actions: string[];         // e.g., ["read", "write"] or ["call"]
  scope?: string;            // e.g., "plugin_analytics_*" for isolated storage
}

// Example: analytics plugin
const analyticsPermissions: PluginPermission[] = [
  { resource: 'product', actions: ['read'] },
  { resource: 'order', actions: ['read'] },
  { resource: 'external:email', actions: ['call'] },
  { resource: 'plugin_analytics_*', actions: ['read', 'write'] },
];
```

### Validation

```typescript
class PluginGuard {
  validate(permissions: PluginPermission[], requestedAccess: AccessRequest): boolean {
    // Check if requested access is within declared permissions
    return permissions.some(p =>
      p.resource === requestedAccess.resource &&
      p.actions.includes(requestedAccess.action)
    );
  }
}
```

## Lifecycle Mapping

| Stage | Required |
|-------|----------|
| install | optional |
| activate | required (+ permission validation) |
| deactivate | required |
| uninstall | optional |
| dispose | **MANDATORY** |

## Rules

Plugin:
- ❌ no DB access (except isolated storage via declared scope)
- ❌ no internal API access
- ❌ no side effects on import
- ❌ no global state mutation
- ✅ use: service interfaces, event bus
- ✅ declare: permissions manifest

---

# 13. Plugin Isolation Evolution Strategy (v2.1)

## Overview

Plugin isolation evolves in three phases. Each phase is backward-compatible — plugins written for Phase 1 work in Phase 2 without modification.

```
Phase 1 (Current)          Phase 2 (Isolated)        Phase 3 (Sandboxed)
─────────────────          ─────────────────        ──────────────────
Same process               Separate process          Separate process
Soft resource limits       Hard resource limits      Hard resource limits
In-process IPC             Message-based IPC         Message-based IPC
No memory isolation        No memory sharing         Memory sandbox (vm2/isolated-vm)
                           Permission enforcement   Permission + capability enforcement
```

## Phase 1: In-Process (Current)

### Architecture

```
┌────────────────────────────────────────────────┐
│                  Main Process                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Plugin A │  │  Plugin B │  │ Core Modules  │   │
│  │  (direct) │  │  (direct) │  │              │   │
│  └──────────┘  └──────────┘  └──────────────┘   │
│                                                  │
│  Enforcement: timeout + resource quota (soft)     │
└────────────────────────────────────────────────┘
```

### Enforcement

```typescript
interface PluginResourceQuota {
  memory: '512MB' | '1GB' | '2GB';
  cpu: '0.5' | '1' | '2';
  requestsPerMinute: number;
  maxConnections: number;
}

// Phase 1: Soft enforcement via middleware
// Note: Cannot truly enforce memory/CPU in same process
// Plugins can technically exceed limits — this is monitored, not blocked
```

### Limitations (Phase 1)

- Plugin crash CAN crash the main process (if uncaught exception bypasses try/catch)
- Memory/CPU limits are **monitored, not enforced** (no OS-level isolation)
- Plugin CAN access Node.js globals (Buffer, fs, process.env)
- Plugin CAN potentially read other module's memory (if reference leaked)

### Phase 1 Hardening

```typescript
// Wrap every plugin call in isolated error boundary
class PluginInvoker {
  async invoke<T>(plugin: IPlugin, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error({ plugin: plugin.getMetadata().name, error }, 'Plugin threw uncaught error');
      throw new PluginError(plugin.getMetadata().name, error);
    }
  }
}
```

## Phase 2: Process Isolation (Roadmap)

### Architecture

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│    Main Process      │     │    Plugin Process A   │     │    Plugin Process B   │
│                      │     │                      │     │                      │
│  Core Modules        │◄───►│  Plugin Code         │     │  Plugin Code         │
│  Plugin Manager      │ IPC │  Service Proxies     │     │  Service Proxies     │
│                      │     │                      │     │                      │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘

Communication: MessagePort (Node.js worker_threads) or parent-child process IPC
No shared memory — all data serialized
```

### Communication Protocol

```typescript
// Main process → Plugin process (request)
interface PluginMessage {
  id: string;               // Correlate request/response
  type: 'request' | 'response' | 'event' | 'error';
  method: string;           // e.g., "handleEvent"
  args: unknown[];
  timestamp: number;
}

// Plugin process exposes a message handler
interface PluginProcess {
  handleMessage(message: PluginMessage): Promise<PluginMessage>;
}

// Core routes messages via PluginManager
class PluginManager {
  private workers = new Map<string, Worker>();

  async callPlugin<T>(pluginName: string, method: string, args: unknown[]): Promise<T> {
    const worker = this.workers.get(pluginName);
    if (!worker) throw new PluginNotActiveError(pluginName);

    const messageId = generateUuid();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new PluginTimeoutError(pluginName)), 30_000);

      worker.once('message', (response: PluginMessage) => {
        clearTimeout(timeout);
        if (response.type === 'error') {
          reject(new PluginError(pluginName, response.args[0]));
        } else {
          resolve(response.args[0]);
        }
      });

      worker.postMessage({ id: messageId, type: 'request', method, args, timestamp: Date.now() });
    });
  }
}
```

### Hard Resource Enforcement

```typescript
// Phase 2: OS-level enforcement via worker_threads
const worker = new Worker('./plugin-runner.js', {
  resourceLimits: {
    maxOldGenerationSizeMb: quota.memory === '512MB' ? 512 : quota.memory === '1GB' ? 1024 : 2048,
    maxYoungGenerationSizeMb: 128,
  },
  execArgv: ['--max-old-space-size=512'],
});

// CPU: enforced via token bucket in PluginManager
class CpuLimiter {
  private tokens: number;
  private lastRefill: number;

  async acquire(pluginName: string, cost: number = 1): Promise<void> {
    this.refill();
    if (this.tokens < cost) {
      throw new PluginThrottledError(pluginName, 'CPU quota exceeded');
    }
    this.tokens -= cost;
  }
}
```

### Crash Isolation Guarantee

```
Plugin process crash → Main process:
  1. Detect via worker 'exit' event
  2. Log crash with stack trace
  3. Emit internal alert
  4. Mark plugin as CRASHED (not ACTIVE)
  5. Optional: auto-restart plugin process (if configured)
  6. Main process CONTINUES running — other plugins unaffected
```

### Security Boundary

- **No shared memory**: All data between main ↔ plugin is serialized (structured clone)
- **No shared file descriptors**: Plugin process cannot access main process's open connections
- **No access to process.env**: Plugin receives only its own config via message
- **No access to main process DB connections**: Plugin must use service proxy interfaces

## Phase 3: Sandbox (Optional Future)

Same architecture as Phase 2, with additional:
- Code sandboxing (vm2 or isolated-vm)
- Capability-based security (explicit permission grants)
- Network namespace isolation
- Read-only filesystem access

## Migration Strategy (NO Breaking Change)

### Phase 1 → Phase 2 Migration

| Step | Action | Breaking? |
|------|--------|-----------|
| 1 | Add `PluginProcess` runner alongside in-process runner | No |
| 2 | Add `isolation: 'process'` to PluginMetadata (opt-in) | No |
| 3 | Plugins default to `isolation: 'in-process'` (current behavior) | No |
| 4 | New plugins can opt-in to `isolation: 'process'` | No |
| 5 | Existing plugins continue working in-process | No |
| 6 | Deprecate `in-process` isolation (warn in logs) | No |
| 7 | Eventually make `process` the default (major version bump) | Yes |

### Plugin Metadata (Extended)

```typescript
interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  isolation?: 'in-process' | 'process'; // Default: 'in-process' (Phase 1)
  // ... existing fields
}
```

### Backward Compatibility Guarantee

- Plugin written for Phase 1 works in Phase 2 without any code change
- Phase 2 only requires changing the `isolation` field in metadata
- Service interfaces, event bus, hooks — all work identically across phases
- The communication layer is transparent to the plugin

---

# 14. Plugin Lifecycle Management

## Lifecycle Flow

```
install → activate → deactivate → dispose
```

## Dispose MUST

- remove listeners
- stop jobs
- release resources

## Dependency Resolution

- declared in manifest
- resolved via **topological sort**

---

# 15. External Integration (ENHANCED in v2.1)

## Rule

Plugin MUST call external API via:

```
Core Proxy Layer
```

## Benefits

- logging
- rate limit
- timeout
- security
- circuit breaker (v2.1)
- cascading failure protection (v2.1)

## Circuit Breaker (NEW in v2.1)

Every external call MUST be protected by a circuit breaker to prevent cascading failures.

### State Machine

```
         success
   ┌──────────────┐
   │              │
   ▼              │
┌────────┐  close  ┌────────────┐
│ CLOSED │───────▶│ HALF-OPEN  │
└───┬────┘        └─────┬──────┘
    │                    │
    │ failure threshold  │ failure
    │ reached            │
    ▼                    │
┌────────┐               │
│  OPEN  │───────────────┘
└───┬────┘  timeout expires
    │        (half-open probe)
    └────────────────────────┘
```

### States

| State | Behavior |
|-------|----------|
| **CLOSED** | Normal operation — requests pass through. Track success/failure count. |
| **OPEN** | All requests fail fast (no outbound call). Return fallback or error. Wait for `resetTimeout`. |
| **HALF-OPEN** | Allow limited probe requests (1-3). If any succeeds → CLOSED. If fails → OPEN. |

### Configuration

```typescript
interface CircuitBreakerConfig {
  target: string;              // External service identifier
  failureThreshold: number;    // Failures before opening (default: 5)
  successThreshold: number;    // Successes in half-open before closing (default: 3)
  resetTimeoutMs: number;      // Time in OPEN before half-open probe (default: 30000)
  monitorIntervalMs: number;   // Sliding window duration (default: 60000)
  halfOpenMaxProbes: number;   // Max requests in half-open state (default: 3)
}

const defaultCircuitBreakerConfigs: Record<string, CircuitBreakerConfig> = {
  'payment-gateway': {
    target: 'payment-gateway',
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 60_000,
    monitorIntervalMs: 120_000,
    halfOpenMaxProbes: 2,
  },
  'email-service': {
    target: 'email-service',
    failureThreshold: 10,
    successThreshold: 3,
    resetTimeoutMs: 30_000,
    monitorIntervalMs: 60_000,
    halfOpenMaxProbes: 3,
  },
};
```

### Implementation

```typescript
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenProbes = 0;

  constructor(
    private config: CircuitBreakerConfig,
    private logger: Logger,
    private metrics: Metrics,
  ) {}

  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenProbes = 0;
      } else {
        this.metrics.increment('circuit_breaker_rejected', { target: this.config.target, state: 'OPEN' });
        if (fallback) {
          this.logger.warn({ target: this.config.target }, 'Circuit OPEN — executing fallback');
          return fallback();
        }
        throw new CircuitOpenError(this.config.target);
      }
    }

    if (this.state === CircuitState.HALF_OPEN && this.halfOpenProbes >= this.config.halfOpenMaxProbes) {
      this.metrics.increment('circuit_breaker_rejected', { target: this.config.target, state: 'HALF_OPEN' });
      if (fallback) return fallback();
      throw new CircuitOpenError(this.config.target);
    }

    try {
      if (this.state === CircuitState.HALF_OPEN) this.halfOpenProbes++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      this.logger.warn(
        { target: this.config.target, state: this.state, error },
        'External call failed',
      );
      if (fallback) return fallback();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.logger.info({ target: this.config.target }, 'Circuit CLOSED — service recovered');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.logger.error(
        { target: this.config.target, failureCount: this.failureCount },
        'Circuit OPEN — failure threshold reached',
      );
    }
  }

  getState(): CircuitState { return this.state; }
}
```

### Timeout + Retry Interaction

```
External call flow:
  1. Circuit breaker check (OPEN? → fail fast)
  2. Start request with timeout (default: 30s)
  3. On timeout → count as failure → increment circuit breaker
  4. On 5xx response → count as failure → increment circuit breaker
  5. On 429 (rate limited) → count as failure → increment circuit breaker
  6. On success → reset failure count
  7. On client error (4xx) → do NOT count as failure (caller's fault)
```

```typescript
class ExternalServiceProxy {
  private breakers = new Map<string, CircuitBreaker>();

  async call(plugin: IPlugin, target: string, request: Request): Promise<Response> {
    this.validatePermission(plugin, target);
    await this.audit.log(plugin.name, target);

    const breaker = this.getOrCreateBreaker(target);

    return breaker.execute(
      () => this.httpClient.request(target, request, { timeout: 30_000 }),
      () => {
        // Fallback: log and return a safe default or throw
        this.logger.warn({ plugin: plugin.name, target }, 'External call failed, fallback executed');
        throw new ExternalServiceUnavailableError(target);
      },
    );
  }

  private getOrCreateBreaker(target: string): CircuitBreaker {
    if (!this.breakers.has(target)) {
      const config = defaultCircuitBreakerConfigs[target] ?? {
        target, failureThreshold: 5, successThreshold: 3, resetTimeoutMs: 30_000,
        monitorIntervalMs: 60_000, halfOpenMaxProbes: 3,
      };
      this.breakers.set(target, new CircuitBreaker(config, this.logger, this.metrics));
    }
    return this.breakers.get(target)!;
  }
}
```

### Metrics

| Metric | Type | Labels | Alert |
|--------|------|--------|-------|
| `circuit_breaker_state` | Gauge | `target` | OPEN for > 5 min |
| `circuit_breaker_rejected_total` | Counter | `target`, `state` | High rate |
| `circuit_breaker_failure_total` | Counter | `target` | Threshold breach |

### Fallback Strategy

| External Service | Fallback Behavior |
|------------------|-------------------|
| Payment gateway | Reject transaction, surface error to user |
| Email service | Queue email for retry via BullMQ |
| SMS service | Queue SMS for retry via BullMQ |
| Analytics | Log event locally, sync later |
| Tax calculation | Return cached rate or default rate |

**Rule:** Fallback MUST be defined for every external service. No silent failure.

---

# 16. Hook System (Extension Points)

## Pre/Post Hooks

Plugins can register hooks to intercept module flows.

```typescript
interface HookPoint {
  name: string;              // e.g., "order.beforeCreate"
  phase: 'pre' | 'post';
  handlers: HookHandler[];
  timeout?: number;          // default: 5000ms
  failSafe?: boolean;        // default: true (continue on failure)
}

interface HookHandler {
  plugin: string;
  priority?: number;        // lower = runs first, default: 100
  handler: (context: HookContext) => Promise<void>;
}
```

## Registration

```typescript
this.hookRegistry.register({
  name: 'order.beforeCreate',
  phase: 'pre',
  timeout: 3000,
  failSafe: true,
  handlers: [
    { plugin: 'voucher', handler: validateVoucher },
    { plugin: 'inventory', handler: checkStock },
  ],
});
```

## Execution with Guards

```typescript
async function executeHooks(point: HookPoint, context: HookContext): Promise<void> {
  const sorted = [...point.handlers].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const handler of sorted) {
    try {
      await Promise.race([
        handler.handler(context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new HookTimeoutError()), point.timeout || 5000)
        )
      ]);
    } catch (error) {
      this.logger.error(`Hook ${handler.plugin} failed`, error);
      if (!point.failSafe) {
        throw error;
      }
    }
  }
}
```

## Rules

- Hooks MUST have timeout (default 5s)
- Hooks MUST be fail-safe by default
- Hooks execute in priority order (lower number = higher priority)
- Pre-hooks can reject (abort flow)
- Post-hooks cannot reject (log only)
- Plugin crash in hook MUST NOT crash system

---

# 17. Queue Boundary

## Clear Separation

| Queue System | Purpose |
|--------------|---------|
| **RabbitMQ** | Event Bus (inter-module communication) |
| **BullMQ** | Background Jobs (bulk processing, scheduled tasks) |

```typescript
// RabbitMQ: Event-driven inter-module
await this.eventBus.emit('product.created.v1', payload);

// BullMQ: Background processing
await this.importQueue.add('import-products', { fileId: '...' });
```

## BullMQ Concurrency Control (NEW in v2)

Each job type declares its own concurrency limit to prevent resource exhaustion.

```typescript
interface JobConfig {
  name: string;
  concurrency: number;
  attempts: number;
  backoff: {
    type: 'exponential';
    delay: number;
  };
  removeOnComplete: number;  // Keep N completed jobs for debugging
  removeOnFail: number;      // Keep N failed jobs for debugging
}

const jobConfigs: Record<string, JobConfig> = {
  'import-products': {
    name: 'import-products',
    concurrency: 1,           // One import at a time (heavy)
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 10,
    removeOnFail: 50,
  },
  'send-email': {
    name: 'send-email',
    concurrency: 10,          // Parallel email sending
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
};
```

---

# 18. API Architecture

## Rules

- REST only
- OpenAPI = source of truth
- URL versioning: `/api/v1/`
- snake_case external, camelCase internal

## Versioning & Compatibility

- No breaking change without version bump
- Plugin must declare `compatible_api_version`

## Request Validation (ENHANCED in v2)

- **Global ValidationPipe** with `whitelist: true` — strips unknown properties
- **Transform: true** — auto-converts types (string→number, etc.)
- **Forbidden non-whitelisted properties** — rejects request if extra fields present (strict mode for writes)

```typescript
// Global pipe configuration
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }),
);
```

## Security Headers (NEW in v2)

- **Helmet** middleware for security headers
- Headers include: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`

```typescript
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"] },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
```

## Rate Limiting

- **Redis-backed** (sliding window counter)
- **Per-user** + **per-IP** limits
- Default: 100 req/min per user, 60 req/min per IP
- Returns `429 Too Many Requests` with `Retry-After` header
- Custom limits per endpoint (e.g., auth: 5 req/min)

```typescript
interface RateLimitConfig {
  window: string;           // e.g., "60s"
  maxRequests: number;
  strategy: 'per-user' | 'per-ip' | 'both';
  keyPrefix: string;        // e.g., "rl:api:v1"
}
```

## Response Standard (ENFORCED)

### Success Response

```json
{
  "data": {
    "id": "prod_123",
    "product_name": "Sample Product",
    "base_price": 100000
  },
  "meta": {
    "timestamp": "2026-03-31T10:00:00Z",
    "version": "v1",
    "request_id": "req_abc123"
  }
}
```

### Paginated Response

```json
{
  "data": [],
  "meta": {
    "timestamp": "2026-03-31T10:00:00Z",
    "version": "v1",
    "request_id": "req_abc123",
    "pagination": {
      "cursor": "eyJpZCI6MTIzfQ",
      "has_more": true,
      "limit": 20
    }
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "trace_id": "req_abc123"
  }
}
```

### Rules

- ALL responses MUST use envelope format `{data, meta}` or `{error}`
- `data` is `null` only on error responses
- `meta.request_id` is MANDATORY for tracing
- `error.trace_id` MUST match `meta.request_id`
- Error `details` array is optional (for validation errors)

---

# 19. Read Model Strategy

## Data Source Priority

| Source | Use Case | Latency |
|--------|----------|---------|
| **Primary: PostgreSQL** | All writes + reads | ~5ms |
| **Secondary: Redis** | Hot data, session, cache | ~1ms |
| **Projection: Elasticsearch** | Search, analytics, filtering | ~10ms |

## Read Flow

```
API Request
  → Check Redis cache
    → HIT: return cached data
    → MISS: query PostgreSQL
      → write result to Redis (TTL-based)
      → return data

Search Request
  → Query Elasticsearch
    → Results from projection (synced via events)
```

## Write Flow

```
Write Request
  → Write to PostgreSQL (primary)
  → Write to Outbox (same transaction)
  → Invalidate Redis cache (async)
  → Event syncs to Elasticsearch (async)
```

## Cache Strategy

```typescript
interface CacheConfig {
  ttl: number;
  strategy: 'cache-aside' | 'write-through';
  invalidation: 'event-driven' | 'ttl-only';
}

const cacheDefaults: Record<string, CacheConfig> = {
  product: { ttl: 300, strategy: 'cache-aside', invalidation: 'event-driven' },
  user: { ttl: 60, strategy: 'cache-aside', invalidation: 'event-driven' },
  config: { ttl: 3600, strategy: 'write-through', invalidation: 'event-driven' },
};
```

## Search Sync

```typescript
@EventPattern('product.updated.v1')
async handleProductUpdated(event: Event): Promise<void> {
  const product = await this.productService.getProduct(event.aggregate_id);
  await this.searchService.index('products', product);
}
```

## Rules

- Writes ALWAYS go to PostgreSQL first
- Redis is cache-only (never source of truth)
- Elasticsearch is projection-only (never source of truth)
- Cache invalidation via events (not manual)
- Stale data in cache is acceptable within TTL window
- Cache race condition (invalidate while read in progress): acceptable, resolves at TTL expiry
- For critical entities requiring strong consistency, use `write-through` strategy

---

# 20. Security Model

## Auth (ENHANCED in v2)

- **JWT RS256** (asymmetric, public/private key pair)
- Access token: short-lived (15 min)
- Refresh token: long-lived (7 days) with rotation
- Token revocation support (Redis blacklist)

```typescript
interface AuthConfig {
  algorithm: 'RS256';
  accessTokenTtl: '15m';
  refreshTokenTtl: '7d';
  issuer: string;
  audience: string;
}

interface TokenPayload {
  sub: string;          // User ID
  email: string;
  roles: string[];
  permissions: string[];
  iat: number;
  exp: number;
}
```

### Token Revocation

```typescript
class TokenRevocationService {
  async revoke(tokenId: string, reason: 'logout' | 'security' | 'admin'): Promise<void> {
    await this.redis.set(
      `revoked:${tokenId}`,
      JSON.stringify({ reason, revokedAt: new Date().toISOString() }),
      'EX',
      this.refreshTokenTtlSeconds,
    );
  }

  async isRevoked(tokenId: string): Promise<boolean> {
    return (await this.redis.exists(`revoked:${tokenId}`)) === 1;
  }
}
```

## Authorization

- RBAC (phase 1)
- extensible to ABAC

### RBAC + Permissions (NEW in v2)

```typescript
// Decorator-based access control
@Roles('admin', 'manager')
@Permissions('product:write')
@Post('/products')
async createProduct(@Body() dto: CreateProductDto) { }

// Guards enforce at route level
@Injectable()
class PermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>('permissions', context.getHandler());
    const userPermissions = context.switchToHttp().getRequest().user.permissions;
    return requiredPermissions.every(p => userPermissions.includes(p));
  }
}
```

## Plugin Security

- permission-based
- capability-based (future)
- Enforcement points:
  - API gateway (route-level)
  - Service layer (method-level)
  - External proxy (plugin outbound calls)

## Global Exception Filter (NEW in v2)

All exceptions are caught by a single filter and transformed to the standard error response format.

```typescript
@Catch()
class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let errorResponse: ErrorResponse;

    if (exception instanceof AppError) {
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          trace_id: request.id,
        },
      };
    } else if (exception instanceof ValidationError) {
      errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: exception.errors,
          trace_id: request.id,
        },
      };
    } else {
      errorResponse = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          trace_id: request.id,
        },
      };
      this.logger.error('Unhandled exception', exception);
    }

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : exception instanceof AppError
        ? exception.httpStatus
        : 500;

    response.status(status).json(errorResponse);
  }
}
```

---

# 21. Caching

## Two-level cache

- L1: in-memory
- L2: Redis

```typescript
@Injectable()
class CacheService {
  async get<T>(key: string): Promise<T | null> {
    const local = this.localCache.get(key);
    if (local) return local;

    const remote = await this.redis.get(key);
    if (remote) {
      this.localCache.set(key, remote);
      return remote;
    }
    return null;
  }
}
```

---

# 22. Search

## Elasticsearch

- sync via event

```
Sync flow: DB → Event → Elasticsearch
product.updated.v1 → SearchConsumer → update ES index
```

---

# 23. Observability (ENHANCED in v2)

## Stack

- **OpenTelemetry** (trace + metrics)
- **Pino** (structured JSON logging)
- **Prometheus** (metrics endpoint)
- `correlation_id` propagated across API → event → worker

## Logging (ENHANCED in v2)

```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level(label) { return { level: label }; },
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

// Every log MUST include request_id / correlation_id
logger.info(
  { request_id: req.id, correlation_id: req.headers['x-correlation-id'] },
  'Processing order creation',
);
```

### PII Redaction

- Authorization headers, cookies, and sensitive fields MUST be redacted in logs
- Use pino `redact` option for automatic redaction

## Metrics (NEW in v2)

### Prometheus Endpoint

```
GET /metrics
```

### Standard Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request latency |
| `http_requests_total` | Counter | `method`, `route`, `status` | Request count |
| `http_errors_total` | Counter | `method`, `route`, `error_code` | Error count |
| `event_published_total` | Counter | `type`, `source` | Events published |
| `event_processing_duration_seconds` | Histogram | `type` | Event processing time |
| `outbox_queue_size` | Gauge | — | Pending outbox entries |
| `job_running_total` | Gauge | `name` | Active background jobs |
| `job_failed_total` | Counter | `name`, `error_code` | Failed job count |

```typescript
import { Counter, Histogram, Gauge } from 'prom-client';

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

const eventPublishedTotal = new Counter({
  name: 'event_published_total',
  help: 'Total events published',
  labelNames: ['type', 'source'],
});
```

## Tracing

- OpenTelemetry SDK auto-instruments HTTP, DB, Redis, RabbitMQ
- Trace context propagated via `traceparent` header
- Custom spans for business-critical operations

```typescript
import { trace } from '@opentelemetry/api';

async createOrder(dto: CreateOrderDto): Promise<Order> {
  const span = trace.getActiveSpan();
  span?.setAttribute('order.total_items', dto.items.length);
  // ... business logic
}
```

## Log Retention (Tiered)

| Tier | Retention | Storage |
|------|-----------|---------|
| Hot | 7-30 days | Fast storage (SSD) |
| Cold | 1-3 years | Slow storage (S3/GCS) |
| Archive | 7+ years | Glacier/cold storage |

---

# 24. Configuration (ENHANCED in v2)

## Layered

1. .env
2. config file
3. database

## Validation (NEW in v2)

- Config MUST be validated at startup (see **ADR-004**)
- Invalid config → application fails to start with clear error message
- Environment variables loaded first, then config file overrides, then database overrides

---

# 25. Feature Flags

## Hybrid

- DB (runtime)
- config fallback

---

# 26. Storage

## Cloud storage (S3)

```typescript
interface StorageService {
  upload(file: Buffer, path: string): Promise<StorageResult>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getSignedUrl(path: string, expires: number): Promise<string>;
}
```

---

# 27. Time Handling

- store UTC
- render user timezone

---

# 28. Delete Strategy

## Module decides

- finance → soft delete
- temp → hard delete

```typescript
interface DeleteStrategy {
  products: 'soft';
  orders: 'soft';
  users: 'soft';
  logs: 'hard';
  temp_data: 'hard';
}
```

---

# 29. Error Model

## Typed errors

- validation
- business
- system
- retryable

```typescript
enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: object,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface TypedError {
  code: ErrorCode;
  message: string;
  details?: object;
  trace_id: string;
}
```

---

# 30. Health Checks

## Liveness Probe

```typescript
@Get('/health/liveness')
async liveness(): Promise<{ status: 'ok' }> {
  return { status: 'ok' };
}
```

## Readiness Probe

```typescript
@Get('/health/readiness')
async readiness(): Promise<{ status: 'ok'; checks: CheckResult[] }> {
  const checks = await Promise.all([
    this.db.ping(),
    this.redis.ping(),
    this.rabbitmq.ping(),
  ]);

  const allOk = checks.every(c => c.ok);
  return {
    status: allOk ? 'ok' : 'degraded',
    checks: checks.map(c => ({ name: c.name, ok: c.ok })),
  };
}
```

---

# 31. Retry Strategy

## Exponential backoff + Dead Letter Queue

```typescript
interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const defaultRetryConfig: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};
```

---

# 32. Outbox Worker (Production Design) (NEW in v2.1)

## Overview

The Outbox Worker is a standalone process that polls the outbox table, publishes events to RabbitMQ, and marks them as processed. It is the critical bridge between the database transaction and the event bus.

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Application    │     │   Outbox Worker  │     │    RabbitMQ      │
│                  │     │                  │     │                  │
│  Service writes  │────▶│  Poll outbox     │────▶│  Publish event   │
│  to outbox (tx)  │ DB  │  (batch)         │     │  to exchange     │
│                  │     │                  │     │                  │
└──────────────────┘     │  Mark processed  │     └──────────────────┘
                         │  (tx)            │
                         └──────────────────┘
```

## Polling Strategy

```typescript
interface OutboxWorkerConfig {
  batchSize: number;           // Max rows per poll (default: 100)
  pollIntervalMs: number;      // Interval between polls (default: 100)
  lockTimeoutMs: number;       // Row lock duration (default: 30_000)
  maxProcessingAgeMs: number;  // Alert if outbox entry unprocessed > this (default: 300_000 = 5 min)
  idlePollIntervalMs: number;  // When no rows found, poll less frequently (default: 1000)
}

const defaultOutboxWorkerConfig: OutboxWorkerConfig = {
  batchSize: 100,
  pollIntervalMs: 100,
  lockTimeoutMs: 30_000,
  maxProcessingAgeMs: 300_000,
  idlePollIntervalMs: 1000,
};
```

### Adaptive Polling

```
While rows found:
  Poll every 100ms (batch of 100)

No rows found (empty poll):
  Back off to 1000ms
  Continue polling

When rows appear again:
  Immediately resume 100ms polling
```

## Locking Strategy

Prevent multiple worker instances from processing the same outbox entry:

```sql
-- Poll query with row-level locking (SKIP LOCKED)
SELECT *
FROM outbox
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

```typescript
// Drizzle query
const pendingEntries = await this.db
  .select()
  .from(outbox)
  .where(eq(outbox.status, 'pending'))
  .orderBy(asc(outbox.createdAt))
  .limit(config.batchSize)
  .for('update', { skipLocked: true }); // PostgreSQL SKIP LOCKED
```

**Why `SKIP LOCKED`?**
- `FOR UPDATE` would block other workers waiting for the same rows
- `SKIP LOCKED` allows other workers to skip locked rows and pick up the next available
- Combined with row-level locking, this guarantees no double-processing

### Lock Ownership

```typescript
// Mark rows as processing with lock owner
await this.db
  .update(outbox)
  .set({
    status: 'processing',
    lockedAt: new Date(),
    lockedBy: workerId, // Unique worker identifier
  })
  .where(inArray(outbox.id, entryIds));
```

## Retry + Exponential Backoff

```typescript
interface OutboxRetryPolicy {
  maxAttempts: number;       // Default: 5
  baseDelayMs: number;       // Default: 1000
  maxDelayMs: number;        // Default: 60_000
  backoffMultiplier: number; // Default: 2
}

// Each failed publish increments attempt count
// On attempt N, delay = min(baseDelay * 2^(N-1), maxDelay)
// Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s, Attempt 4: 8s, Attempt 5: 16s
```

### Retry Flow

```
Outbox entry (status: pending)
  → Worker picks up (FOR UPDATE SKIP LOCKED)
  → Set status = 'processing'
  → Publish to RabbitMQ
    → SUCCESS: Set status = 'processed', processedAt = now()
    → FAILURE:
      → Increment attempts
      → Set nextAttemptAt = now + backoff(attempts)
      → Set status back to 'pending'
      → If attempts >= maxAttempts → Set status = 'failed' (DLQ)
```

## Dead Letter Queue (DLQ)

```typescript
// Outbox entries that exceed maxAttempts go to DLQ
interface OutboxDlqEntry {
  id: string;
  originalEventId: string;
  eventType: string;
  payload: object;
  source: string;
  aggregateId: string;
  failureReason: string;
  attempts: number;
  failedAt: Date;
}

// DLQ stored in separate table: outbox_dlq
export const outboxDlq = pgTable('outbox_dlq', {
  id: uuid('id').defaultRandom().primaryKey(),
  originalEventId: uuid('original_event_id').notNull(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),
  source: text('source').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  failureReason: text('failure_reason').notNull(),
  attempts: integer('attempts').notNull(),
  failedAt: timestamp('failed_at').defaultNow().notNull(),
});
```

### DLQ Rules

- DLQ entries MUST be inspected manually — no auto-retry
- Alert MUST fire when any entry enters DLQ
- DLQ dashboard MUST show entry count, event type, failure reason
- Ops team can manually retry DLQ entries via admin endpoint

## Throughput Control

```typescript
class OutboxWorker {
  private activeEntries = 0;
  private maxConcurrent = 100; // Max entries being published simultaneously

  async pollAndPublish(): Promise<void> {
    if (this.activeEntries >= this.maxConcurrent) {
      return; // Back-pressure: don't fetch more if we're at capacity
    }

    const entries = await this.fetchPendingEntries();
    this.activeEntries += entries.length;

    await Promise.allSettled(
      entries.map(entry => this.processEntry(entry).finally(() => {
        this.activeEntries--;
      })),
    );
  }
}
```

## Monitoring

| Metric | Type | Labels | Alert |
|--------|------|--------|-------|
| `outbox_pending_size` | Gauge | — | > 1000 (worker may be behind) |
| `outbox_processed_total` | Counter | — | — |
| `outbox_failed_total` | Counter | `event_type` | > 0 (immediate) |
| `outbox_dlq_size` | Gauge | — | > 0 (immediate) |
| `outbox_lag_seconds` | Histogram | — | > 5s (event delivery delay) |
| `outbox_publish_duration_seconds` | Histogram | `event_type` | > p99 threshold |
| `outbox_stale_entries` | Gauge | — | Entries unprocessed > maxProcessingAgeMs |
| `outbox_worker_poll_duration_seconds` | Histogram | — | > 1s (DB pressure) |

### Health Check Integration

```typescript
@Get('/health/readiness')
async readiness(): Promise<HealthResponse> {
  const staleEntries = await this.outboxRepo.countStaleEntries(
    Date.now() - this.config.maxProcessingAgeMs,
  );

  return {
    status: staleEntries > 100 ? 'degraded' : 'ok',
    checks: [
      { name: 'database', ok: await this.db.ping() },
      { name: 'redis', ok: await this.redis.ping() },
      { name: 'rabbitmq', ok: await this.rabbitmq.ping() },
      { name: 'outbox_worker', ok: staleEntries === 0, detail: { staleEntries } },
    ],
  };
}
```

## Guarantees

1. **No data loss**: Outbox entry is only marked `processed` after successful RabbitMQ publish
2. **No double-publish**: `FOR UPDATE SKIP LOCKED` prevents two workers from picking the same entry
3. **Ordering preserved**: Outbox entries are polled in `created_at ASC` order
4. **Back-pressure**: Worker does not fetch more entries when at max concurrent capacity
5. **Crash recovery**: `processing` entries with stale `lockedAt` are reset to `pending` on worker startup

---

# 32. Anti-Patterns (STRICTLY FORBIDDEN)

- Plugin access DB directly
- Cross-module import
- Emit event before commit
- Emit event without transaction (ADR-005)
- No idempotency
- No cleanup on unload
- Modify global state
- Side-effect on import
- Access infrastructure configs
- Commit secrets/keys
- Call external services directly (must use proxy)
- Call external services without circuit breaker (v2.1)
- Exceed resource quota
- Bypass hook system
- Start application with invalid config (ADR-004)
- Suppress architecture lint rules (ADR-006)
- Saga step without compensation (v2.1)
- Saga step without timeout (v2.1)
- Deploy without migration rollback test (v2.1)
- Deploy without zero-downtime migration (v2.1)

---

# 33. Checklist for AI Agent / Developer

Before merging code:

- [ ] Interface defined (Service Contract)
- [ ] No direct module import
- [ ] Plugin lifecycle complete (metadata, modules, dispose)
- [ ] Cleanup logic present (dispose)
- [ ] No direct DB access (use service)
- [ ] Version compatibility declared
- [ ] Tests present (at least contract tests)
- [ ] Event format correct (type: `module.action.v{version}`)
- [ ] Event emitted with transaction parameter (ADR-005)
- [ ] Log format correct (JSON, with trace_id)
- [ ] No secrets, .env, infra configs committed
- [ ] Idempotency key for POST operations
- [ ] Event consumer idempotency via processed-event store
- [ ] Optimistic locking for updates
- [ ] Retry + DLQ for async operations
- [ ] Health checks (liveness + readiness)
- [ ] Resource quota limits
- [ ] External calls via proxy with circuit breaker (v2.1)
- [ ] Response follows standard envelope format
- [ ] Config validation schema defined (if adding new config)
- [ ] Plugin permission manifest updated (if adding new permissions)

Before deploying:

- [ ] Database migration is zero-downtime compatible
- [ ] Migration rollback path tested
- [ ] API version compatibility verified (old client + new server)
- [ ] Event version compatibility verified (old consumer + new publisher)
- [ ] Smoke tests pass on new version
- [ ] Health checks include outbox worker stale detection (v2.1)
- [ ] Rollback procedure verified

---

# 34. Core Principles Summary

1. **Loose coupling** - Module/Plugin communicate via interface, not directly
2. **Strong contract** - Version clearly, backward compatible
3. **Isolation by default** - Plugin crash doesn't affect core
4. **Explicit lifecycle** - Install → Activate → Deactivate → Uninstall
5. **Event-driven first** - Use event for inter-module communication
6. **Test-first** - Red → Green → Refactor
7. **Idempotent by design** - Safe to retry
8. **Observable** - Logs, metrics, traces everywhere
9. **Fail-fast** - Invalid config = no startup (v2)
10. **Enforced architecture** - Compile-time + runtime validation (v2)

---

# 35. System Identity

## This system is:

- Modular ERP platform
- Plugin-extensible
- Event-driven (Outbox-based)
- Production-ready
- AI-ready (event stream)

## This system is NOT:

- Event Sourcing system
- Microservices (monolith with plugins)
- Direct cross-module calls

---

# 36. Related Documents

| Document | Status | Purpose |
|----------|--------|---------|
| architecture-v2.1.md | **Canonical** | Source of Truth |
| architecture-v2.md | **Deprecated** | Superseded by v2.1 |
| architecture-v1.md | **Deprecated** | Superseded by v2 |
| architecture-design.md | **Deprecated** | Do not use |
| architecture-design-short.md | **Draft** | Merged into v1 |
| architecture-guidelines.md | Supporting | Implementation details |
| AGENTS.md | Supporting | AI Agent workflow |
| OpenAPI Spec | Contract | API definitions |

---

# 37. Architecture Enforcement (NEW in v2)

## Compile-Time (ESLint)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-cross-module-import` | **error** | Module A cannot import Module B directly |
| `no-outbox-direct-access` | **error** | Only core/outbox module can access outbox table |
| `no-repository-in-plugin` | **error** | Plugin cannot inject repository |
| `no-core-event-from-plugin` | **error** | Plugin cannot emit core domain events |
| `no-infra-config-import` | **error** | Cannot import docker-compose, k8s, terraform configs |

```javascript
// eslint.config.js
module.exports = {
  rules: {
    'erp/no-cross-module-import': 'error',
    'erp/no-outbox-direct-access': 'error',
    'erp/no-repository-in-plugin': 'error',
    'erp/no-core-event-from-plugin': 'error',
  },
};
```

## Runtime (Startup Validation)

```typescript
class ArchitectureValidator {
  async validateOnStartup(): Promise<void> {
    await this.validateDIGraph();      // Circular dependency detection
    await this.validatePluginGuards();  // Permission manifest vs actual usage
    await this.validateServiceInterfaces(); // Interface contracts match implementations
  }

  private async validateDIGraph(): Promise<void> {
    const graph = this.container.getDependencyGraph();
    const cycles = detectCycles(graph);
    if (cycles.length > 0) {
      throw new Error(`Circular dependencies detected: ${cycles.join(', ')}`);
    }
  }
}
```

## CI Enforcement

All architecture rules run in CI as blocking checks:

```yaml
# .github/workflows/ci.yml
jobs:
  architecture-check:
    steps:
      - run: npm run lint          # ESLint rules (compile-time)
      - run: npm run typecheck     # TypeScript strict
      - run: npm run test          # Unit + integration
      - run: npm run lint:spec     # OpenAPI spec validation
```

---

# 38. Production Hardening Checklist (v2 + v2.1)

### Core

- [ ] Config validation (ADR-004) — fails fast on invalid config
- [ ] Auth (JWT RS256 + token revocation)
- [ ] EventBus enforcement (ADR-005) — emit requires tx
- [ ] Global exception filter (Section 20)

### Infrastructure

- [ ] Outbox worker: retry + exponential backoff + DLQ (Section 32)
- [ ] Outbox worker: `SKIP LOCKED` polling + adaptive polling (Section 32)
- [ ] Outbox worker: stale entry detection in readiness probe (Section 32)
- [ ] Idempotency: API (Redis) + Event consumer (processed-event store)
- [ ] BullMQ: per-job concurrency limits

### Resilience (NEW in v2.1)

- [ ] Circuit breaker on all external services (Section 15)
- [ ] Circuit breaker fallback defined per external service
- [ ] Circuit breaker metrics + alerts

### Event Processing (NEW in v2.1)

- [ ] At-least-once delivery with consumer-side deduplication
- [ ] Sequential processing per aggregate_id
- [ ] Consumer double-check dedup within transaction
- [ ] DLQ monitoring + alerting

### Saga (NEW in v2.1)

- [ ] Saga orchestrator with state machine
- [ ] Per-step timeout + retry config
- [ ] Compensation in reverse order
- [ ] Crash recovery on startup
- [ ] Saga state persistence
- [ ] Saga monitoring + alerts

### Observability

- [ ] Structured logging (pino) with request_id, correlation_id
- [ ] PII redaction in logs
- [ ] Prometheus /metrics endpoint
- [ ] OpenTelemetry tracing (HTTP, DB, Redis, RabbitMQ)

### Security

- [ ] JWT RS256 + refresh token rotation + revocation
- [ ] RBAC + permissions guards
- [ ] Rate limiting (Redis)
- [ ] Security headers (helmet)
- [ ] Plugin permission manifest validation
- [ ] Plugin resource quota enforcement

### Architecture

- [ ] ESLint architecture rules in CI (ADR-006)
- [ ] DI graph validation on startup
- [ ] Zero-downtime migration strategy (Section 5)
- [ ] Health checks (liveness + readiness)

### Deployment (NEW in v2.1)

- [ ] Blue/green deployment configured
- [ ] Migration coordination with deployment (migrate first, then deploy)
- [ ] Rollback procedure tested (automatic triggers)
- [ ] Event version compatibility verified
- [ ] API version compatibility verified
- [ ] Smoke tests automated

---

# 39. v1 → v2 Changelog

## Added (NEW in v2)

| Section | What | Source |
|---------|------|--------|
| ADR-004 | Config validation (zod) + fail-fast | target-2 |
| ADR-005 | EventBus `emit(event, tx)` enforcement | target-2 |
| ADR-006 | Architecture enforcement (ESLint + runtime) | target-2 |
| ADR-007 | Drizzle ORM | target-2 |
| Section 5 | Zero-downtime migration strategy | target-2 |
| Section 11 | Dual idempotency (API Redis + processed-event store) | target-2 |
| Section 12 | Plugin permission manifest | target-2 |
| Section 17 | BullMQ per-job concurrency control | target-2 |
| Section 18 | Global ValidationPipe (whitelist + transform) | target-2 |
| Section 18 | Security headers (helmet) | target-2 |
| Section 20 | JWT RS256 + token revocation | target-2 |
| Section 20 | RBAC + @Permissions decorator | target-2 |
| Section 20 | Global exception filter | target-2 |
| Section 23 | Pino structured logging + PII redaction | target-2 |
| Section 23 | Prometheus /metrics endpoint + standard metrics | target-2 |
| Section 23 | OpenTelemetry auto-instrumentation details | target-2 |
| Section 29 | AppError class with httpStatus + retryable | target-2 |
| Section 37 | Architecture enforcement (full catalog) | target-2 |
| Section 38 | Production hardening checklist | target-2 |

## Changed (v2)

| Section | Change |
|---------|--------|
| Section 1 | Added principles 7-8 |
| Section 3 | Core responsibility now includes "Architecture Enforcement" |
| Section 5 | Drizzle ORM as official ORM (ADR-007), schema examples, drizzle-kit migrations |
| Section 7 | Now references ADR-005 enforcement |
| Section 12 | PluginMetadata now includes `permissions` field |
| Section 14 | activate stage now includes permission validation |
| Section 23 | Expanded from 3 lines to full observability stack |
| Section 32 | Added 3 new anti-patterns |
| Section 36 | v2 is now canonical, v1 deprecated |

## NOT Changed (Preserved from v1)

All v1 content preserved as-is unless explicitly enhanced above. Key preserved decisions:
- ADR-001: Outbox + Audit Log (no Event Sourcing)
- ADR-002: Event Schema with top-level `aggregate_id`
- ADR-003: Tiered log retention
- Section 16: Hook System
- Section 18: Response Standard (full envelope with timestamp, version, request_id)
- Section 19: Read Model Strategy
- All Anti-Patterns from v1

## Rejected from target-2

| Item | Reason |
|------|--------|
| Simplified response format | Violates v1 enforced response standard |
| VM/process sandbox for plugins | Conflicts with v1 Phase 1 (same process) |
| Event schema without aggregate_id | Violates ADR-002 |
| Module structure (schema.ts) | Conflicts with AGENTS.md structure (entities/, dto/) |

---

# 40. v2 → v2.1 Changelog

## Critical Fixes (NEW in v2.1)

| Section | What | Why |
|---------|------|-----|
| Section 10 | **Full Saga Orchestration** — state machine, orchestrator, crash recovery, persistence schema, monitoring | Saga was incomplete — no orchestrator, no recovery, no guarantees |
| Section 13 | **Plugin Isolation Evolution** — 3-phase strategy, IPC protocol, crash isolation, migration path | Phase 2 was "TODO" — dangerous without clear evolution path |
| Section 15 | **Circuit Breaker** — state machine, config, implementation, timeout/retry interaction, fallback strategy | No protection against cascading external service failure |
| Section 6 | **Event Processing Guarantees** — exact processing flow, deduplication strategy, ordering, failure scenarios, worker restart | At-least-once delivery was defined but consumer-side guarantees were missing |
| Section 32 | **Outbox Worker (Production Design)** — polling, SKIP LOCKED, retry/backoff, DLQ, throughput control, monitoring | Outbox worker behavior was not fully specified |
| Section 32.5 | **Deployment & Rollout Strategy** — blue/green, migration coordination, version compatibility, rollback triggers, checklists | No deployment model defined |

## Changed (v2.1)

| Section | Change |
|---------|--------|
| Header | Version 2.0 → 2.1, supersedes v2.md |
| Section 32 | Added 6 new anti-patterns |
| Section 33 | Split into "Before merging" + "Before deploying" checklists |
| Section 36 | v2.1 is now canonical, v2 deprecated |
| Section 38 | Added Resilience, Event Processing, Saga, Deployment subsections |

## Preserved from v2

All v2 content preserved as-is. No stable sections modified. Only additions and the 6 targeted critical fixes above.

## Design Principles for v2.1

1. **No stable section modified** — only additions and targeted critical enhancements
2. **Every critical system has**: guarantees, failure handling, enforcement
3. **No ambiguity** — all retry/timeout/recovery behavior is explicitly defined
4. **Implementation-ready** — all interfaces, schemas, and configurations are defined
5. **No TODOs** — every referenced component is fully specified
