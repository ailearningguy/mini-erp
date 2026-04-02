# Phase 0: Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 existing bugs trước khi implement Extended Architecture — đảm bảo codebase stable làm foundation.

**Architecture:** Fix bugs trong `main.ts` bootstrap và `analytics.plugin.ts` — không thay đổi architecture, chỉ sửa sai sót trong wiring hiện tại.

**Tech Stack:** Express.js, custom DI container, Jest, TypeScript

**Spec Reference:** `docs/architecture/extended-architecture-implementation-spec.md` Part B.1

---

## Files Overview

| File | Role |
|------|------|
| `backend/src/main.ts` | Bootstrap — fix 3 bugs (B1, B2, B4) |
| `backend/src/plugins/analytics/analytics.plugin.ts` | Refactor: remove `init(db)`, use constructor DI (B3) |
| `backend/tests/core/di/container.test.ts` | Verify fix B1 |
| `backend/tests/core/architecture-validator/validator.test.ts` | Verify fix B2 |
| `backend/tests/plugins/analytics/analytics.plugin.test.ts` | Verify fix B3 |

---

### Task 1: Fix EventRateLimiter Double Registration (B1 — CRITICAL)

**Problem:** `main.ts` registers `'EventRateLimiter'` token twice. `DIContainer.register()` throws on duplicate token → runtime crash on bootstrap.

**Files:**
- Modify: `backend/src/main.ts`
- Test: `backend/tests/core/di/container.test.ts`

- [ ] **Step 1: Write the failing test for duplicate registration behavior**

```typescript
// Add to backend/tests/core/di/container.test.ts

describe('DIContainer duplicate registration', () => {
  it('should throw when registering same token twice', () => {
    const container = new DIContainer();
    container.register('TokenA', () => 'first');

    expect(() => {
      container.register('TokenA', () => 'second');
    }).toThrow('Service already registered: TokenA');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (existing behavior)**

Run: `cd backend && npx jest tests/core/di/container.test.ts -t "duplicate registration" -v`
Expected: PASS (existing behavior throws correctly)

- [ ] **Step 3: Identify the two registrations in main.ts**

In `backend/src/main.ts`, find these two blocks:

First registration (line ~80 — empty array):
```typescript
container.register('EventRateLimiter', () => {
  return new EventRateLimiter([]);
});
```

Second registration (line ~167 — with module rate limits):
```typescript
container.register('EventRateLimiter', () => {
  return new EventRateLimiter(moduleRegistry.getAllRateLimits());
});
```

- [ ] **Step 4: Fix — remove first registration, keep only the second**

Remove the first `container.register('EventRateLimiter', ...)` block (lines ~80-82). Move the second registration earlier, before modules register their rate limits, OR change approach to register once with empty array then update rates after module registration.

**Better approach:** Register once AFTER module registration:

```typescript
// In main.ts, remove BOTH existing EventRateLimiter registrations.
// Add ONE registration AFTER module rate limits are registered:

// After productModule.registerWithRegistry(...) and orderModule.registerWithRegistry(...)
container.register('EventRateLimiter', () => {
  return new EventRateLimiter(moduleRegistry.getAllRateLimits());
});
```

The full sequence in `main.ts` should be:

```typescript
// 1. Register all other services (Config, Database, Redis, etc.)
// 2. Register modules (productModule.registerWithRegistry, orderModule.registerWithRegistry)
// 3. NOW register EventRateLimiter with aggregated rate limits
container.register('EventRateLimiter', () => {
  return new EventRateLimiter(moduleRegistry.getAllRateLimits());
}, ['ModuleRegistry']);
// 4. Then register EventConsumer that depends on EventRateLimiter
```

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/main.ts
git commit -m "fix: remove EventRateLimiter double registration in bootstrap

EventRateLimiter was registered twice — first with empty array, then with
module rate limits. DIContainer.register() throws on duplicate token,
causing runtime crash. Now registered once after module rate limits are
collected."
```

---

### Task 2: Wire ArchitectureValidator with Real Arrays (B2 — HIGH)

**Problem:** `main.ts` calls `validator.validateOnStartup(...)` with `plugins: []` and `serviceBindings: []` — validation effectively no-op.

**Files:**
- Modify: `backend/src/main.ts`
- Test: `backend/tests/core/architecture-validator/validator.test.ts`

- [ ] **Step 1: Write the failing test for validator with empty arrays**

```typescript
// Add to backend/tests/core/architecture-validator/validator.test.ts

describe('ArchitectureValidator with empty inputs', () => {
  it('should skip plugin validation when plugins array is empty', async () => {
    const validator = new ArchitectureValidator();
    const tokens = ['EventBus', 'Database', 'CacheService'];

    const result = await validator.validateOnStartup(
      tokens,
      () => [],
      {
        dependencyGraph: { nodes: tokens.map(t => t.toLowerCase()), edges: [] },
        plugins: [],
        serviceBindings: [],
      },
    );

    // With empty plugins, should not check plugin permissions
    expect(result.valid).toBe(true);
  });

  it('should validate plugin permissions when plugins are provided', async () => {
    const validator = new ArchitectureValidator();
    const tokens = ['EventBus', 'Database', 'PluginLoader'];

    // This test documents that we NEED to pass real plugin data
    // Currently main.ts passes [], making this check useless
    const result = await validator.validateOnStartup(
      tokens,
      () => [],
      {
        dependencyGraph: { nodes: tokens.map(t => t.toLowerCase()), edges: [] },
        plugins: ['analytics'],
        serviceBindings: [{ token: 'IProductService', provider: 'ProductService' }],
      },
    );

    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/architecture-validator/validator.test.ts -v`
Expected: PASS

- [ ] **Step 3: Fix main.ts — collect real plugins and service bindings**

In `backend/src/main.ts`, find the `validator.validateOnStartup(...)` call. Replace the empty arrays with real data:

```typescript
// Before (current):
await validator.validateOnStartup(
  container.getRegisteredTokens(),
  (token) => container.getDependencies(token),
  {
    dependencyGraph: { nodes: graphNodes, edges: graphEdges },
    plugins: [],
    serviceBindings: [],
  },
);

// After (fixed):
const activePlugins = pluginLoader.getActivePlugins().map(p => p.getMetadata().name);
const serviceBindings = container.getRegisteredTokens()
  .filter(t => t.startsWith('I') && t[1] === t[1].toUpperCase())
  .map(t => ({ token: t, provider: 'registered' }));

await validator.validateOnStartup(
  container.getRegisteredTokens(),
  (token) => container.getDependencies(token),
  {
    dependencyGraph: { nodes: graphNodes, edges: graphEdges },
    plugins: activePlugins,
    serviceBindings: serviceBindings,
  },
);
```

**Note:** This requires moving the validator call to AFTER plugin registration. In the current bootstrap order, plugins are registered after validator. Reorder:

```
Current order:
1. Register core services
2. Validate DI graph ← plugins: []
3. Register modules
4. Register plugins

New order:
1. Register core services
2. Register modules
3. Register plugins
4. Validate DI graph + architecture ← plugins: ['analytics']
```

- [ ] **Step 4: Run test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.ts backend/tests/core/architecture-validator/validator.test.ts
git commit -m "fix: wire ArchitectureValidator with real plugin/service arrays

ArchitectureValidator was called with plugins: [] and serviceBindings: [],
making all plugin permission and service binding validation no-op.
Now collects active plugin names and interface tokens from container.
Moved validator call after plugin registration to ensure data is available."
```

---

### Task 3: Refactor AnalyticsPlugin — Remove init(db), Use Constructor DI (B3 — MEDIUM)

**Problem:** `AnalyticsPlugin` has `init(db)` method not in `IPlugin` interface. `main.ts` calls it manually — not type-safe.

**Decision:** KHÔNG thêm `init(db)` vào `IPlugin`. Refactor `AnalyticsPlugin` to receive `db` via constructor (DI pattern).

**Files:**
- Modify: `backend/src/plugins/analytics/analytics.plugin.ts`
- Modify: `backend/src/main.ts`
- Test: `backend/tests/plugins/analytics/analytics.plugin.test.ts`

- [ ] **Step 1: Write the failing test for constructor DI pattern**

```typescript
// Add to backend/tests/plugins/analytics/analytics.plugin.test.ts

describe('AnalyticsPlugin constructor DI', () => {
  it('should create module in constructor when db is provided', () => {
    const mockDb = {} as any;
    const plugin = new AnalyticsPlugin(mockDb);

    expect(plugin.isActive()).toBe(true);
    expect(plugin.getModule()).not.toBeNull();
    expect(plugin.getService()).not.toBeNull();
  });

  it('should have correct metadata', () => {
    const mockDb = {} as any;
    const plugin = new AnalyticsPlugin(mockDb);
    const metadata = plugin.getMetadata();

    expect(metadata.name).toBe('analytics');
    expect(metadata.trusted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/plugins/analytics/analytics.plugin.test.ts -t "constructor DI" -v`
Expected: FAIL — constructor expects 0 args but test passes 1

- [ ] **Step 3: Refactor AnalyticsPlugin — add db to constructor, remove init()**

Replace the class in `backend/src/plugins/analytics/analytics.plugin.ts`:

```typescript
class AnalyticsPlugin implements IPlugin {
  private module: AnalyticsModule;

  constructor(db: Db) {
    this.module = new AnalyticsModule(db);
  }

  getMetadata(): PluginMetadata {
    return {
      name: 'analytics',
      version: '2026.04.01',
      description: 'Tracks domain events for analytics dashboards',
      author: 'ERP Team',
      enabled: true,
      trusted: true,
      permissions: analyticsPermissions,
      config: {
        trackedEvents: [
          'product.created.v1',
          'product.updated.v1',
          'order.created.v1',
          'order.completed.v1',
        ],
      },
    };
  }

  // REMOVE: init(db: Db): void { ... }

  getModule(): AnalyticsModule | null {
    return this.module;
  }

  getModules(): unknown[] {
    return this.module ? [this.module] : [];
  }

  getService(): AnalyticsService | null {
    return this.module?.getService() ?? null;
  }

  async onActivate(): Promise<void> {
    log.info('Plugin activated');
  }

  async onDeactivate(): Promise<void> {
    log.info('Plugin deactivated');
  }

  async onInstall(): Promise<void> {
    log.info('Plugin installed');
  }

  async onUninstall(): Promise<void> {
    log.info('Plugin uninstalled');
  }

  async dispose(): Promise<void> {
    log.info('Plugin disposed');
  }

  isActive(): boolean {
    return this.module !== null;
  }

  setEventConsumer(consumer: {
    on(eventType: string, handler: (event: EventEnvelope, tx: Record<string, unknown>) => Promise<void>): void;
  }): void {
    const metadata = this.getMetadata();
    const trackedEvents: string[] = (metadata.config?.trackedEvents as string[]) ?? [];
    const service = this.getService();

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
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/plugins/analytics/analytics.plugin.test.ts -t "constructor DI" -v`
Expected: PASS

- [ ] **Step 5: Update main.ts — pass db to constructor, remove init() call**

In `backend/src/main.ts`, find:

```typescript
const analyticsPlugin = new AnalyticsPlugin();
analyticsPlugin.init(db);
```

Replace with:

```typescript
const analyticsPlugin = new AnalyticsPlugin(db);
```

- [ ] **Step 6: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/plugins/analytics/analytics.plugin.ts backend/src/main.ts backend/tests/plugins/analytics/analytics.plugin.test.ts
git commit -m "refactor: AnalyticsPlugin use constructor DI instead of init(db)

Remove init(db) method from AnalyticsPlugin — not part of IPlugin interface.
Now receives db via constructor, consistent with DI pattern. main.ts updated
to pass db at construction time."
```

---

### Task 4: Wire Saga Orchestrator in Bootstrap (B4 — MEDIUM)

**Problem:** `SagaOrchestrator` exists (266 lines) but not instantiated in `main.ts` bootstrap.

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Write the failing test — SagaOrchestrator should be accessible**

```typescript
// Add to backend/tests/core/saga/saga-orchestrator.test.ts

describe('SagaOrchestrator instantiation', () => {
  it('should be creatable with a db instance', () => {
    const mockDb = {
      transaction: jest.fn(),
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
    } as any;

    const orchestrator = new SagaOrchestrator(mockDb);
    expect(orchestrator).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/saga/saga-orchestrator.test.ts -t "instantiation" -v`
Expected: PASS

- [ ] **Step 3: Wire SagaOrchestrator in main.ts**

In `backend/src/main.ts`, after modules are registered and before AMQP consumer starts, add:

```typescript
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';

// After module registration block:
const sagaOrchestrator = new SagaOrchestrator(db);
logger.info('SagaOrchestrator initialized');
```

No routes needed yet — just ensure the orchestrator is available for future use.

- [ ] **Step 4: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.ts backend/tests/core/saga/saga-orchestrator.test.ts
git commit -m "fix: wire SagaOrchestrator in bootstrap

SagaOrchestrator was implemented but never instantiated in main.ts.
Now created during bootstrap, available for order module to use."
```

---

### Task 5: Full Validation — All Phase 0 Fixes

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All tests PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Manual verification checklist**

Verify in code:
- [ ] `main.ts` has exactly ONE `container.register('EventRateLimiter', ...)`
- [ ] `ArchitectureValidator.validateOnStartup()` receives non-empty `plugins` and `serviceBindings`
- [ ] `AnalyticsPlugin` has no `init()` method, constructor accepts `Db`
- [ ] `main.ts` has no `analyticsPlugin.init(db)` call
- [ ] `SagaOrchestrator` is instantiated in `main.ts`

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: Phase 0 bug fixes validation — all checks pass"
```

---

## Self-Review

**Spec coverage:**
- ✅ B1: EventRateLimiter double registration → Task 1
- ✅ B2: ArchitectureValidator no-op → Task 2
- ✅ B3: IPlugin init(db) inconsistency → Task 3
- ✅ B4: Saga Orchestrator wiring → Task 4

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** All types reference existing codebase types (`Db`, `EventEnvelope`, `PluginMetadata`, etc.).
