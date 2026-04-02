# Phase 7: Hook System (Extension Points) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Hook System per Architecture v2.2 §16 — deterministic extension points with priority ordering, timeout guards, fail-safe semantics, and build-time conflict detection.

**Architecture:** `HookRegistry` stores hooks by `point:phase` key. `HookExecutor` runs hooks sorted by priority with per-handler timeout and fail-safe error handling. `ConflictDetector` validates no duplicate registrations at build time. Container integrates via `pendingHooks` from ModuleDefinition (Phase 6).

**Tech Stack:** TypeScript, Jest, Node.js crypto (UUID), Pino logger

**Spec Reference:** `docs/architecture/erp-platform-full-spec.md` Part B, `Architecture-v2.2.md` §16

**Prerequisite:** Phase 6 complete — `IModule`, `ModuleFactory`, `ModuleDefinition` (with `hooks?` field), `container.build()` stores `pendingHooks`

---

## Assumed State After Phase 6

| Component | Exists? | Notes |
|-----------|---------|-------|
| `IModule` interface | ✅ | `name`, `onInit()`, `onDestroy()` |
| `ModuleFactory` interface | ✅ | `create(container) → ModuleDefinition` |
| `ModuleDefinition.hooks?` | ✅ | `HookRegistrationStub[]` (Phase 6 created stub) |
| `container.pendingHooks` | ✅ | Stores hooks from ModuleDefinition during build |
| `container.build()` | ✅ | Calls `module.onInit()`, stores pendingHooks |
| `container.dispose()` | ✅ | Clears module state |
| `HookRegistrationStub` | ✅ | Stub interface in container.ts (Phase 6) |

**What Phase 7 does:** Replace `HookRegistrationStub` with full hook types, build `HookRegistry` + `HookExecutor` + `ConflictDetector`, wire into container build/dispose lifecycle.

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/hooks/types.ts` | Create | HookPoint, HookHandler, HookContext, HookRegistration interfaces |
| `backend/src/core/hooks/hook-registry.ts` | Create | Store + lookup + clear hooks by point/phase/module/plugin |
| `backend/src/core/hooks/hook-executor.ts` | Create | Priority sort + timeout + fail-safe execution |
| `backend/src/core/hooks/conflict-detector.ts` | Create | Build-time duplicate detection |
| `backend/src/core/hooks/index.ts` | Create | Barrel export |
| `backend/tests/core/hooks/hook-registry.test.ts` | Create | Registry unit tests |
| `backend/tests/core/hooks/hook-executor.test.ts` | Create | Executor unit tests |
| `backend/tests/core/hooks/conflict-detector.test.ts` | Create | Conflict detection tests |
| `backend/src/core/di/container.ts` | Modify | Replace HookRegistrationStub with HookRegistration, integrate HookRegistry |
| `backend/src/main.ts` | Modify | Wire HookRegistry + HookExecutor as core providers |

---

### Task 1: Define Hook Types

**Files:**
- Create: `backend/src/core/hooks/types.ts`

- [ ] **Step 1: Write the failing test for type contracts**

```typescript
// backend/tests/core/hooks/hook-registry.test.ts
import { describe, it, expect } from '@jest/globals';

describe('Hook types contract', () => {
  it('should define valid HookPoint shape', () => {
    const point = {
      name: 'order.beforeCreate',
      phase: 'pre' as const,
      timeout: 3000,
      failSafe: true,
    };

    expect(point.name).toBe('order.beforeCreate');
    expect(point.phase).toBe('pre');
    expect(point.timeout).toBe(3000);
    expect(point.failSafe).toBe(true);
  });

  it('should define valid HookContext shape', () => {
    const ctx = {
      data: { orderId: '123' },
      result: undefined,
      stopPropagation: false,
      metadata: {
        point: 'order.beforeCreate',
        phase: 'pre' as const,
        executionId: 'uuid-123',
      },
    };

    expect(ctx.data.orderId).toBe('123');
    expect(ctx.stopPropagation).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (types are structural)**

Run: `cd backend && npx jest tests/core/hooks/hook-registry.test.ts -t "types contract" -v`
Expected: PASS

- [ ] **Step 3: Create types file**

```typescript
// backend/src/core/hooks/types.ts

interface HookPoint {
  name: string;              // "order.beforeCreate"
  phase: 'pre' | 'post';
  timeout?: number;          // default: 5000ms
  failSafe?: boolean;        // default: true (continue on failure)
}

interface HookHandler {
  plugin?: string;
  module?: string;
  priority?: number;         // lower = runs first, default: 100
  handler: (context: HookContext) => Promise<void>;
}

interface HookContext {
  data: any;
  result?: any;
  stopPropagation?: boolean;
  metadata: {
    point: string;
    phase: 'pre' | 'post';
    executionId: string;
  };
}

interface HookRegistration {
  point: string;             // "order.beforeCreate"
  phase: 'pre' | 'post';
  handler: (ctx: HookContext) => Promise<void>;
  plugin?: string;
  module?: string;
  priority?: number;
  timeout?: number;
  failSafe?: boolean;
}

export type { HookPoint, HookHandler, HookContext, HookRegistration };
```

- [ ] **Step 4: Run test to verify**

Run: `cd backend && npx jest tests/core/hooks/hook-registry.test.ts -t "types contract" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/hooks/types.ts backend/tests/core/hooks/hook-registry.test.ts
git commit -m "feat: add HookPoint, HookHandler, HookContext, HookRegistration types

Define contracts for the hook system per Architecture v2.2 §16:
- HookPoint: named extension point with timeout + failSafe config
- HookHandler: handler with priority + source tracking
- HookContext: data carrier with stopPropagation support
- HookRegistration: combines point + handler + config"
```

---

### Task 2: Implement HookRegistry

**Files:**
- Create: `backend/src/core/hooks/hook-registry.ts`
- Test: `backend/tests/core/hooks/hook-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Add to backend/tests/core/hooks/hook-registry.test.ts

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HookRegistry } from '@core/hooks/hook-registry';
import type { HookRegistration, HookPoint } from '@core/hooks/types';

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe('registerPoint()', () => {
    it('should register a hook point', () => {
      const point: HookPoint = {
        name: 'order.beforeCreate',
        phase: 'pre',
        timeout: 3000,
        failSafe: true,
      };

      registry.registerPoint(point);

      expect(registry.getPoint('order.beforeCreate')).toEqual(point);
    });

    it('should overwrite existing point with same name', () => {
      const point1: HookPoint = { name: 'order.beforeCreate', phase: 'pre', timeout: 3000 };
      const point2: HookPoint = { name: 'order.beforeCreate', phase: 'pre', timeout: 5000 };

      registry.registerPoint(point1);
      registry.registerPoint(point2);

      expect(registry.getPoint('order.beforeCreate')?.timeout).toBe(5000);
    });
  });

  describe('register()', () => {
    it('should register a hook handler', () => {
      const hook: HookRegistration = {
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
        priority: 50,
      };

      registry.register(hook);

      const hooks = registry.getHooks('order.beforeCreate', 'pre');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].module).toBe('voucher');
    });

    it('should allow multiple hooks on same point:phase', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
        priority: 50,
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'inventory',
        priority: 60,
      });

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(2);
    });

    it('should separate hooks by phase', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'post',
        handler: async () => {},
        module: 'notification',
      });

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);
      expect(registry.getHooks('order.beforeCreate', 'post')).toHaveLength(1);
    });
  });

  describe('getHooks()', () => {
    it('should return empty array for unknown point', () => {
      expect(registry.getHooks('unknown.point', 'pre')).toEqual([]);
    });
  });

  describe('clearByModule()', () => {
    it('should remove all hooks registered by a module', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.afterCreate',
        phase: 'post',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'inventory',
      });

      registry.clearByModule('voucher');

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);
      expect(registry.getHooks('order.afterCreate', 'post')).toHaveLength(0);
      expect(registry.getHooks('order.beforeCreate', 'pre')[0].module).toBe('inventory');
    });
  });

  describe('clearByPlugin()', () => {
    it('should remove all hooks registered by a plugin', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        plugin: 'analytics',
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'inventory',
      });

      registry.clearByPlugin('analytics');

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);
      expect(registry.getHooks('order.beforeCreate', 'pre')[0].module).toBe('inventory');
    });
  });

  describe('clear()', () => {
    it('should remove all hooks', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.afterCreate',
        phase: 'post',
        handler: async () => {},
        module: 'notification',
      });

      registry.clear();

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(0);
      expect(registry.getHooks('order.afterCreate', 'post')).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/hooks/hook-registry.test.ts -v`
Expected: FAIL — `HookRegistry` not found

- [ ] **Step 3: Create HookRegistry implementation**

```typescript
// backend/src/core/hooks/hook-registry.ts
import type { HookPoint, HookRegistration } from './types';

class HookRegistry {
  private points = new Map<string, HookPoint>();
  private hooks = new Map<string, HookRegistration[]>();

  registerPoint(point: HookPoint): void {
    this.points.set(point.name, point);
  }

  getPoint(name: string): HookPoint | undefined {
    return this.points.get(name);
  }

  register(hook: HookRegistration): void {
    const key = `${hook.point}:${hook.phase}`;
    const list = this.hooks.get(key) ?? [];
    list.push(hook);
    this.hooks.set(key, list);
  }

  getHooks(pointName: string, phase: 'pre' | 'post'): HookRegistration[] {
    return this.hooks.get(`${pointName}:${phase}`) ?? [];
  }

  getAllHooks(): HookRegistration[] {
    const result: HookRegistration[] = [];
    for (const hooks of this.hooks.values()) {
      result.push(...hooks);
    }
    return result;
  }

  clearByModule(moduleName: string): void {
    for (const [key, hooks] of this.hooks) {
      const filtered = hooks.filter(h => h.module !== moduleName);
      if (filtered.length === 0) {
        this.hooks.delete(key);
      } else {
        this.hooks.set(key, filtered);
      }
    }
  }

  clearByPlugin(pluginName: string): void {
    for (const [key, hooks] of this.hooks) {
      const filtered = hooks.filter(h => h.plugin !== pluginName);
      if (filtered.length === 0) {
        this.hooks.delete(key);
      } else {
        this.hooks.set(key, filtered);
      }
    }
  }

  clear(): void {
    this.hooks.clear();
    this.points.clear();
  }
}

export { HookRegistry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/hooks/hook-registry.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/hooks/hook-registry.ts backend/tests/core/hooks/hook-registry.test.ts
git commit -m "feat: add HookRegistry for hook storage and lookup

- registerPoint(): define named extension points
- register(): add handlers by point + phase
- getHooks(): lookup by point:phase key
- clearByModule()/clearByPlugin(): scoped cleanup for dispose
- clear(): full reset"
```

---

### Task 3: Implement HookExecutor

**Files:**
- Create: `backend/src/core/hooks/hook-executor.ts`
- Create: `backend/tests/core/hooks/hook-executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/hooks/hook-executor.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HookExecutor } from '@core/hooks/hook-executor';
import { HookRegistry } from '@core/hooks/hook-registry';
import type { HookContext, HookRegistration } from '@core/hooks/types';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('HookExecutor', () => {
  let registry: HookRegistry;
  let executor: HookExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    registry = new HookRegistry();
    executor = new HookExecutor(registry, mockLogger);
  });

  describe('execute()', () => {
    it('should execute hooks in priority order (lower first)', async () => {
      const order: number[] = [];

      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => { order.push(100); },
        priority: 100,
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => { order.push(50); },
        priority: 50,
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => { order.push(75); },
        priority: 75,
      });

      await executor.execute('order.beforeCreate', 'pre', {});

      expect(order).toEqual([50, 75, 100]);
    });

    it('should default priority to 100 when not specified', async () => {
      const order: string[] = [];

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => { order.push('default'); },
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => { order.push('explicit-50'); },
        priority: 50,
      });

      await executor.execute('test', 'pre', {});

      expect(order).toEqual(['explicit-50', 'default']);
    });

    it('should pass data through context', async () => {
      let receivedData: any;

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          receivedData = ctx.data;
        },
      });

      await executor.execute('test', 'pre', { orderId: '123' });

      expect(receivedData).toEqual({ orderId: '123' });
    });

    it('should allow hooks to modify context data', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          ctx.data.discount = 0.1;
        },
        priority: 10,
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          ctx.data.vat = 0.08;
        },
        priority: 20,
      });

      const ctx = await executor.execute('test', 'pre', { price: 100 });

      expect(ctx.data).toEqual({ price: 100, discount: 0.1, vat: 0.08 });
    });

    it('should stop propagation when stopPropagation is set', async () => {
      const executed: string[] = [];

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          executed.push('first');
          ctx.stopPropagation = true;
        },
        priority: 10,
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          executed.push('second');
        },
        priority: 20,
      });

      await executor.execute('test', 'pre', {});

      expect(executed).toEqual(['first']);
    });

    it('should continue on error when failSafe is true (default)', async () => {
      const executed: string[] = [];

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          throw new Error('hook failed');
        },
        priority: 10,
        failSafe: true,
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          executed.push('second');
        },
        priority: 20,
      });

      await executor.execute('test', 'pre', {});

      expect(executed).toEqual(['second']);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw on error when failSafe is false', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          throw new Error('hook failed');
        },
        failSafe: false,
      });

      await expect(executor.execute('test', 'pre', {})).rejects.toThrow('hook failed');
    });

    it('should timeout handler that takes too long', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10_000));
        },
        timeout: 50,
        failSafe: true,
      });

      // Should not throw because failSafe=true
      const ctx = await executor.execute('test', 'pre', {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({}),
        'Hook execution failed',
      );
    });

    it('should timeout and throw when failSafe is false', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10_000));
        },
        timeout: 50,
        failSafe: false,
      });

      await expect(executor.execute('test', 'pre', {})).rejects.toThrow();
    });

    it('should use point timeout as default when handler timeout not set', async () => {
      registry.registerPoint({
        name: 'test',
        phase: 'pre',
        timeout: 50,
        failSafe: true,
      });

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10_000));
        },
        // No timeout — should use point's 50ms
      });

      const ctx = await executor.execute('test', 'pre', {});

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return context with result', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          ctx.result = { calculated: true };
        },
      });

      const ctx = await executor.execute('test', 'pre', {});

      expect(ctx.result).toEqual({ calculated: true });
    });

    it('should generate unique executionId', async () => {
      let execId1: string;
      let execId2: string;

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          if (!execId1) execId1 = ctx.metadata.executionId;
          else execId2 = ctx.metadata.executionId;
        },
      });

      await executor.execute('test', 'pre', {});
      await executor.execute('test', 'pre', {});

      expect(execId1!).not.toBe(execId2!);
    });

    it('should return empty context when no hooks registered', async () => {
      const ctx = await executor.execute('nonexistent', 'pre', { data: 1 });

      expect(ctx.data).toEqual({ data: 1 });
      expect(ctx.result).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/hooks/hook-executor.test.ts -v`
Expected: FAIL — `HookExecutor` not found

- [ ] **Step 3: Create HookExecutor implementation**

```typescript
// backend/src/core/hooks/hook-executor.ts
import { randomUUID } from 'node:crypto';
import type { HookContext, HookRegistration } from './types';
import type { HookRegistry } from './hook-registry';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class HookExecutor {
  constructor(
    private registry: HookRegistry,
    private logger: Logger,
  ) {}

  async execute(pointName: string, phase: 'pre' | 'post', data: any): Promise<HookContext> {
    const point = this.registry.getPoint(pointName);
    const hooks = this.registry.getHooks(pointName, phase);

    if (hooks.length === 0) {
      return {
        data,
        result: undefined,
        stopPropagation: false,
        metadata: { point: pointName, phase, executionId: randomUUID() },
      };
    }

    const sorted = [...hooks].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const ctx: HookContext = {
      data,
      result: undefined,
      stopPropagation: false,
      metadata: {
        point: pointName,
        phase,
        executionId: randomUUID(),
      },
    };

    for (const hook of sorted) {
      const timeout = hook.timeout ?? point?.timeout ?? 5000;
      const failSafe = hook.failSafe ?? point?.failSafe ?? true;

      try {
        await Promise.race([
          hook.handler(ctx),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Hook timeout: ${pointName}:${phase} after ${timeout}ms`)),
              timeout,
            ),
          ),
        ]);

        if (ctx.stopPropagation) break;
      } catch (err) {
        this.logger.error(
          {
            err,
            point: pointName,
            phase,
            plugin: hook.plugin,
            module: hook.module,
            executionId: ctx.metadata.executionId,
          },
          'Hook execution failed',
        );

        if (!failSafe) {
          throw err;
        }
      }
    }

    return ctx;
  }
}

export { HookExecutor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/hooks/hook-executor.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/hooks/hook-executor.ts backend/tests/core/hooks/hook-executor.test.ts
git commit -m "feat: add HookExecutor with priority ordering + timeout + fail-safe

- Execute hooks sorted by priority (lower = first)
- Per-handler timeout via Promise.race (default 5s)
- Fail-safe: log error + continue (default)
- Non-fail-safe: throw on error
- stopPropagation support
- Unique executionId per call
- Uses point timeout as fallback when handler has none"
```

---

### Task 4: Implement ConflictDetector

**Files:**
- Create: `backend/src/core/hooks/conflict-detector.ts`
- Create: `backend/tests/core/hooks/conflict-detector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/hooks/conflict-detector.test.ts
import { describe, it, expect } from '@jest/globals';
import { detectHookConflicts } from '@core/hooks/conflict-detector';
import type { HookRegistration } from '@core/hooks/types';

describe('detectHookConflicts', () => {
  it('should pass when no hooks', () => {
    expect(() => detectHookConflicts([])).not.toThrow();
  });

  it('should pass when different modules register on same point', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'inventory' },
    ];

    expect(() => detectHookConflicts(hooks)).not.toThrow();
  });

  it('should pass when different plugins register on same point', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'analytics' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'voucher' },
    ];

    expect(() => detectHookConflicts(hooks)).not.toThrow();
  });

  it('should detect duplicate module registration on same point:phase', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
    ];

    expect(() => detectHookConflicts(hooks)).toThrow(/duplicate/i);
  });

  it('should detect duplicate plugin registration on same point:phase', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'analytics' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'analytics' },
    ];

    expect(() => detectHookConflicts(hooks)).toThrow(/duplicate/i);
  });

  it('should allow same module on different point:phase combinations', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
      { point: 'order.beforeCreate', phase: 'post', handler: async () => {}, module: 'voucher' },
      { point: 'order.afterCreate', phase: 'post', handler: async () => {}, module: 'voucher' },
    ];

    expect(() => detectHookConflicts(hooks)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/hooks/conflict-detector.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create ConflictDetector**

```typescript
// backend/src/core/hooks/conflict-detector.ts
import type { HookRegistration } from './types';

function detectHookConflicts(hooks: HookRegistration[]): void {
  const byPointPhase = new Map<string, HookRegistration[]>();

  for (const hook of hooks) {
    const key = `${hook.point}:${hook.phase}`;
    const list = byPointPhase.get(key) ?? [];
    list.push(hook);
    byPointPhase.set(key, list);
  }

  for (const [key, registrations] of byPointPhase) {
    const sources = registrations.map(r => {
      if (r.plugin) return `plugin:${r.plugin}`;
      if (r.module) return `module:${r.module}`;
      return 'unknown';
    });

    const seen = new Set<string>();
    for (const source of sources) {
      if (source === 'unknown') continue;
      if (seen.has(source)) {
        throw new Error(`Duplicate hook registration: ${source} on ${key}`);
      }
      seen.add(source);
    }
  }
}

export { detectHookConflicts };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/hooks/conflict-detector.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/hooks/conflict-detector.ts backend/tests/core/hooks/conflict-detector.test.ts
git commit -m "feat: add hook conflict detection at build time

Detects duplicate hook registrations (same module/plugin on same
point:phase). Different modules/plugins on same point are allowed."
```

---

### Task 5: Create Barrel Export + Replace HookRegistrationStub

**Files:**
- Create: `backend/src/core/hooks/index.ts`
- Modify: `backend/src/core/di/container.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// backend/src/core/hooks/index.ts
export { HookRegistry } from './hook-registry';
export { HookExecutor } from './hook-executor';
export { detectHookConflicts } from './conflict-detector';
export type { HookPoint, HookHandler, HookContext, HookRegistration } from './types';
```

- [ ] **Step 2: Replace HookRegistrationStub with HookRegistration in container.ts**

In `backend/src/core/di/container.ts`, find the `HookRegistrationStub` interface and replace:

```typescript
// REMOVE:
interface HookRegistrationStub {
  point: string;
  phase: 'pre' | 'post';
  handler: (ctx: any) => Promise<void>;
  priority?: number;
}

// ADD import at top:
import type { HookRegistration } from '@core/hooks/types';

// REPLACE all references:
// - private pendingHooks: HookRegistrationStub[] → private pendingHooks: HookRegistration[] = [];
// - getPendingHooks(): HookRegistrationStub[] → getPendingHooks(): HookRegistration[]
// - ModuleDefinition.hooks?: HookRegistrationStub[] → hooks?: HookRegistration[]
```

Update `ModuleDefinition`:

```typescript
interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];
  hooks?: HookRegistration[];  // Changed from HookRegistrationStub
}
```

- [ ] **Step 3: Run existing tests to verify no breakage**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/core/hooks/index.ts backend/src/core/di/container.ts
git commit -m "feat: replace HookRegistrationStub with HookRegistration in container

Container now imports real hook types from @core/hooks/types.
ModuleDefinition.hooks uses HookRegistration instead of stub.
Barrel export created for hooks module."
```

---

### Task 6: Integrate HookRegistry into Container Build/Dispose

**Files:**
- Modify: `backend/src/core/di/container.ts`

- [ ] **Step 1: Write failing test for hook integration**

```typescript
// Add to backend/tests/core/di/container.test.ts

describe('DIContainer hook integration', () => {
  it('should register hooks from ModuleDefinition during build', async () => {
    const container = new DIContainer();
    container.registerCore('HookRegistry', {
      useFactory: () => new (require('@core/hooks/hook-registry').HookRegistry)(),
    });

    const hookHandler = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const mockFactory: ModuleFactory = {
      create: async () => ({
        module: {
          name: 'test',
          onInit: async () => {},
          onDestroy: async () => {},
        },
        providers: [],
        exports: ['ITestService'],
        hooks: [
          {
            point: 'order.beforeCreate',
            phase: 'pre',
            handler: hookHandler,
            module: 'test',
            priority: 50,
          },
        ],
      }),
    };

    const metadata: ModuleMetadata = {
      name: 'test',
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => ({ default: mockFactory }),
      manifest: { name: 'test', version: '2026.04.01', enabled: true },
    };

    await container.build([metadata]);

    const registry = container.get<HookRegistry>('HookRegistry');
    const hooks = registry.getHooks('order.beforeCreate', 'pre');

    expect(hooks).toHaveLength(1);
    expect(hooks[0].module).toBe('test');
    expect(hooks[0].priority).toBe(50);
  });

  it('should clear hooks by module on dispose', async () => {
    const container = new DIContainer();
    container.registerCore('HookRegistry', {
      useFactory: () => new (require('@core/hooks/hook-registry').HookRegistry)(),
    });

    const mockFactory: ModuleFactory = {
      create: async () => ({
        module: { name: 'test', onInit: async () => {}, onDestroy: async () => {} },
        providers: [],
        exports: ['ITestService'],
        hooks: [
          { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'test' },
        ],
      }),
    };

    await container.build([{
      name: 'test', version: '2026.04.01', enabled: true, dependencies: [],
      entry: async () => ({ default: mockFactory }),
      manifest: { name: 'test', version: '2026.04.01', enabled: true },
    }]);

    const registry = container.get<HookRegistry>('HookRegistry');
    expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);

    await container.dispose();

    expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/di/container.test.ts -t "hook integration" -v`
Expected: FAIL — hooks not registered during build, not cleared during dispose

- [ ] **Step 3: Update container.build() to register hooks**

In `backend/src/core/di/container.ts`, in the `build()` method, after the module `onInit()` loop, add:

```typescript
// After: for (const m of this.modules) { await m.onInit(); }

// Register hooks from ModuleDefinitions
const hookRegistry = this.coreInstances.get('HookRegistry') as import('@core/hooks/hook-registry').HookRegistry | undefined;
if (hookRegistry) {
  for (const hook of this.pendingHooks) {
    hookRegistry.register(hook);
  }
}
this.pendingHooks = [];
```

- [ ] **Step 4: Update container.dispose() to clear hooks**

In the `disposeInternal()` method, before clearing module state, add:

```typescript
// Before: this.moduleInstances.clear();

// Clear hooks by module name
const hookRegistry = this.coreInstances.get('HookRegistry') as import('@core/hooks/hook-registry').HookRegistry | undefined;
if (hookRegistry) {
  for (const mod of this.modules) {
    hookRegistry.clearByModule(mod.name);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/core/di/container.ts backend/tests/core/di/container.test.ts
git commit -m "feat: integrate HookRegistry into container build/dispose lifecycle

- build(): registers hooks from ModuleDefinition after module.onInit()
- dispose(): clears hooks by module name before clearing state
- Hooks from pendingHooks array flushed to registry during build"
```

---

### Task 7: Wire HookRegistry + HookExecutor in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Register HookRegistry + HookExecutor as core providers**

In `backend/src/main.ts`, add imports and core registrations:

```typescript
import { HookRegistry } from '@core/hooks/hook-registry';
import { HookExecutor } from '@core/hooks/hook-executor';
import { detectHookConflicts } from '@core/hooks/conflict-detector';

// In the core provider registration section:
container.registerCore('HookRegistry', {
  useFactory: () => new HookRegistry(),
});
container.registerCore('HookExecutor', {
  useFactory: () => new HookExecutor(
    container.get('HookRegistry'),
    logger,
  ),
  deps: ['HookRegistry'],
});
```

- [ ] **Step 2: Add conflict detection after container.build()**

After `await container.build(registry.getActive())`:

```typescript
// Detect hook conflicts at build time
const hookRegistry = container.get<HookRegistry>('HookRegistry');
detectHookConflicts(hookRegistry.getAllHooks());
```

- [ ] **Step 3: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire HookRegistry + HookExecutor in bootstrap

- HookRegistry registered as core provider
- HookExecutor created with logger dependency
- Conflict detection runs after container.build()"
```

---

### Task 8: Full Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Manual verification checklist**

- [ ] `HookPoint` has `name`, `phase`, `timeout?`, `failSafe?`
- [ ] `HookHandler` has `plugin?`, `module?`, `priority?`, `handler`
- [ ] `HookContext` has `data`, `result?`, `stopPropagation?`, `metadata`
- [ ] `HookRegistration` has `point`, `phase`, `handler`, `plugin?`, `module?`, `priority?`, `timeout?`, `failSafe?`
- [ ] `HookRegistry.registerPoint()` stores points
- [ ] `HookRegistry.register()` stores hooks by `point:phase` key
- [ ] `HookRegistry.getHooks()` returns hooks for point:phase
- [ ] `HookRegistry.clearByModule()` removes module hooks
- [ ] `HookRegistry.clearByPlugin()` removes plugin hooks
- [ ] `HookExecutor.execute()` sorts by priority ascending
- [ ] `HookExecutor.execute()` applies timeout per handler
- [ ] `HookExecutor.execute()` continues on fail-safe error
- [ ] `HookExecutor.execute()` throws on non-fail-safe error
- [ ] `HookExecutor.execute()` stops on `stopPropagation`
- [ ] `detectHookConflicts()` throws on duplicate module/plugin
- [ ] Container `build()` registers hooks from ModuleDefinition
- [ ] Container `dispose()` clears hooks by module name
- [ ] `main.ts` wires HookRegistry + HookExecutor

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 7 validation — Hook System all checks pass"
```

---

## Self-Review

**Spec coverage (Part B of erp-platform-full-spec.md):**
- ✅ B.2 Interfaces (HookPoint, HookHandler, HookContext, HookRegistration) → Task 1
- ✅ B.3 HookRegistry → Task 2
- ✅ B.4 HookExecutor → Task 3
- ✅ B.5 Container Integration → Task 6
- ✅ B.7 Conflict Detection → Task 4
- ✅ Barrel export + type replacement → Task 5
- ✅ Bootstrap wiring → Task 7

**Architecture v2.2 §16 compliance:**
- ✅ Hooks have timeout (default 5s)
- ✅ Hooks are fail-safe by default
- ✅ Priority ordering (lower = higher priority)
- ✅ Pre-hooks can reject via stopPropagation
- ✅ Plugin crash in hook does not crash system (fail-safe)

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `HookRegistration` defined in Task 1, used consistently in Tasks 2–7. Container's `pendingHooks` field type matches.
