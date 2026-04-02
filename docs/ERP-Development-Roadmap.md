# ERP Development Roadmap v2.0

**Version:** 2.0
**Date:** 2026-04-02
**Status:** Active — single source of truth
**Supersedes:** v1.0 (2026-04-01)

**Goal:** Build a governed extension platform with Capability Governance, achieving Production Readiness through validated, incremental phases.

---

# Current State Assessment

## ✅ Completed (Foundation)

| Work | Evidence |
|------|----------|
| Phase 0: Bug fixes | EventRateLimiter fix, ArchitectureValidator wiring, IPlugin refactor, Saga wiring |
| Phase 1: BullMQ + Metrics | QueueManager with pause/resume, GET /metrics Prometheus endpoint |
| Phase 2: Core Infrastructure | IModule interface, ResettableContainer (build/dispose/rebuild), FsModuleRegistry (scan + topo sort), module.json manifests |
| Phase 3: Traffic Control + Soft Restart | TrafficGate, RequestTracker, AMQP consumer pause/resume, SoftRestartManager orchestration |
| Phase 4: Module Management | ModuleInstaller, REST endpoints (GET/POST /modules), EventSchemaRegistry cleanup |
| Phase 5: Production Hardening | Container event cleanup, OpenAPI spec update, E2E restart test |

**What this means:** The system now supports runtime-rebuildable modules with soft restart. ModuleRegistry discovers modules from filesystem. ResettableContainer can build/dispose/rebuild DI graph without process restart. Traffic is gated during restart.

## ❌ Not Yet Built

| Capability | Required For |
|------------|-------------|
| ModuleFactory | Standardized module entry, provider exports |
| Hook System | Plugin extension points, pre/post hooks |
| Capability System | Capability-driven pipelines (pricing, checkout) |
| Capability Governance | Versioning, compatibility, conflict resolution |
| Multi-module business flows | Order + Inventory modules |
| Production deployment | CI/CD, Docker, monitoring |

---

# Phase Overview

```
Phase 6:  ModuleFactory + Module Contracts
Phase 7:  Hook System (Extension Points)
Phase 8:  Business Expansion (Order + Inventory)
Phase 9:  Capability System (Pipeline Architecture)
Phase 10: Capability Governance (Versioning + Compatibility)
Phase 11: Production Readiness (Deploy + Monitor)
```

---

# Phase 6 — ModuleFactory + Module Contracts

## Objective

Standardize how modules declare themselves, register providers, and expose service contracts. Replace manual `main.ts` wiring with declarative module definitions.

## Scope

### ModuleFactory Interface

```typescript
interface ModuleFactory {
  create(container: DIContainer): Promise<ModuleDefinition>;
}

interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];           // Public service contract tokens
  hooks?: HookRegistration[];   // Pre-registered hooks (Phase 7 dep)
}
```

### Module Contract Enforcement

- Module MUST export at least one service interface
- Exported tokens validated against naming convention (`I*Service`)
- Dependencies resolved via DI — no direct cross-module imports

### Refactor Existing Modules

- ProductModule: expose `IProductService` via exports
- OrderModule: expose `IOrderService` via exports

## Required Tests

- ModuleFactory creates valid ModuleDefinition
- Exported tokens are resolvable from container
- Cross-module access only through exported interfaces

## Exit Criteria

- All modules use ModuleFactory pattern
- No manual wiring in `main.ts` for module instantiation
- Module contracts enforced at build time

---

# Phase 7 — Hook System (Extension Points)

## Objective

Implement the Hook System specified in Architecture v2.2 §16. Enable plugins to intercept module flows with deterministic execution order, timeout guards, and fail-safe semantics.

## Scope

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `HookRegistry` | `core/hooks/hook-registry.ts` | Store + retrieve hooks by point name |
| `HookExecutor` | `core/hooks/hook-executor.ts` | Execute hooks with priority, timeout, fail-safe |
| `HookContext` | `core/hooks/types.ts` | Data carrier between hooks |
| `HookPoint` | `core/hooks/types.ts` | Named extension point with config |

### Hook Registration (from ModuleFactory)

```typescript
interface HookRegistration {
  point: string;           // "order.beforeCreate"
  phase: 'pre' | 'post';
  handler: HookHandler;
  plugin?: string;
  module?: string;
  priority?: number;       // lower = earlier, default: 100
  timeout?: number;        // default: 5000ms
  failSafe?: boolean;      // default: true
}
```

### Hook Execution Engine

Per Architecture v2.2 §16:
- Sort by priority (ascending)
- Execute with timeout per handler
- Fail-safe: log error + continue (unless `failSafe: false`)
- Pre-hooks can reject (abort flow)
- Post-hooks cannot reject (log only)

### Integration with Container

- `build()`: register hooks from ModuleDefinition
- `dispose()`: clear hooks by module name

## Required Tests

- Hook executes in priority order
- Timeout triggers correctly
- Fail-safe continues on error
- Non-fail-safe hook throws aborts flow
- Dispose clears module hooks

## Exit Criteria

- Hook System implemented per Architecture v2.2 §16
- ModuleFactory can declare hooks
- Hooks cleaned up on module unload

---

# Phase 8 — Business Expansion (Order + Inventory)

## Objective

Build real multi-module flows that exercise Hook System, cross-module communication, and saga orchestration.

## Scope

### Order Module

- Order schema (Drizzle)
- CRUD service
- Order saga: Create Order → Reserve Inventory → Charge Payment → Confirm Order
- Events: `order.created.v1`, `order.confirmed.v1`, `order.cancelled.v1`

### Inventory Module

- Inventory schema (Drizzle)
- Stock reservation service
- Events: `inventory.reserved.v1`, `inventory.released.v1`

### Hook Integration

- `order.beforeCreate`: voucher validation hook
- `order.afterCreate`: notification hook
- `inventory.beforeReserve`: stock check hook

### Cross-Module Flow

```
POST /api/v1/orders
  → OrderService.create()
    → Hook: order.beforeCreate (voucher, inventory)
    → Saga: reserveInventory → chargePayment → confirmOrder
    → Hook: order.afterCreate (notification)
  → Response
```

## Required Tests

- End-to-end order creation with real saga
- Hook execution in order flow
- Saga compensation on payment failure
- Cross-module event flow

## Exit Criteria

- Order + Inventory modules working end-to-end
- Hooks integrated in business flows
- Saga handles failure scenarios

---

# Phase 9 — Capability System (Pipeline Architecture)

## Objective

Implement capability-driven pipelines for business-critical flows (pricing, checkout, payment). Replace free-form hooks with structured, deterministic capability pipelines.

## Scope

### Capability Types

```typescript
interface Capability {
  name: string;              // "pricing"
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];         // For pipeline: ['base', 'discount', 'tax', 'final']
}
```

### Capability Handler

```typescript
interface CapabilityHandler {
  capability: string;        // "pricing"
  stage?: string;            // "discount"
  priority?: number;
  exclusive?: boolean;       // Only one handler per stage
  condition?: (ctx: CapabilityContext) => boolean;
  handle(ctx: CapabilityContext): Promise<void>;
}
```

### Capability Registry

- Register capability definitions
- Register handlers per capability + stage
- Validate conflicts at build time

### Pipeline Execution Engine

```
pricing pipeline:
  base_price → discount → tax → rounding → final_price
```

### Conflict Resolution (Build-Time)

| Conflict | Detection | Resolution |
|----------|-----------|------------|
| Multiple exclusive handlers | build-time | fail |
| Invalid stage | build-time | fail |
| Ordering conflict | topo sort | resolve |
| Priority conflict | priority sort | resolve |

### Capability vs Hook Decision

| Use Capability | Use Hook |
|----------------|----------|
| Pricing | Logging |
| Checkout flow | Analytics |
| Payment processing | Simple event |
| Inventory allocation | Cache invalidation |

## Required Tests

- Pipeline executes stages in order
- Exclusive handler blocks others
- Invalid stage rejected at build
- Composable handlers run in parallel
- Single handler enforces exactly one

## Exit Criteria

- Capability Registry implemented
- Pricing pipeline working end-to-end
- Checkout pipeline working end-to-end
- Conflict detection at build time

---

# Phase 10 — Capability Governance (Versioning + Compatibility)

## Objective

Add versioning, compatibility checking, and deprecation lifecycle to capabilities. Enable safe evolution of capability contracts across plugin ecosystem.

## Scope

### Capability Contract (Versioned)

```typescript
interface CapabilityContract {
  name: string;              // "pricing"
  version: string;           // semver: "1.2.0"
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
  inputSchema?: ZodSchema;
  outputSchema?: ZodSchema;
  compatibility: {
    backwardCompatible: boolean;
  };
  deprecated?: boolean;
  sunsetDate?: string;
}
```

### Capability Requirement (Plugin Declares)

```typescript
interface CapabilityRequirement {
  name: string;              // "pricing"
  versionRange: string;      // "^1.1.0"
  mode: 'required' | 'optional';
}
```

### Version Resolution

- Semver satisfaction check at build time
- Handler `supportedVersion` must satisfy contract version
- Backward-compatible flag determines if old handlers work on new contracts

### Compatibility Matrix

| Case | Allowed |
|------|---------|
| Handler v1 → Contract v2 (backwardCompatible=true) | ✅ |
| Handler v1 → Contract v2 (backwardCompatible=false) | ❌ |
| Handler v2 → Contract v1 | ❌ |

### Deprecation Lifecycle

```
1. Contract marked deprecated (warn at build)
2. Sunset date set (warn + log)
3. After sunset date (fail at build)
4. Contract removed
```

### Observability

```
capability_conflict_total
capability_version_mismatch_total
capability_execution_latency_seconds
```

## Required Tests

- Version mismatch detected at build
- Backward-compatible handler accepted
- Non-backward-compatible handler rejected
- Deprecation warning emitted
- Post-sunset contract rejected

## Exit Criteria

- Capability contracts are versioned
- Plugin compatibility validated at build
- Deprecation lifecycle enforced
- Version metrics tracked

---

# Phase 11 — Production Readiness

## Objective

Deploy the system with full observability, CI/CD, Docker, monitoring, and load testing.

## Scope

### CI/CD Pipeline

- GitHub Actions workflow
- Lint → Test → Build → Deploy
- Migration linter (ADR-009)
- Architecture validation

### Docker

- Multi-stage build
- Docker Compose for local dev (PostgreSQL, Redis, RabbitMQ)
- Health checks

### Monitoring

- Prometheus metrics endpoint (done in Phase 1)
- Grafana dashboards
- Loki for structured logs
- Alert rules:
  - Error rate > 5% → alert
  - Restart failed → alert
  - Circuit breaker OPEN → alert

### Load Testing

- k6 or Artillery scripts
- Target: 1000 req/s sustained
- Verify: no memory leak, stable latency

### Security

- JWT RS256 (done)
- RBAC (done)
- Rate limiting (done)
- Helmet headers (done)
- Dependency vulnerability scanning

### Deployment

- Blue/Green deployment per Architecture v2.2 §32.5
- Automated rollback on health check failure
- Zero-downtime migrations (ADR-009 enforced)

## Exit Criteria

- CI/CD pipeline green
- Docker image builds and runs
- Monitoring dashboards operational
- Load test passes 1000 req/s
- Blue/Green deployment tested
- Rollback tested and verified

---

# Summary

```
✅ Done:   Phase 0-5   (Foundation: soft restart, module management)
🔨 Next:   Phase 6     (ModuleFactory + contracts)
🔨 Next:   Phase 7     (Hook System)
🔨 Next:   Phase 8     (Business expansion: Order + Inventory)
🔨 Next:   Phase 9     (Capability System)
🔨 Next:   Phase 10    (Capability Governance)
🔨 Next:   Phase 11    (Production Readiness)
```

# Key Principles

1. **Validate by real flow, not by components**
2. **Only build infrastructure when a use-case forces it**
3. **Prefer working system over perfect architecture**
4. **End-to-end correctness > local correctness**
5. **Capability Governance = governed extension platform (not plugin chaos)**

---

> A working system with fewer features is always better than a complete architecture that has never run end-to-end.
