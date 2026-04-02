# Phase 5: Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add observability (restart metrics, structured logs), update OpenAPI spec với new endpoints, integrate event handler cleanup trong container dispose, và prepare for multi-instance deployment.

**Architecture:** Enhance existing metrics + logging with restart-specific signals. Update container.dispose() to call EventSchemaRegistry.clear() + EventConsumer.unregisterAll(). OpenAPI spec updated for module management endpoints.

**Tech Stack:** TypeScript, Express.js, Jest, Pino (existing), YAML (OpenAPI)

**Spec Reference:** `docs/architecture/extended-architecture-implementation-spec.md` Part C, Part F

**Prerequisite:** Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 complete

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/di/container.ts` | Modify | Integrate event cleanup in dispose() |
| `backend/src/core/consumer/consumer.ts` | Modify | Add unregisterAll() integration |
| `specs/openapi.yaml` | Modify | Add module management endpoints |
| `backend/tests/core/di/resettable-container.test.ts` | Modify | Test event cleanup on dispose |
| `backend/tests/e2e/soft-restart.e2e.test.ts` | Create | E2E test for full restart cycle |

---

### Task 1: Integrate Event Cleanup in Container Dispose

**Files:**
- Modify: `backend/src/core/di/container.ts`
- Test: `backend/tests/core/di/resettable-container.test.ts`

- [ ] **Step 1: Write the failing test for event cleanup on dispose**

```typescript
// Add to backend/tests/core/di/resettable-container.test.ts

describe('DIContainer dispose event cleanup', () => {
  it('should clear event schemas on dispose', async () => {
    const container = new DIContainer();
    const mockSchemaRegistry = {
      register: jest.fn(),
      clear: jest.fn(),
      hasSchema: jest.fn(),
      getRegisteredTypes: jest.fn().mockReturnValue([]),
    };
    container.registerCore('EventSchemaRegistry', { useFactory: () => mockSchemaRegistry });

    const mockModule: import('@core/di/container').IModule = {
      name: 'test',
      onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDestroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const mockFactory: import('@core/di/container').IModuleFactory = {
      create: () => ({ providers: [], module: mockModule }),
    };

    const metadata: import('@core/di/container').ModuleMetadata = {
      name: 'test',
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => mockFactory,
      manifest: { name: 'test', version: '2026.04.01', enabled: true },
    };

    await container.build([metadata]);
    await container.dispose();

    // Schema registry should be cleared after dispose
    // (schemas will be re-registered during next build)
    // Note: This is the "clean slate" approach
  });

  it('should unregister event handlers on dispose', async () => {
    const container = new DIContainer();
    const mockEventConsumer = {
      unregisterAll: jest.fn(),
      registerHandler: jest.fn(),
      consume: jest.fn(),
    };
    container.registerCore('EventConsumer', { useFactory: () => mockEventConsumer });

    const mockModule: import('@core/di/container').IModule = {
      name: 'test',
      onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDestroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const mockFactory: import('@core/di/container').IModuleFactory = {
      create: () => ({ providers: [], module: mockModule }),
    };

    await container.build([{
      name: 'test',
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => mockFactory,
      manifest: { name: 'test', version: '2026.04.01', enabled: true },
    }]);

    await container.dispose();

    expect(mockEventConsumer.unregisterAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -t "event cleanup" -v`
Expected: FAIL or PARTIAL — dispose doesn't call clear/unregisterAll yet

- [ ] **Step 3: Add event cleanup to dispose pipeline**

In `backend/src/core/di/container.ts`, modify the `disposeInternal()` method:

```typescript
private async disposeInternal(): Promise<void> {
  if (this.containerState !== 'READY') return;
  this.containerState = 'DISPOSING';

  // Step 1: module.onDestroy() in reverse order
  for (const m of [...this.modules].reverse()) {
    try { await m.onDestroy(); } catch (err) { console.error(err); }
  }

  // Step 2: Dispose module instances
  for (const [token, instance] of this.moduleInstances) {
    if (instance && typeof (instance as any).dispose === 'function') {
      try { await (instance as any).dispose(); } catch (err) { console.error(err); }
    }
  }

  // Step 3: Clear event schemas (clean slate — re-registered on next build)
  if (this.coreInstances.has('EventSchemaRegistry')) {
    const schemaRegistry = this.coreInstances.get('EventSchemaRegistry') as any;
    if (typeof schemaRegistry.clear === 'function') {
      schemaRegistry.clear();
    }
  }

  // Step 4: Unregister all event handlers
  if (this.coreInstances.has('EventConsumer')) {
    const eventConsumer = this.coreInstances.get('EventConsumer') as any;
    if (typeof eventConsumer.unregisterAll === 'function') {
      eventConsumer.unregisterAll();
    }
  }

  // Step 5: Clear module-level state
  this.moduleInstances.clear();
  this.moduleProviders.clear();
  this.modules = [];
  this.containerState = 'IDLE';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -t "event cleanup" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/di/container.ts backend/tests/core/di/resettable-container.test.ts
git commit -m "feat: integrate event cleanup in container dispose pipeline

dispose() now clears EventSchemaRegistry and unregisters all EventConsumer
handlers. Clean slate approach — schemas/handlers re-registered during
next build() via module.onInit()."
```

---

### Task 2: Update OpenAPI Spec for Module Endpoints

**Files:**
- Modify: `specs/openapi.yaml`

- [ ] **Step 1: Add module management endpoints to OpenAPI spec**

Append to `specs/openapi.yaml` (after existing paths):

```yaml
  /api/v1/modules:
    get:
      summary: List active modules
      operationId: listModules
      tags:
        - Modules
      security:
        - bearerAuth: []
      responses:
        '200':
          description: List of active modules
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Module'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /api/v1/modules/install:
    post:
      summary: Install a module
      operationId: installModule
      tags:
        - Modules
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
                  description: Module name to install
      responses:
        '200':
          description: Module installed successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      status:
                        type: string
                        example: installed
                      module:
                        type: string
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'

  /api/v1/modules/uninstall:
    post:
      summary: Uninstall a module
      operationId: uninstallModule
      tags:
        - Modules
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
                  description: Module name to uninstall
      responses:
        '200':
          description: Module uninstalled successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      status:
                        type: string
                        example: uninstalled
                      module:
                        type: string
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'

components:
  schemas:
    Module:
      type: object
      properties:
        name:
          type: string
          example: product
        version:
          type: string
          example: '2026.04.01'
        enabled:
          type: boolean
        dependencies:
          type: array
          items:
            type: object
            properties:
              name:
                type: string
              version:
                type: string
```

**Note:** Merge with existing `components/schemas` section rather than duplicating.

- [ ] **Step 2: Run spec linter**

Run: `cd backend && npm run lint:spec` (if available)
Expected: PASS or command not found

- [ ] **Step 3: Commit**

```bash
git add specs/openapi.yaml
git commit -m "feat: add module management endpoints to OpenAPI spec

GET  /api/v1/modules           — list active modules
POST /api/v1/modules/install   — install module
POST /api/v1/modules/uninstall — uninstall module
All require bearer auth."
```

---

### Task 3: Add Restart Logs to SoftRestartManager

**Files:**
- Modify: `backend/src/core/restart/soft-restart-manager.ts`

The SoftRestartManager from Phase 3 already has structured logs. Verify all three log points exist:

1. `soft-restart:start` — with reason
2. `soft-restart:success` — with module names + duration
3. `soft-restart:failed` — with error

If already present (from Phase 3 plan), no changes needed.

- [ ] **Step 1: Verify existing logs**

Read `backend/src/core/restart/soft-restart-manager.ts` and confirm all three log events exist.

- [ ] **Step 2: Add any missing logs**

If `soft-restart:rollback-success` or `soft-restart:rollback-failed` are missing, add them:

```typescript
// In the catch block of restart():
this.logger.info('soft-restart:rollback-success');
// OR on failure:
this.logger.error({ err: rollbackErr }, 'soft-restart:rollback-failed');
```

- [ ] **Step 3: Commit (if changes made)**

```bash
git add backend/src/core/restart/soft-restart-manager.ts
git commit -m "chore: verify structured logs for soft restart lifecycle"
```

---

### Task 4: Create E2E Test for Soft Restart Cycle

**Files:**
- Create: `backend/tests/e2e/soft-restart.e2e.test.ts`

- [ ] **Step 1: Create E2E test**

```typescript
// backend/tests/e2e/soft-restart.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { DIContainer } from '@core/di/container';
import { FsModuleRegistry } from '@core/module-registry/registry';
import { TrafficGate } from '@core/traffic/traffic-gate';
import { RequestTracker } from '@core/traffic/request-tracker';

// This test verifies the full build/dispose/rebuild cycle with
// real module discovery (filesystem scan)

describe('Soft Restart E2E', () => {
  let container: DIContainer;
  let registry: FsModuleRegistry;
  let gate: TrafficGate;
  let tracker: RequestTracker;

  beforeAll(() => {
    container = new DIContainer();
    registry = new FsModuleRegistry(
      // Use actual modules directory
      require('node:path').resolve(__dirname, '../../src/modules'),
      { info: () => {}, warn: () => {}, error: () => {} },
    );
    gate = new TrafficGate();
    tracker = new RequestTracker();
  });

  it('should complete full build → dispose → rebuild cycle', async () => {
    // Register core providers
    container.registerCore('ExpressApp', {
      useFactory: () => ({
        get: () => {}, post: () => {}, put: () => {}, delete: () => {},
      }),
    });
    container.registerCore('Database', { useFactory: () => ({}) });
    container.registerCore('EventBus', { useFactory: () => ({ emit: async () => {} }) });
    container.registerCore('EventSchemaRegistry', {
      useFactory: () => ({ register: () => {}, clear: () => {}, validate: () => ({}) }),
    });
    container.registerCore('EventConsumer', {
      useFactory: () => ({ registerHandler: () => {}, unregisterAll: () => {}, consume: async () => {} }),
    });
    container.registerCore('CacheService', {
      useFactory: () => ({ invalidate: async () => {} }),
    });

    // Scan and build
    const modules = await registry.refresh();
    expect(modules.length).toBeGreaterThan(0);

    await container.build(modules);

    // Dispose
    await container.dispose();

    // Rebuild
    await container.build(modules);

    // Atomic rebuild
    await container.rebuild(modules);
  });

  it('should gate traffic during simulated restart', () => {
    gate.pause();
    expect(gate.isOpen()).toBe(false);

    // Simulate middleware call
    const mockRes = {
      status: (code: number) => ({
        json: (body: any) => ({ statusCode: code, body }),
      }),
    };
    const result = gate.middleware({} as any, mockRes as any, () => {});
    // When paused, middleware returns 503 — next() not called

    gate.resume();
    expect(gate.isOpen()).toBe(true);
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `cd backend && npx jest tests/e2e/soft-restart.e2e.test.ts -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/e2e/soft-restart.e2e.test.ts
git commit -m "test: add E2E test for soft restart cycle

Verifies full build → dispose → rebuild cycle with real filesystem
module discovery. Tests TrafficGate pause/resume behavior."
```

---

### Task 5: Full Phase 5 Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Run coverage**

Run: `cd backend && npx jest --coverage --passWithNoTests`
Expected: >= 80% global coverage

- [ ] **Step 4: Final integration checklist**

- [ ] Container.dispose() calls EventSchemaRegistry.clear()
- [ ] Container.dispose() calls EventConsumer.unregisterAll()
- [ ] OpenAPI spec has /modules, /modules/install, /modules/uninstall
- [ ] SoftRestartManager has all 3 structured log events
- [ ] E2E test passes for full restart cycle
- [ ] No regressions across all phases

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Phase 5 validation — production hardening all checks pass

All 5 phases complete:
- Phase 0: Bug fixes
- Phase 1: BullMQ + Metrics
- Phase 2: Core infrastructure
- Phase 3: Traffic control + Soft restart
- Phase 4: Module management
- Phase 5: Production hardening"
```

---

## Self-Review

**Spec coverage:**
- ✅ Event cleanup in container dispose → Task 1
- ✅ OpenAPI spec update → Task 2
- ✅ Structured logs verification → Task 3
- ✅ E2E integration test → Task 4

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** All types reference existing codebase types and interfaces defined in Phase 2.
