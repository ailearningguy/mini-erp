# ERP Architecture v1 (Canonical)

**Version:** 1.1  
**Date:** 2026-03-31  
**Status:** Canonical Source of Truth  
**Supersedes:** architecture-design.md (deprecated), architecture-design-short.md (draft)

---

# 1. Core Principles

1. **Module-owned data**
2. **Plugin = extension, not core**
3. **Event-driven (Outbox), NOT Event Sourcing**
4. **Strong contracts (versioned)**
5. **Isolation by default (plugin + runtime)**
6. **Idempotent & retry-safe**

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
| Core | DI, Plugin Loader, Event Bus, Config, Security |
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

## Core

Manages:
- connection pool
- transaction context

## Module

Defines:
- entities
- repositories
- queries

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

### Rules

- All schema changes MUST be versioned migrations
- Migrations MUST be reversible (rollback supported)
- Plugin migrations tied to lifecycle (run on install, revert on uninstall)
- Migrations placed in `database/migrations/`

### Migration Lifecycle

```
Plugin Install  → Run UP migrations
Plugin Uninstall → Run DOWN migrations (optional, configurable)
```

### Naming Convention

```
{timestamp}_{module}_{description}.migration.ts

Example:
20260331_001_product_create_products_table.migration.ts
20260331_002_product_add_variant_column.migration.ts
```

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
  const processed = await this.processedStore.has(event.id);
  if (processed) return;

  await this.handleBusinessLogic(event);
  await this.processedStore.mark(event.id);
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

# 7. Transaction Rules (STRICT)

> See **Section 6 (Event Architecture → Flow)** for transaction flow diagram.

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

# 10. Saga & Compensation

## Use for cross-module flows

Example:
```
Order →
  reserve inventory →
  charge payment →
  create order
```

On failure:
```
compensation:
  refund →
  release inventory →
  cancel order
```

```typescript
interface SagaStep {
  execute(): Promise<void>;
  compensate(): Promise<void>;
}

interface SagaState {
  sagaId: string;
  currentStep: number;
  status: 'running' | 'completed' | 'compensating' | 'failed';
  completedSteps: string[];
  startedAt: Date;
  updatedAt: Date;
}
```

### Saga Persistence

- Saga state MUST be persisted to database
- On system restart, incomplete sagas MUST be recovered and resumed or compensated
- Saga state table enables crash recovery and monitoring

---

# 11. Idempotency (MANDATORY)

## Applies to

- API (POST/PUT)
- Event consumer
- Background job

## Mechanism

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
}
```

## Lifecycle Mapping

| Stage | Required |
|-------|----------|
| install | optional |
| activate | required |
| deactivate | required |
| uninstall | optional |
| dispose | **MANDATORY** |

## Rules

Plugin:
- ❌ no DB access
- ❌ no internal API access
- ❌ no side effects on import
- ❌ no global state mutation
- ✅ use: service interfaces, event bus

---

# 13. Plugin Isolation

## Phase 1 (Current)

- same process
- enforced:
  - timeout
  - resource quota

```typescript
interface PluginResourceQuota {
  memory: '512MB' | '1GB' | '2GB';
  cpu: '0.5' | '1' | '2';
  requestsPerMinute: number;
  maxConnections: number;
}
```

## Phase 2 (Roadmap)

- isolated runtime:
  - worker thread / process

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

# 15. External Integration

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

```typescript
class ExternalServiceProxy {
  async call(plugin: IPlugin, target: string, request: Request): Promise<Response> {
    this.validatePermission(plugin, target);
    await this.audit.log(plugin.name, target);
    return this.httpClient.request(target, request, { timeout: 30000 });
  }
}
```

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

## Auth

- JWT + Refresh
- OTP for sensitive actions

## Authorization

- RBAC (phase 1)
- extensible to ABAC

## Plugin Security

- permission-based
- capability-based (future)
- Enforcement points:
  - API gateway (route-level)
  - Service layer (method-level)
  - External proxy (plugin outbound calls)

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

# 23. Observability

## Stack

- OpenTelemetry (trace)
- JSON logs
- correlation_id

## Log Retention (Tiered)

| Tier | Retention | Storage |
|------|-----------|---------|
| Hot | 7-30 days | Fast storage (SSD) |
| Cold | 1-3 years | Slow storage (S3/GCS) |
| Archive | 7+ years | Glacier/cold storage |

---

# 24. Configuration

## Layered

1. .env
2. config file
3. database

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
```

---

# 32. Anti-Patterns (STRICTLY FORBIDDEN)

- Plugin access DB directly
- Cross-module import
- Emit event before commit
- No idempotency
- No cleanup on unload
- Modify global state
- Side-effect on import
- Access infrastructure configs
- Commit secrets/keys
- Call external services directly (must use proxy)
- Exceed resource quota
- Bypass hook system

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
- [ ] Log format correct (JSON, with trace_id)
- [ ] No secrets, .env, infra configs committed
- [ ] Idempotency key for POST operations
- [ ] Optimistic locking for updates
- [ ] Retry + DLQ for async operations
- [ ] Health checks (liveness + readiness)
- [ ] Resource quota limits
- [ ] External calls via proxy
- [ ] Response follows standard envelope format

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
| architecture-v1.md | **Canonical** | Source of Truth |
| architecture-design.md | **Deprecated** | Do not use |
| architecture-design-short.md | **Draft** | Merged into v1 |
| architecture-guidelines.md | Supporting | Implementation details |
| AGENTS.md | Supporting | AI Agent workflow |
| OpenAPI Spec | Contract | API definitions |

---

**END OF DOCUMENT**