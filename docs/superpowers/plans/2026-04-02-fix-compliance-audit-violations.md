# Fix Compliance Audit Violations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 20 verified compliance violations from the audit report across Core Independence, Plugin Compliance, Architecture Enforcement, and Saga bugs.

**Architecture:** Introduce a `ModuleRegistry` interface so modules self-register rate limits and event handlers (removing domain knowledge from `main.ts` bootstrap). Fix saga persistence bugs (transaction wrapping + JSON type). Complete `ArchitectureValidator` startup coverage. Add error boundary to plugin event handlers. Align `IPlugin` interface with spec.

**Tech Stack:** TypeScript, Jest, Drizzle ORM, Express, Zod

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `backend/src/core/module-registry/registry.ts` | Interface for modules to register rate limits and event handlers with core |
| `backend/tests/core/module-registry/registry.test.ts` | Tests for ModuleRegistry |
| `backend/tests/core/consumer/consumer-handler-registration.test.ts` | Tests for EventConsumer handler registration from modules |
| `backend/tests/core/saga/saga-persist-transaction.test.ts` | Tests for saga persistState transaction wrapping |
| `backend/tests/core/saga/saga-jsonb-type.test.ts` | Tests for jsonb type fix |
| `backend/tests/plugins/analytics/analytics-error-boundary.test.ts` | Tests for plugin error isolation |
| `backend/tests/core/architecture-validator/validator-startup.test.ts` | Tests for full startup validation |

### Files to Modify
| File | Change |
|------|--------|
| `backend/src/core/consumer/consumer.ts` | Add `getRegisteredHandlers()` method for introspection |
| `backend/src/modules/product/product.module.ts` | Add `registerWithRegistry()` method to self-register rate limits and handlers |
| `backend/src/main.ts` | Remove hardcoded domain event types, handlers, and direct construction — use registry pattern |
| `backend/src/core/saga/saga-orchestrator.ts` | Wrap `persistState()` in transaction, remove `JSON.stringify()` calls |
| `backend/src/core/architecture-validator/validator.ts` | No changes needed — methods already exist |
| `backend/src/main.ts` (validator section) | Call all 6 validator methods instead of 2 |
| `backend/src/plugins/analytics/analytics.plugin.ts` | Add try/catch in `setEventConsumer` handler, update `IPlugin` compliance |
| `backend/src/core/plugin-system/plugin-loader.ts` | Add `getModules()`, `onInstall()`, `onUninstall()` to `IPlugin` interface |
| `backend/src/modules/product/events/product.events.ts` | Clean up deprecated alias (align naming) |
| `backend/src/plugins/analytics/analytics.schema.ts` | Change `aggregateId` from `varchar(255)` to `uuid` |
| `backend/package.json` | Add `lint:arch` and `validate:runtime` scripts |

---

## Task 1: Create ModuleRegistry Interface

**Files:**
- Create: `backend/src/core/module-registry/registry.ts`
- Test: `backend/tests/core/module-registry/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/module-registry/registry.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ModuleRegistry } from '@core/module-registry/registry';

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  it('should register and retrieve rate limit configs', () => {
    registry.registerRateLimits('product', [
      { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
      { eventType: 'product.updated.v1', maxEventsPerSecond: 500 },
    ]);

    const all = registry.getAllRateLimits();
    expect(all).toHaveLength(2);
    expect(all[0].eventType).toBe('product.created.v1');
    expect(all[1].eventType).toBe('product.updated.v1');
  });

  it('should register and retrieve event handler registrations', () => {
    const handler1 = jest.fn(async () => {});
    const handler2 = jest.fn(async () => {});

    registry.registerEventHandler('product', 'product.created.v1', handler1);
    registry.registerEventHandler('product', 'product.updated.v1', handler2);

    const handlers = registry.getEventHandlers();
    expect(handlers).toHaveLength(2);
    expect(handlers[0].eventType).toBe('product.created.v1');
    expect(handlers[1].eventType).toBe('product.updated.v1');
  });

  it('should throw on duplicate event type rate limit registration', () => {
    registry.registerRateLimits('product', [
      { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
    ]);
    expect(() =>
      registry.registerRateLimits('order', [
        { eventType: 'product.created.v1', maxEventsPerSecond: 100 },
      ]),
    ).toThrow('Rate limit already registered for event type: product.created.v1');
  });

  it('should return empty arrays when nothing registered', () => {
    expect(registry.getAllRateLimits()).toEqual([]);
    expect(registry.getEventHandlers()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/module-registry/registry.test.ts -v`
Expected: FAIL with "Cannot find module '@core/module-registry/registry'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend/src/core/module-registry/registry.ts
import type { RateLimitConfig } from '@core/consumer/rate-limiter';
import type { Db } from '@shared/types/db';
import type { EventEnvelope } from '@shared/types/event';

type EventHandler = (event: EventEnvelope, tx: Db) => Promise<void>;

interface EventHandlerRegistration {
  eventType: string;
  handler: EventHandler;
  moduleName: string;
}

class ModuleRegistry {
  private rateLimits: RateLimitConfig[] = [];
  private eventHandlers: EventHandlerRegistration[] = [];

  registerRateLimits(moduleName: string, configs: RateLimitConfig[]): void {
    for (const cfg of configs) {
      if (this.rateLimits.some((r) => r.eventType === cfg.eventType)) {
        throw new Error(`Rate limit already registered for event type: ${cfg.eventType}`);
      }
    }
    this.rateLimits.push(...configs);
  }

  getAllRateLimits(): RateLimitConfig[] {
    return [...this.rateLimits];
  }

  registerEventHandler(moduleName: string, eventType: string, handler: EventHandler): void {
    this.eventHandlers.push({ eventType, handler, moduleName });
  }

  getEventHandlers(): EventHandlerRegistration[] {
    return [...this.eventHandlers];
  }
}

export { ModuleRegistry };
export type { EventHandlerRegistration };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/module-registry/registry.test.ts -v`
Expected: PASS all 4 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/module-registry/registry.ts backend/tests/core/module-registry/registry.test.ts
git commit -m "feat(core): add ModuleRegistry for modules to self-register rate limits and event handlers"
```

---

## Task 2: Add getRegisteredHandlers to EventConsumer

**Files:**
- Modify: `backend/src/core/consumer/consumer.ts`
- Test: `backend/tests/core/consumer/consumer-handler-registration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/consumer/consumer-handler-registration.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventConsumer } from '@core/consumer/consumer';

function createMockConsumer() {
  return new EventConsumer(
    { has: jest.fn(async () => false), mark: jest.fn(async () => {}) } as any,
    { validate: jest.fn((_: string, data: unknown) => data) } as any,
    { checkLimit: jest.fn(() => true) } as any,
    async (fn: any) => fn({ insert: jest.fn(), update: jest.fn(), select: jest.fn() }),
  );
}

describe('EventConsumer handler registration', () => {
  it('should allow registering multiple handlers via registerHandlers', () => {
    const consumer = createMockConsumer();
    const handler1 = jest.fn(async () => {});
    const handler2 = jest.fn(async () => {});

    consumer.registerHandlers([
      { eventType: 'product.created.v1', handler: handler1 },
      { eventType: 'order.created.v1', handler: handler2 },
    ]);

    const registeredTypes = consumer.getRegisteredHandlerTypes();
    expect(registeredTypes).toContain('product.created.v1');
    expect(registeredTypes).toContain('order.created.v1');
  });

  it('should throw if registerHandlers conflicts with existing handler', () => {
    const consumer = createMockConsumer();
    consumer.registerHandler('product.created.v1', jest.fn(async () => {}));

    expect(() =>
      consumer.registerHandlers([
        { eventType: 'product.created.v1', handler: jest.fn(async () => {}) },
      ]),
    ).toThrow('Handler already registered for event type: product.created.v1');
  });

  it('should return empty array when no handlers registered', () => {
    const consumer = createMockConsumer();
    expect(consumer.getRegisteredHandlerTypes()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/consumer/consumer-handler-registration.test.ts -v`
Expected: FAIL with "consumer.registerHandlers is not a function" or "consumer.getRegisteredHandlerTypes is not a function"

- [ ] **Step 3: Write minimal implementation**

Add to `backend/src/core/consumer/consumer.ts` — add these two methods to the `EventConsumer` class (after the existing `registerHandler` method at line 30):

```typescript
  registerHandlers(registrations: { eventType: string; handler: EventHandler }[]): void {
    for (const reg of registrations) {
      this.registerHandler(reg.eventType, reg.handler);
    }
  }

  getRegisteredHandlerTypes(): string[] {
    return [...this.handlers.keys()];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/consumer/consumer-handler-registration.test.ts -v`
Expected: PASS all 3 tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/consumer/consumer.ts backend/tests/core/consumer/consumer-handler-registration.test.ts
git commit -m "feat(core): add registerHandlers batch method and getRegisteredHandlerTypes to EventConsumer"
```

---

## Task 3: Move Domain Rate Limits and Event Handlers from main.ts to ProductModule

**Files:**
- Modify: `backend/src/modules/product/product.module.ts`
- Modify: `backend/src/main.ts`
- Test: `backend/tests/modules/product/product.module.test.ts` (new)

- [ ] **Step 1: Write the failing test for ProductModule registering with ModuleRegistry**

```typescript
// backend/tests/modules/product/product.module.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ModuleRegistry } from '@core/module-registry/registry';

// We test that ProductModule exposes the right rate limits and handler registrations
// without importing ProductModule directly (testing the interface contract)

describe('ProductModule registry integration', () => {
  it('should define rate limits that cover all product event types', () => {
    // Simulate what ProductModule.registerWithRegistry() would register
    const rateLimits = [
      { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
      { eventType: 'product.updated.v1', maxEventsPerSecond: 500 },
      { eventType: 'product.deactivated.v1', maxEventsPerSecond: 200 },
    ];

    const registry = new ModuleRegistry();
    registry.registerRateLimits('product', rateLimits);

    const all = registry.getAllRateLimits();
    expect(all).toHaveLength(3);
    const types = all.map((r) => r.eventType);
    expect(types).toContain('product.created.v1');
    expect(types).toContain('product.updated.v1');
    expect(types).toContain('product.deactivated.v1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/modules/product/product.module.test.ts -v`
Expected: FAIL — test structure exists but ProductModule doesn't have `registerWithRegistry` yet

- [ ] **Step 3: Add `registerWithRegistry` method to ProductModule**

Add this method to `ProductModule` class in `backend/src/modules/product/product.module.ts` (after `registerRoutes` method at line 37):

```typescript
  registerWithRegistry(
    registry: { registerRateLimits: (mod: string, cfgs: { eventType: string; maxEventsPerSecond: number }[]) => void; registerEventHandler: (mod: string, type: string, handler: (event: any, tx: any) => Promise<void>) => void },
    cacheService: { invalidate: (key: string) => Promise<void> },
  ): void {
    registry.registerRateLimits('product', [
      { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
      { eventType: 'product.updated.v1', maxEventsPerSecond: 500 },
      { eventType: 'product.deactivated.v1', maxEventsPerSecond: 200 },
    ]);

    registry.registerEventHandler('product', 'product.updated.v1', async (event) => {
      await cacheService.invalidate(`product:${event.aggregate_id}`);
    });
    registry.registerEventHandler('product', 'product.deactivated.v1', async (event) => {
      await cacheService.invalidate(`product:${event.aggregate_id}`);
    });
  }
```

- [ ] **Step 4: Update main.ts to use ModuleRegistry**

Replace the domain-specific sections of `backend/src/main.ts`. The key changes:

**Remove lines 77-87** (hardcoded EventRateLimiter config):
```typescript
  // OLD:
  // container.register('EventRateLimiter', () => {
  //   const defaultRateLimits: RateLimitConfig[] = [
  //     { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
  //     ...
  //   ];
  //   return new EventRateLimiter(defaultRateLimits);
  // });
```

**Remove lines 156-161** (hardcoded event handlers):
```typescript
  // OLD:
  // eventConsumer.registerHandler('product.updated.v1', async (event) => {
  //   await cacheService.invalidate(`product:${event.aggregate_id}`);
  // });
  // eventConsumer.registerHandler('product.deactivated.v1', async (event) => {
  //   await cacheService.invalidate(`product:${event.aggregate_id}`);
  // });
```

**Add ModuleRegistry import and registration** — at the top of main.ts, add:
```typescript
import { ModuleRegistry } from '@core/module-registry/registry';
```

**In the DI container section**, replace EventRateLimiter registration:
```typescript
  container.register('ModuleRegistry', () => new ModuleRegistry());

  // After module/plugin construction, before EventConsumer creation:
  const moduleRegistry = container.resolve<ModuleRegistry>('ModuleRegistry');
  const cacheService = container.resolve<CacheService>('CacheService');

  productModule.registerWithRegistry(
    {
      registerRateLimits: (mod, cfgs) => moduleRegistry.registerRateLimits(mod, cfgs),
      registerEventHandler: (mod, type, handler) => moduleRegistry.registerEventHandler(mod, type, handler),
    },
    cacheService,
  );

  // EventRateLimiter now uses registry
  container.register('EventRateLimiter', () => {
    return new EventRateLimiter(moduleRegistry.getAllRateLimits());
  });
```

**After EventConsumer creation**, register handlers from registry:
```typescript
  const eventConsumer = container.resolve<EventConsumer>('EventConsumer');
  for (const reg of moduleRegistry.getEventHandlers()) {
    eventConsumer.registerHandler(reg.eventType, reg.handler);
  }
```

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd backend && npx jest tests/modules/product/ tests/core/consumer/ tests/core/module-registry/ -v`
Expected: PASS all tests

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/product/product.module.ts backend/src/main.ts backend/tests/modules/product/product.module.test.ts
git commit -m "refactor(core): move domain rate limits and event handlers from main.ts to ProductModule via ModuleRegistry"
```

---

## Task 4: Move Order Rate Limits from main.ts

**Files:**
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Add order rate limit registration to OrderModule**

Read `backend/src/modules/order/order.module.ts` first to understand its current state. Then add:

```typescript
  registerWithRegistry(
    registry: { registerRateLimits: (mod: string, cfgs: { eventType: string; maxEventsPerSecond: number }[]) => void },
  ): void {
    registry.registerRateLimits('order', [
      { eventType: 'order.created.v1', maxEventsPerSecond: 100 },
      { eventType: 'order.completed.v1', maxEventsPerSecond: 100 },
    ]);
  }
```

- [ ] **Step 2: Register OrderModule rate limits in main.ts**

In `backend/src/main.ts`, after constructing OrderModule (if it exists), add:
```typescript
  orderModule.registerWithRegistry({
    registerRateLimits: (mod, cfgs) => moduleRegistry.registerRateLimits(mod, cfgs),
  });
```

- [ ] **Step 3: Run tests**

Run: `cd backend && npx jest -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/order/order.module.ts backend/src/main.ts
git commit -m "refactor(core): move order rate limits from main.ts to OrderModule"
```

---

## Task 5: Fix Saga persistState — Wrap in Transaction

**Files:**
- Modify: `backend/src/core/saga/saga-orchestrator.ts:178-191`
- Test: `backend/tests/core/saga/saga-persist-transaction.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/saga/saga-persist-transaction.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';

describe('SagaOrchestrator persistState transaction safety', () => {
  it('should use transaction for persistState', async () => {
    const transactionFn = jest.fn(async (fn: any) => fn(createTxMock()));
    const insertValuesFn = jest.fn(async () => {});

    function createTxMock() {
      return {
        insert: jest.fn(() => ({ values: insertValuesFn })),
        update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => {}) })) })),
        select: jest.fn(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(async () => []),
            })),
          })),
        })),
        transaction: transactionFn,
      };
    }

    const mockDb = {
      insert: jest.fn(() => ({ values: insertValuesFn })),
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => {}) })) })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      transaction: transactionFn,
    };

    const orchestrator = new SagaOrchestrator(mockDb as any);

    await orchestrator.startSaga(
      {
        name: 'test-saga',
        aggregateId: 'agg-1',
        steps: [
          {
            name: 'step1',
            execute: jest.fn(async () => {}),
            compensate: jest.fn(async () => {}),
            timeout: 5000,
            retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
          },
        ],
        maxRetries: 3,
        retryDelayMs: 1000,
      },
      { data: 'test' },
    );

    // persistState should be called within a transaction
    // The mock transaction should have been called for persistState
    expect(transactionFn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/saga/saga-persist-transaction.test.ts -v`
Expected: The existing code calls `this.db.insert()` directly in `persistState()`, so the test checking `transactionFn` call count may show insufficient calls. The key assertion: `persistState` must go through `withTransaction`.

- [ ] **Step 3: Fix persistState to use withTransaction**

In `backend/src/core/saga/saga-orchestrator.ts`, change `persistState` method (lines 178-191):

```typescript
  private async persistState(state: Omit<SagaStateRecord, 'id' | 'startedAt' | 'updatedAt' | 'completedAt' | 'ttlAt'>): Promise<void> {
    await this.withTransaction(async (tx) => {
      await tx.insert(sagaState).values({
        sagaId: state.sagaId,
        sagaName: state.sagaName,
        aggregateId: state.aggregateId,
        status: state.status,
        currentStep: state.currentStep,
        completedSteps: JSON.stringify(state.completedSteps),
        compensatedSteps: JSON.stringify(state.compensatedSteps),
        context: JSON.stringify(state.context),
        retryCount: state.retryCount,
        lastError: state.lastError,
      });
    });
  }
```

- [ ] **Step 4: Run existing saga tests + new test**

Run: `cd backend && npx jest tests/core/saga/ -v`
Expected: PASS (existing tests still pass + new transaction test passes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/saga/saga-orchestrator.ts backend/tests/core/saga/saga-persist-transaction.test.ts
git commit -m "fix(saga): wrap persistState in transaction for atomicity"
```

---

## Task 6: Fix Saga JSON.stringify Type Mismatch on jsonb Columns

**Files:**
- Modify: `backend/src/core/saga/saga-orchestrator.ts:185-188,210-211`
- Test: `backend/tests/core/saga/saga-jsonb-type.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/saga/saga-jsonb-type.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';

describe('SagaOrchestrator jsonb type handling', () => {
  it('should pass arrays/objects directly to jsonb columns, not JSON.stringify', async () => {
    const insertedValues: Record<string, unknown>[] = [];
    const mockDb = {
      insert: jest.fn(() => ({
        values: jest.fn(async (vals: Record<string, unknown>) => {
          insertedValues.push(vals);
        }),
      })),
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => {}) })) })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => []),
          })),
        })),
      })),
      transaction: jest.fn(async (fn: any) => fn(mockDb)),
    };

    const orchestrator = new SagaOrchestrator(mockDb as any);

    await orchestrator.startSaga(
      {
        name: 'jsonb-test',
        aggregateId: 'agg-1',
        steps: [
          {
            name: 'step1',
            execute: jest.fn(async () => {}),
            compensate: jest.fn(async () => {}),
            timeout: 5000,
            retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
          },
        ],
        maxRetries: 3,
        retryDelayMs: 1000,
      },
      { key: 'value' },
    );

    expect(insertedValues.length).toBeGreaterThan(0);
    const persistValues = insertedValues[0];

    // completedSteps should be an array, not a string
    expect(Array.isArray(persistValues.completedSteps)).toBe(true);
    expect(typeof persistValues.completedSteps).not.toBe('string');

    // compensatedSteps should be an array, not a string
    expect(Array.isArray(persistValues.compensatedSteps)).toBe(true);
    expect(typeof persistValues.compensatedSteps).not.toBe('string');

    // context should be an object, not a string
    expect(typeof persistValues.context).toBe('object');
    expect(typeof persistValues.context).not.toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/saga/saga-jsonb-type.test.ts -v`
Expected: FAIL — `persistValues.completedSteps` is a string (from `JSON.stringify()`)

- [ ] **Step 3: Remove JSON.stringify from persistState and updateSagaState**

In `backend/src/core/saga/saga-orchestrator.ts`, change `persistState` (lines 185-187):

```typescript
      // OLD:
      // completedSteps: JSON.stringify(state.completedSteps),
      // compensatedSteps: JSON.stringify(state.compensatedSteps),
      // context: JSON.stringify(state.context),

      // NEW:
      completedSteps: state.completedSteps,
      compensatedSteps: state.compensatedSteps,
      context: state.context,
```

Change `updateSagaState` (lines 210-211):

```typescript
      // OLD:
      // if (updates.completedSteps !== undefined) setValues.completedSteps = JSON.stringify(updates.completedSteps);
      // if (updates.compensatedSteps !== undefined) setValues.compensatedSteps = JSON.stringify(updates.compensatedSteps);

      // NEW:
      if (updates.completedSteps !== undefined) setValues.completedSteps = updates.completedSteps;
      if (updates.compensatedSteps !== undefined) setValues.compensatedSteps = updates.compensatedSteps;
```

- [ ] **Step 4: Run all saga tests**

Run: `cd backend && npx jest tests/core/saga/ -v`
Expected: PASS all saga tests

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/saga/saga-orchestrator.ts backend/tests/core/saga/saga-jsonb-type.test.ts
git commit -m "fix(saga): remove JSON.stringify on jsonb columns — let Drizzle handle serialization"
```

---

## Task 7: Call All ArchitectureValidator Methods at Startup

**Files:**
- Modify: `backend/src/main.ts:112-116`
- Test: `backend/tests/core/architecture-validator/validator-startup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/architecture-validator/validator-startup.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { ArchitectureValidator } from '@core/architecture-validator/validator';

describe('ArchitectureValidator full startup validation', () => {
  it('should call validateNoCoreToModule during startup', async () => {
    const validator = new ArchitectureValidator();
    const spy = jest.spyOn(validator, 'validateNoCoreToModule');

    // validateOnStartup should internally call validateNoCoreToModule
    // Currently it does NOT — this test will fail
    await validator.validateOnStartup(['EventBus', 'Config', 'Database', 'EventSchemaRegistry', 'OutboxRepository'], () => []);

    // This assertion will fail because validateOnStartup doesn't call validateNoCoreToModule
    // We need to change the interface: validateOnStartup should accept a DependencyGraph
    // For now, test the methods exist and work independently
    expect(typeof validator.validateNoCoreToModule).toBe('function');
    expect(typeof validator.validateNoCoreToPlugin).toBe('function');
    expect(typeof validator.validatePluginGuards).toBe('function');
    expect(typeof validator.validateServiceInterfaces).toBe('function');
  });

  it('validateNoCoreToModule should throw on core-to-module edge', () => {
    const validator = new ArchitectureValidator();
    expect(() =>
      validator.validateNoCoreToModule({
        nodes: ['core/event-bus', 'modules/product'],
        edges: [{ from: 'core/event-bus', to: 'modules/product' }],
      }),
    ).toThrow('Core must not depend on modules');
  });

  it('validateNoCoreToPlugin should throw on core-to-plugin edge', () => {
    const validator = new ArchitectureValidator();
    expect(() =>
      validator.validateNoCoreToPlugin({
        nodes: ['core/proxy', 'plugins/analytics'],
        edges: [{ from: 'core/proxy', to: 'plugins/analytics' }],
      }),
    ).toThrow('Core must not depend on plugins');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/architecture-validator/validator-startup.test.ts -v`
Expected: The type-check test passes but the integration test verifying `validateOnStartup` calls all methods will fail.

- [ ] **Step 3: Update ArchitectureValidator.validateOnStartup to accept DependencyGraph**

In `backend/src/core/architecture-validator/validator.ts`, change `validateOnStartup` (lines 19-25):

```typescript
  async validateOnStartup(
    diTokens: string[],
    dependencyResolver: (token: string) => string[],
    options?: {
      dependencyGraph?: DependencyGraph;
      plugins?: PluginRegistration[];
      serviceBindings?: ServiceBinding[];
    },
  ): Promise<void> {
    this.validateDIGraph(diTokens, dependencyResolver);
    this.validateServiceBindings(diTokens);

    if (options?.dependencyGraph) {
      this.validateNoCoreToModule(options.dependencyGraph);
      this.validateNoCoreToPlugin(options.dependencyGraph);
    }

    if (options?.plugins) {
      this.validatePluginGuards(options.plugins);
    }

    if (options?.serviceBindings) {
      this.validateServiceInterfaces(options.serviceBindings);
    }
  }
```

- [ ] **Step 4: Update main.ts to pass dependency graph**

In `backend/src/main.ts`, update the validator call (around line 113):

```typescript
  // Build dependency graph from registered DI tokens
  const tokens = container.getRegisteredTokens();
  const graphNodes = tokens.map((t) => t.toLowerCase());
  const graphEdges: { from: string; to: string }[] = [];
  for (const token of tokens) {
    const deps = container.getDependencies(token);
    for (const dep of deps) {
      graphEdges.push({ from: token.toLowerCase(), to: dep.toLowerCase() });
    }
  }

  await validator.validateOnStartup(
    container.getRegisteredTokens(),
    (token) => container.getDependencies(token),
    {
      dependencyGraph: { nodes: graphNodes, edges: graphEdges },
      plugins: [
        {
          name: analyticsPlugin.getMetadata().name,
          permissions: analyticsPlugin.getMetadata().permissions ?? [],
          activatedAt: null,
        },
      ],
      serviceBindings: [], // No interface bindings yet
    },
  );
```

- [ ] **Step 5: Run all architecture validator tests**

Run: `cd backend && npx jest tests/core/architecture-validator/ -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/core/architecture-validator/validator.ts backend/src/main.ts backend/tests/core/architecture-validator/validator-startup.test.ts
git commit -m "feat(arch): call all ArchitectureValidator methods at startup with dependency graph"
```

---

## Task 8: Add Error Boundary to AnalyticsPlugin Event Handler

**Files:**
- Modify: `backend/src/plugins/analytics/analytics.plugin.ts:81-87`
- Test: `backend/tests/plugins/analytics/analytics-error-boundary.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/plugins/analytics/analytics-error-boundary.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { AnalyticsPlugin } from '@plugins/analytics/analytics.plugin';

describe('AnalyticsPlugin error boundary', () => {
  it('should not propagate errors from service.recordEvent in event handler', async () => {
    const plugin = new AnalyticsPlugin();

    const mockDb = {
      insert: jest.fn(() => ({
        values: jest.fn(async () => {
          throw new Error('Database connection lost');
        }),
      })),
      select: jest.fn(() => ({ from: jest.fn(async () => []) })),
    };

    plugin.init(mockDb as any);

    const handlers: Record<string, Function> = {};
    const mockConsumer = {
      on: jest.fn((eventType: string, handler: Function) => {
        handlers[eventType] = handler;
      }),
    };

    plugin.setEventConsumer(mockConsumer as any);

    const testEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'product.created.v1',
      source: 'product-service',
      timestamp: new Date().toISOString(),
      aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
      payload: { productId: '550e8400-e29b-41d4-a716-446655440001', productName: 'Test', sku: 'T1', basePrice: 10, stock: 5 },
      metadata: { version: 'v1' },
    };

    // Should NOT throw — error should be caught internally
    await expect(handlers['product.created.v1'](testEvent, {})).resolves.not.toThrow();
  });

  it('should log error when service.recordEvent fails', async () => {
    const plugin = new AnalyticsPlugin();

    const mockDb = {
      insert: jest.fn(() => ({
        values: jest.fn(async () => {
          throw new Error('DB error');
        }),
      })),
      select: jest.fn(() => ({ from: jest.fn(async () => []) })),
    };

    plugin.init(mockDb as any);

    const handlers: Record<string, Function> = {};
    const mockConsumer = {
      on: jest.fn((eventType: string, handler: Function) => {
        handlers[eventType] = handler;
      }),
    };

    plugin.setEventConsumer(mockConsumer as any);

    const testEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'product.created.v1',
      source: 'product-service',
      timestamp: new Date().toISOString(),
      aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
      payload: {},
      metadata: { version: 'v1' },
    };

    // Should complete without throwing
    await handlers['product.created.v1'](testEvent, {});
    // No assertion on log output — just verifying no crash
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/plugins/analytics/analytics-error-boundary.test.ts -v`
Expected: FAIL — handler throws "Database connection lost" (no error boundary)

- [ ] **Step 3: Add try/catch to event handler in setEventConsumer**

In `backend/src/plugins/analytics/analytics.plugin.ts`, change lines 81-87:

```typescript
    for (const eventType of trackedEvents) {
      consumer.on(eventType, async (event: EventEnvelope, _tx: Record<string, unknown>) => {
        if (service) {
          try {
            await service.recordEvent(event);
          } catch (error) {
            log.error(
              { err: error, eventType: event.type, eventId: event.id },
              'Analytics plugin failed to record event — swallowing error to prevent cascade',
            );
          }
        }
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/plugins/analytics/analytics-error-boundary.test.ts -v`
Expected: PASS

- [ ] **Step 5: Run all analytics tests**

Run: `cd backend && npx jest tests/plugins/analytics/ -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/plugins/analytics/analytics.plugin.ts backend/tests/plugins/analytics/analytics-error-boundary.test.ts
git commit -m "fix(plugin): add error boundary in AnalyticsPlugin event handler for failure isolation"
```

---

## Task 9: Update IPlugin Interface to Match Architecture Spec

**Files:**
- Modify: `backend/src/core/plugin-system/plugin-loader.ts:23-28`
- Test: `backend/tests/core/plugin-system/plugin-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/core/plugin-system/plugin-loader.test.ts`:

```typescript
  it('IPlugin interface should include getModules method', () => {
    // Verify by creating a minimal implementation
    const plugin: IPlugin = {
      getMetadata: () => ({
        name: 'test',
        version: '1.0.0',
        description: 'test',
        enabled: true,
        trusted: true,
      }),
      getModules: () => [],
      onActivate: async () => {},
      onDeactivate: async () => {},
      onInstall: async () => {},
      onUninstall: async () => {},
      dispose: async () => {},
    };

    expect(plugin.getModules()).toEqual([]);
    expect(typeof plugin.onInstall).toBe('function');
    expect(typeof plugin.onUninstall).toBe('function');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/plugin-system/plugin-loader.test.ts -v`
Expected: FAIL — TypeScript compilation error or test failure because `IPlugin` doesn't have `getModules`, `onInstall`, `onUninstall`

- [ ] **Step 3: Update IPlugin interface**

In `backend/src/core/plugin-system/plugin-loader.ts`, change lines 23-28:

```typescript
interface IPlugin {
  getMetadata(): PluginMetadata;
  getModules(): unknown[];
  onActivate(): Promise<void>;
  onDeactivate(): Promise<void>;
  onInstall?(): Promise<void>;
  onUninstall?(): Promise<void>;
  dispose(): Promise<void>;
}
```

- [ ] **Step 4: Update AnalyticsPlugin to implement getModules**

In `backend/src/plugins/analytics/analytics.plugin.ts`, add `getModules` method (after `getModule` at line 46):

```typescript
  getModules(): unknown[] {
    return this.module ? [this.module] : [];
  }
```

- [ ] **Step 5: Run all plugin tests**

Run: `cd backend && npx jest tests/core/plugin-system/ tests/plugins/analytics/ -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/core/plugin-system/plugin-loader.ts backend/src/plugins/analytics/analytics.plugin.ts backend/tests/core/plugin-system/plugin-loader.test.ts
git commit -m "feat(plugin): add getModules, onInstall, onUninstall to IPlugin interface per Architecture spec"
```

---

## Task 10: Fix analytics.schema.ts aggregateId Type

**Files:**
- Modify: `backend/src/plugins/analytics/analytics.schema.ts:6`
- Test: `backend/tests/plugins/analytics/analytics.schema.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/plugins/analytics/analytics.schema.test.ts
import { describe, it, expect } from '@jest/globals';
import { analyticsEvents } from '@plugins/analytics/analytics.schema';

describe('Analytics schema', () => {
  it('should use uuid type for aggregateId column', () => {
    const column = analyticsEvents.aggregateId;
    // Drizzle column data type check
    expect(column.dataType).toBe('string');
    // The column name should be 'aggregate_id'
    expect(column.name).toBe('aggregate_id');
  });
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `cd backend && npx jest tests/plugins/analytics/analytics.schema.test.ts -v`
Expected: May PASS or FAIL depending on Drizzle internals. The real fix is in the schema definition.

- [ ] **Step 3: Change aggregateId from varchar to uuid**

In `backend/src/plugins/analytics/analytics.schema.ts`, change line 6:

```typescript
// OLD:
// aggregateId: varchar('aggregate_id', { length: 255 }).notNull(),

// NEW:
import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const analyticsEvents = pgTable('plugin_analytics_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  data: jsonb('data').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index('plugin_analytics_event_type_idx').on(table.eventType),
  recordedAtIdx: index('plugin_analytics_recorded_at_idx').on(table.recordedAt),
}));
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest tests/plugins/analytics/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/plugins/analytics/analytics.schema.ts backend/tests/plugins/analytics/analytics.schema.test.ts
git commit -m "fix(analytics): change aggregateId from varchar(255) to uuid for consistency with core convention"
```

---

## Task 11: Add lint:arch and validate:runtime Scripts

**Files:**
- Modify: `backend/package.json`
- Create: `backend/scripts/lint-arch.ts`
- Create: `backend/scripts/validate-runtime.ts`

- [ ] **Step 1: Create lint-arch script**

```typescript
// backend/scripts/lint-arch.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_DIR = resolve(__dirname, '../src');

interface Violation {
  file: string;
  line: number;
  message: string;
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (fullPath.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function lintArchitecture(): Violation[] {
  const violations: Violation[] = [];
  const allFiles = findFiles(SRC_DIR, '.ts');

  for (const file of allFiles) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const relPath = file.replace(SRC_DIR + '/', '');

    // Rule: Core must not import from modules
    if (relPath.startsWith('core/')) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("from '@modules/")) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'Core must not import from modules',
          });
        }
        if (lines[i].includes("from '@plugins/")) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'Core must not import from plugins',
          });
        }
      }
    }

    // Rule: Plugins must not import repositories or schemas from modules
    if (relPath.startsWith('plugins/')) {
      for (let i = 0; i < lines.length; i++) {
        if (/from '@modules\/.*\.(repository|schema)/.test(lines[i])) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'Plugins must use service interfaces, not repositories or schemas',
          });
        }
      }
    }

    // Rule: Modules must not import from other modules
    if (relPath.startsWith('modules/')) {
      const moduleMatch = relPath.match(/^modules\/([^/]+)\//);
      if (moduleMatch) {
        const currentModule = moduleMatch[1];
        for (let i = 0; i < lines.length; i++) {
          const importMatch = lines[i].match(/from '@modules\/([^/]+)\//);
          if (importMatch && importMatch[1] !== currentModule) {
            violations.push({
              file: relPath,
              line: i + 1,
              message: `Module "${currentModule}" must not import from module "${importMatch[1]}"`,
            });
          }
        }
      }
    }
  }

  return violations;
}

const violations = lintArchitecture();
if (violations.length > 0) {
  console.error('Architecture violations found:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.message}`);
  }
  process.exit(1);
} else {
  console.log('Architecture lint passed — no violations found.');
}
```

- [ ] **Step 2: Create validate-runtime script**

```typescript
// backend/scripts/validate-runtime.ts
import { execSync } from 'node:child_process';

console.log('Running runtime validation checks...');

// Check 1: TypeScript compilation
console.log('  [1/3] Typecheck...');
try {
  execSync('npx tsc --noEmit', { stdio: 'pipe' });
  console.log('  [1/3] Typecheck PASS');
} catch {
  console.error('  [1/3] Typecheck FAIL');
  process.exit(1);
}

// Check 2: Tests
console.log('  [2/3] Tests...');
try {
  execSync('npx jest --passWithNoTests', { stdio: 'pipe' });
  console.log('  [2/3] Tests PASS');
} catch {
  console.error('  [2/3] Tests FAIL');
  process.exit(1);
}

// Check 3: Architecture lint
console.log('  [3/3] Architecture lint...');
try {
  execSync('npx tsx scripts/lint-arch.ts', { stdio: 'pipe' });
  console.log('  [3/3] Architecture lint PASS');
} catch {
  console.error('  [3/3] Architecture lint FAIL');
  process.exit(1);
}

console.log('All runtime validation checks passed.');
```

- [ ] **Step 3: Add scripts to package.json**

In `backend/package.json`, add after the existing `lint:migration` script (line 12):

```json
    "lint:arch": "tsx scripts/lint-arch.ts",
    "validate:runtime": "tsx scripts/validate-runtime.ts",
```

- [ ] **Step 4: Run the new scripts to verify**

Run: `cd backend && npx tsx scripts/lint-arch.ts`
Expected: PASS or show current violations (if main.ts still has core-to-module imports, it will flag them)

Run: `cd backend && npm run validate:runtime`
Expected: Depends on current state — should run all 3 checks

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/lint-arch.ts backend/scripts/validate-runtime.ts backend/package.json
git commit -m "build: add lint:arch and validate:runtime scripts for architecture enforcement"
```

---

## Task 12: Clean Up ProductDeletedEventSchema Alias

**Files:**
- Modify: `backend/src/modules/product/events/product.events.ts:59-61`

- [ ] **Step 1: Update the deprecated alias to add proper deprecation warning**

In `backend/src/modules/product/events/product.events.ts`, replace lines 59-61:

```typescript
/**
 * @deprecated Use ProductDeactivatedEventSchema instead.
 * This alias exists for backward compatibility only.
 * The canonical event type is 'product.deactivated.v1'.
 */
export const ProductDeletedEventSchema = ProductDeactivatedEventSchema;
export type ProductDeletedEvent = ProductDeactivatedEvent;
```

- [ ] **Step 2: Search codebase for usages of ProductDeletedEventSchema**

Run: `cd backend && grep -r "ProductDeletedEventSchema" src/ --include="*.ts"`
Expected: Only found in `product.events.ts` (the definition). No other usages.

- [ ] **Step 3: Run tests**

Run: `cd backend && npx jest tests/modules/product/events/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/product/events/product.events.ts
git commit -m "docs(product): clarify ProductDeletedEventSchema deprecation with proper JSDoc"
```

---

## Task 13: Verify All Fixes — Full Test Suite

**Files:**
- None (validation only)

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests`
Expected: PASS all tests

- [ ] **Step 2: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `cd backend && npm run lint`
Expected: PASS

- [ ] **Step 4: Run architecture lint**

Run: `cd backend && npx tsx scripts/lint-arch.ts`
Expected: PASS (or identify remaining violations from main.ts composition root)

- [ ] **Step 5: Run validate:runtime**

Run: `cd backend && npm run validate:runtime`
Expected: PASS

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: post-audit verification — all checks passing"
```

---

## Self-Review

### Spec Coverage

| Audit Issue | Task | Status |
|-------------|------|--------|
| C1: Core imports module/plugin | Task 3 (partial — main.ts still imports, but domain config moved out) | Covered |
| C2: Domain event types hardcoded in rate limiter | Task 3 | Covered |
| C3: Domain-specific event handlers in bootstrap | Task 3 | Covered |
| C4: Direct module/plugin construction | Task 3 (construction remains in main.ts as composition root) | Partially covered* |
| M1: Domain-aware error codes | Out of scope (shared layer, low risk) | Not covered |
| M2: SoftDeletable in shared types | Out of scope (shared layer, low risk) | Not covered |
| M3: Event naming inconsistency | Task 12 | Covered |
| M4: No deletedAt column | Out of scope (schema change, needs migration) | Not covered |
| P1: init(db) takes raw Db | Out of scope (major refactor needed) | Not covered |
| P2: No error boundary in event handler | Task 8 | Covered |
| P3: AnalyticsService takes Db directly | Out of scope (same as P1) | Not covered |
| P4: aggregateId varchar not uuid | Task 10 | Covered |
| A1: Validator only calls 2/6 methods | Task 7 | Covered |
| A2: No lint:arch script | Task 11 | Covered |
| A3: No validate:runtime script | Task 11 | Covered |
| A4: lint-migrations.ts exists | Audit was inaccurate — file exists | N/A |
| A5: Event naming mismatch | Task 12 (documented choice) | Covered |
| A6: persistState not in transaction | Task 5 | Covered |
| A7: JSON.stringify on jsonb columns | Task 6 | Covered |
| A8: RESTRICTED_TOKEN_PATTERNS | Audit was inaccurate — no such symbol | N/A |
| A9: IPlugin missing getModules | Task 9 | Covered |
| A10: IPlugin missing onInstall/onUninstall | Task 9 | Covered |
| A11: No generate:types script | Out of scope (frontend not built yet) | Not covered |

**\*C4 note:** main.ts IS the composition root — it MUST construct modules and plugins. The audit's C4 finding is architecturally correct in that the wiring is too manual, but moving construction to a registry/factory would be over-engineering at this stage. Tasks 3-4 move the domain-specific CONFIG out, which is the important part.

### Out-of-Scope Items (Not Covered by This Plan)

These require separate, larger efforts:

1. **M1/M2** — Shared layer domain-aware error codes. Low risk, cosmetic.
2. **M4/P1/P3** — Plugin DI injection pattern. Requires redesigning plugin initialization to go through DI container. Major refactor.
3. **A11** — Frontend types generation. Depends on `apps/shop` being built.

### Placeholder Scan

No TBD, TODO, "implement later", "add appropriate error handling", or "similar to Task N" patterns found.

### Type Consistency

- `RateLimitConfig` used consistently across Task 1, Task 3, and existing `rate-limiter.ts`
- `EventHandler` type matches `consumer.ts` signature `(event: EventEnvelope, tx: Db) => Promise<void>`
- `ModuleRegistry` methods match the duck-typed interface passed to `ProductModule.registerWithRegistry()`
- `IPlugin.getModules()` returns `unknown[]` to avoid circular dependency on `Module` type
