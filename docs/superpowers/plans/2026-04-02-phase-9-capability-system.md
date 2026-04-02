# Phase 9: Capability System (Pipeline Architecture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement capability-driven pipelines for business-critical flows — replace free-form hooks with structured, deterministic capability execution (pricing pipeline as first real example).

**Architecture:** `CapabilityRegistry` stores capabilities (pipeline/single/composable) and their handlers. `CapabilityExecutor` runs handlers sorted by stage order then priority. `ConflictDetector` validates at build time. Container integrates via `pendingCapabilities` from ModuleDefinition. Pricing pipeline: base → discount → tax → rounding → final.

**Tech Stack:** TypeScript, Jest, Pino logger, Zod (context schemas)

**Spec Reference:** `docs/architecture/erp-platform-full-spec.md` Part D

**Prerequisite:** Phase 6 (ModuleFactory) + Phase 7 (Hook System) + Phase 8 (Order + Inventory) complete

---

## Assumed State

| Component | Exists? | Notes |
|-----------|---------|-------|
| `ModuleDefinition` | ✅ | Phase 6 — has `providers`, `exports`, `hooks` |
| `HookRegistry` + `HookExecutor` | ✅ | Phase 7 — generic extension points |
| `IProductService` | ✅ | Phase 6 — exported from product module |
| `IInventoryService` | ✅ | Phase 8 — exported from inventory module |
| `IOrderService` | ✅ | Phase 8 — exported from order module |
| `DIContainer` with `build()` | ✅ | Phase 6 — registers providers, hooks |
| `Logger` | ✅ | Existing — `core/logging/logger.ts` |

**What Phase 9 does:** Build Capability System (types, registry, executor, conflict detector), add `capabilities` field to `ModuleDefinition`, wire in container build/dispose, implement pricing pipeline as first real capability.

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/capability/types.ts` | Create | Capability, CapabilityHandler, CapabilityContext interfaces |
| `backend/src/core/capability/capability-registry.ts` | Create | Store + lookup capabilities and handlers |
| `backend/src/core/capability/capability-executor.ts` | Create | Pipeline/single/composable execution engine |
| `backend/src/core/capability/conflict-detector.ts` | Create | Build-time validation |
| `backend/src/core/capability/index.ts` | Create | Barrel export |
| `backend/tests/core/capability/capability-registry.test.ts` | Create | Registry unit tests |
| `backend/tests/core/capability/capability-executor.test.ts` | Create | Executor unit tests |
| `backend/tests/core/capability/conflict-detector.test.ts` | Create | Conflict detection tests |
| `backend/src/modules/product/capabilities/pricing.capability.ts` | Create | Pricing pipeline definition + handlers |
| `backend/src/core/di/container.ts` | Modify | Add capabilities field + pendingCapabilities |
| `backend/src/main.ts` | Modify | Wire CapabilityRegistry + CapabilityExecutor |

---

### Task 1: Define Capability Types

**Files:**
- Create: `backend/src/core/capability/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// backend/src/core/capability/types.ts

interface Capability {
  name: string;              // "pricing"
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];         // For pipeline: ['base', 'discount', 'tax', 'rounding', 'final']
}

interface CapabilityHandler {
  capability: string;        // "pricing"
  stage?: string;            // "discount" (required for pipeline type)
  priority?: number;         // lower = first within same stage, default: 100
  exclusive?: boolean;       // Only one handler allowed for this capability
  condition?: (ctx: CapabilityContext) => boolean;
  plugin?: string;
  module?: string;
  handle: (ctx: CapabilityContext) => Promise<void>;
}

interface CapabilityContext {
  input: any;
  state: Record<string, any>;
  result?: any;
  stop?: boolean;
}

export type { Capability, CapabilityHandler, CapabilityContext };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/core/capability/types.ts
git commit -m "feat: add Capability, CapabilityHandler, CapabilityContext types

Define contracts for capability-driven pipeline system:
- Capability: name + type (pipeline/single/composable) + stages
- CapabilityHandler: handler with stage, priority, condition, source tracking
- CapabilityContext: input + state + result + stop propagation"
```

---

### Task 2: Implement CapabilityRegistry

**Files:**
- Create: `backend/src/core/capability/capability-registry.ts`
- Create: `backend/tests/core/capability/capability-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/capability/capability-registry.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CapabilityRegistry } from '@core/capability/capability-registry';
import type { Capability, CapabilityHandler } from '@core/capability/types';

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  describe('registerCapability()', () => {
    it('should register a capability', () => {
      const cap: Capability = {
        name: 'pricing',
        type: 'pipeline',
        stages: ['base', 'discount', 'tax', 'final'],
      };

      registry.registerCapability(cap);

      expect(registry.getCapability('pricing')).toEqual(cap);
    });

    it('should throw on duplicate capability name', () => {
      const cap: Capability = { name: 'pricing', type: 'pipeline' };

      registry.registerCapability(cap);

      expect(() => registry.registerCapability(cap)).toThrow(/already registered/i);
    });
  });

  describe('registerHandler()', () => {
    it('should register a handler for existing capability', () => {
      registry.registerCapability({ name: 'pricing', type: 'pipeline', stages: ['base', 'discount'] });

      const handler: CapabilityHandler = {
        capability: 'pricing',
        stage: 'base',
        handle: async () => {},
      };

      registry.registerHandler(handler);

      expect(registry.getHandlers('pricing')).toHaveLength(1);
    });

    it('should throw when registering handler for non-existent capability', () => {
      const handler: CapabilityHandler = {
        capability: 'nonexistent',
        handle: async () => {},
      };

      expect(() => registry.registerHandler(handler)).toThrow(/not found/i);
    });

    it('should throw on invalid stage for pipeline capability', () => {
      registry.registerCapability({
        name: 'pricing',
        type: 'pipeline',
        stages: ['base', 'discount', 'tax'],
      });

      const handler: CapabilityHandler = {
        capability: 'pricing',
        stage: 'invalid-stage',
        handle: async () => {},
      };

      expect(() => registry.registerHandler(handler)).toThrow(/invalid stage/i);
    });

    it('should allow handlers without stage for non-pipeline capabilities', () => {
      registry.registerCapability({ name: 'payment', type: 'single' });

      const handler: CapabilityHandler = {
        capability: 'payment',
        handle: async () => {},
      };

      expect(() => registry.registerHandler(handler)).not.toThrow();
    });

    it('should allow multiple handlers on same capability', () => {
      registry.registerCapability({ name: 'pricing', type: 'pipeline', stages: ['base', 'discount'] });

      registry.registerHandler({ capability: 'pricing', stage: 'base', handle: async () => {} });
      registry.registerHandler({ capability: 'pricing', stage: 'discount', handle: async () => {} });

      expect(registry.getHandlers('pricing')).toHaveLength(2);
    });
  });

  describe('getHandlers()', () => {
    it('should return empty array for unknown capability', () => {
      expect(registry.getHandlers('unknown')).toEqual([]);
    });
  });

  describe('clearByModule()', () => {
    it('should remove handlers registered by a module', () => {
      registry.registerCapability({ name: 'pricing', type: 'pipeline', stages: ['base', 'tax'] });

      registry.registerHandler({ capability: 'pricing', stage: 'base', module: 'product', handle: async () => {} });
      registry.registerHandler({ capability: 'pricing', stage: 'tax', module: 'tax-module', handle: async () => {} });

      registry.clearByModule('product');

      const handlers = registry.getHandlers('pricing');
      expect(handlers).toHaveLength(1);
      expect(handlers[0].module).toBe('tax-module');
    });
  });

  describe('clear()', () => {
    it('should remove all capabilities and handlers', () => {
      registry.registerCapability({ name: 'pricing', type: 'pipeline' });
      registry.registerHandler({ capability: 'pricing', handle: async () => {} });

      registry.clear();

      expect(registry.getCapability('pricing')).toBeUndefined();
      expect(registry.getHandlers('pricing')).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/capability/capability-registry.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create CapabilityRegistry**

```typescript
// backend/src/core/capability/capability-registry.ts
import type { Capability, CapabilityHandler } from './types';

class CapabilityRegistry {
  private capabilities = new Map<string, Capability>();
  private handlers = new Map<string, CapabilityHandler[]>();

  registerCapability(cap: Capability): void {
    if (this.capabilities.has(cap.name)) {
      throw new Error(`Capability "${cap.name}" already registered`);
    }
    this.capabilities.set(cap.name, cap);
  }

  registerHandler(handler: CapabilityHandler): void {
    const cap = this.capabilities.get(handler.capability);
    if (!cap) {
      throw new Error(`Capability "${handler.capability}" not found`);
    }

    // Validate stage for pipeline
    if (cap.type === 'pipeline' && handler.stage && cap.stages && !cap.stages.includes(handler.stage)) {
      throw new Error(
        `Invalid stage "${handler.stage}" for capability "${cap.name}". `
        + `Valid: ${cap.stages.join(', ')}`,
      );
    }

    const list = this.handlers.get(handler.capability) ?? [];
    list.push(handler);
    this.handlers.set(handler.capability, list);
  }

  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  getHandlers(name: string): CapabilityHandler[] {
    return this.handlers.get(name) ?? [];
  }

  getAllCapabilities(): Capability[] {
    return [...this.capabilities.values()];
  }

  getAllHandlers(): CapabilityHandler[] {
    const result: CapabilityHandler[] = [];
    for (const handlers of this.handlers.values()) {
      result.push(...handlers);
    }
    return result;
  }

  clearByModule(moduleName: string): void {
    for (const [key, handlers] of this.handlers) {
      const filtered = handlers.filter(h => h.module !== moduleName);
      if (filtered.length === 0) {
        this.handlers.delete(key);
      } else {
        this.handlers.set(key, filtered);
      }
    }
  }

  clearByPlugin(pluginName: string): void {
    for (const [key, handlers] of this.handlers) {
      const filtered = handlers.filter(h => h.plugin !== pluginName);
      if (filtered.length === 0) {
        this.handlers.delete(key);
      } else {
        this.handlers.set(key, filtered);
      }
    }
  }

  clear(): void {
    this.capabilities.clear();
    this.handlers.clear();
  }
}

export { CapabilityRegistry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability/capability-registry.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/capability/capability-registry.ts backend/tests/core/capability/capability-registry.test.ts
git commit -m "feat: add CapabilityRegistry for capability and handler storage

- registerCapability(): define capabilities (pipeline/single/composable)
- registerHandler(): add handlers with stage validation for pipelines
- getCapability()/getHandlers(): lookup by name
- clearByModule()/clearByPlugin(): scoped cleanup for dispose
- clear(): full reset"
```

---

### Task 3: Implement CapabilityExecutor

**Files:**
- Create: `backend/src/core/capability/capability-executor.ts`
- Create: `backend/tests/core/capability/capability-executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/capability/capability-executor.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CapabilityExecutor } from '@core/capability/capability-executor';
import { CapabilityRegistry } from '@core/capability/capability-registry';
import type { CapabilityContext } from '@core/capability/types';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('CapabilityExecutor', () => {
  let registry: CapabilityRegistry;
  let executor: CapabilityExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new CapabilityRegistry();
    executor = new CapabilityExecutor(registry, mockLogger);
  });

  describe('execute() — pipeline', () => {
    beforeEach(() => {
      registry.registerCapability({
        name: 'pricing',
        type: 'pipeline',
        stages: ['base', 'discount', 'tax', 'final'],
      });
    });

    it('should execute handlers in stage order', async () => {
      const order: string[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'tax',
        handle: async () => { order.push('tax'); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        handle: async () => { order.push('base'); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount',
        handle: async () => { order.push('discount'); },
      });

      await executor.execute('pricing', { basePrice: 100 });

      expect(order).toEqual(['base', 'discount', 'tax']);
    });

    it('should sort by priority within same stage', async () => {
      const order: number[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'base', priority: 100,
        handle: async () => { order.push(100); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'base', priority: 10,
        handle: async () => { order.push(10); },
      });

      await executor.execute('pricing', {});

      expect(order).toEqual([10, 100]);
    });

    it('should pass input through context', async () => {
      let receivedInput: any;

      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        handle: async (ctx: CapabilityContext) => {
          receivedInput = ctx.input;
        },
      });

      await executor.execute('pricing', { basePrice: 100 });

      expect(receivedInput).toEqual({ basePrice: 100 });
    });

    it('should allow handlers to modify context state and result', async () => {
      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        handle: async (ctx: CapabilityContext) => {
          ctx.state.basePrice = ctx.input.basePrice;
          ctx.result = ctx.input.basePrice;
        },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount',
        handle: async (ctx: CapabilityContext) => {
          ctx.state.discount = 0.1;
          ctx.result = ctx.result * 0.9;
        },
      });

      const result = await executor.execute('pricing', { basePrice: 100 });

      expect(result).toBe(90);
    });

    it('should stop when ctx.stop is set', async () => {
      const executed: string[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'base', priority: 10,
        handle: async (ctx: CapabilityContext) => {
          executed.push('base');
          ctx.stop = true;
        },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount', priority: 20,
        handle: async () => { executed.push('discount'); },
      });

      await executor.execute('pricing', {});

      expect(executed).toEqual(['base']);
    });

    it('should skip handler when condition returns false', async () => {
      const executed: string[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        condition: () => false,
        handle: async () => { executed.push('base'); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount',
        handle: async () => { executed.push('discount'); },
      });

      await executor.execute('pricing', {});

      expect(executed).toEqual(['discount']);
    });

    it('should return ctx.result after pipeline completes', async () => {
      registry.registerHandler({
        capability: 'pricing', stage: 'final',
        handle: async (ctx: CapabilityContext) => {
          ctx.result = { finalPrice: 95.50 };
        },
      });

      const result = await executor.execute('pricing', {});

      expect(result).toEqual({ finalPrice: 95.50 });
    });
  });

  describe('execute() — single', () => {
    beforeEach(() => {
      registry.registerCapability({ name: 'payment', type: 'single' });
    });

    it('should execute single handler', async () => {
      registry.registerHandler({
        capability: 'payment',
        handle: async (ctx: CapabilityContext) => {
          ctx.result = { transactionId: 'txn-123' };
        },
      });

      const result = await executor.execute('payment', { amount: 100 });

      expect(result).toEqual({ transactionId: 'txn-123' });
    });

    it('should throw when no handler registered', async () => {
      await expect(executor.execute('payment', {})).rejects.toThrow(/no handler/i);
    });

    it('should throw when multiple handlers registered', async () => {
      registry.registerHandler({ capability: 'payment', handle: async () => {} });
      registry.registerHandler({ capability: 'payment', handle: async () => {} });

      await expect(executor.execute('payment', {})).rejects.toThrow(/single-type/i);
    });
  });

  describe('execute() — composable', () => {
    beforeEach(() => {
      registry.registerCapability({ name: 'analytics', type: 'composable' });
    });

    it('should execute all handlers in parallel', async () => {
      const executed: string[] = [];

      registry.registerHandler({
        capability: 'analytics',
        handle: async () => { executed.push('tracking'); },
      });
      registry.registerHandler({
        capability: 'analytics',
        handle: async () => { executed.push('logging'); },
      });

      await executor.execute('analytics', {});

      expect(executed).toHaveLength(2);
      expect(executed).toContain('tracking');
      expect(executed).toContain('logging');
    });
  });

  describe('execute() — unknown capability', () => {
    it('should throw when capability not found', async () => {
      await expect(executor.execute('nonexistent', {})).rejects.toThrow(/not found/i);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/capability/capability-executor.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create CapabilityExecutor**

```typescript
// backend/src/core/capability/capability-executor.ts
import type { Capability, CapabilityContext } from './types';
import type { CapabilityRegistry } from './capability-registry';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class CapabilityExecutor {
  constructor(
    private registry: CapabilityRegistry,
    private logger: Logger,
  ) {}

  async execute(name: string, input: any): Promise<any> {
    const cap = this.registry.getCapability(name);
    if (!cap) {
      throw new Error(`Capability "${name}" not found`);
    }

    const ctx: CapabilityContext = {
      input,
      state: {},
      result: undefined,
      stop: false,
    };

    switch (cap.type) {
      case 'pipeline':
        return this.executePipeline(name, cap, ctx);
      case 'single':
        return this.executeSingle(name, ctx);
      case 'composable':
        return this.executeComposable(name, ctx);
    }
  }

  private async executePipeline(
    name: string,
    cap: Capability,
    ctx: CapabilityContext,
  ): Promise<any> {
    const handlers = this.registry.getHandlers(name);
    const stageOrder = cap.stages ?? [];

    // Sort by stage order (per cap.stages), then by priority within stage
    const sorted = [...handlers].sort((a, b) => {
      const aIdx = stageOrder.indexOf(a.stage ?? '');
      const bIdx = stageOrder.indexOf(b.stage ?? '');
      // Unstaged handlers go last
      const aOrder = aIdx === -1 ? 999 : aIdx;
      const bOrder = bIdx === -1 ? 999 : bIdx;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.priority ?? 100) - (b.priority ?? 100);
    });

    for (const handler of sorted) {
      // Check condition
      if (handler.condition && !handler.condition(ctx)) {
        this.logger.info(
          { capability: name, stage: handler.stage, module: handler.module, plugin: handler.plugin },
          'Capability handler skipped (condition false)',
        );
        continue;
      }

      await handler.handle(ctx);

      if (ctx.stop) break;
    }

    return ctx.result;
  }

  private async executeSingle(name: string, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);

    if (handlers.length === 0) {
      throw new Error(`No handler registered for capability "${name}"`);
    }
    if (handlers.length > 1) {
      throw new Error(
        `Capability "${name}" is single-type but has ${handlers.length} handlers`,
      );
    }

    await handlers[0].handle(ctx);
    return ctx.result;
  }

  private async executeComposable(name: string, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);

    await Promise.all(handlers.map(h => h.handle(ctx)));

    return ctx.result;
  }
}

export { CapabilityExecutor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability/capability-executor.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/capability/capability-executor.ts backend/tests/core/capability/capability-executor.test.ts
git commit -m "feat: add CapabilityExecutor for pipeline/single/composable execution

- Pipeline: sort by stage order (cap.stages), then priority within stage
- Single: exactly one handler, throw on 0 or >1
- Composable: all handlers in parallel (Promise.all)
- Condition support: skip handler when condition(ctx) returns false
- Stop propagation: ctx.stop halts pipeline execution"
```

---

### Task 4: Implement ConflictDetector for Capabilities

**Files:**
- Create: `backend/src/core/capability/conflict-detector.ts`
- Create: `backend/tests/core/capability/conflict-detector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/capability/conflict-detector.test.ts
import { describe, it, expect } from '@jest/globals';
import { CapabilityRegistry } from '@core/capability/capability-registry';
import { validateCapabilities } from '@core/capability/conflict-detector';

describe('validateCapabilities', () => {
  it('should pass when no capabilities', () => {
    const registry = new CapabilityRegistry();
    expect(() => validateCapabilities(registry)).not.toThrow();
  });

  it('should pass for valid pipeline with proper stages', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({
      name: 'pricing',
      type: 'pipeline',
      stages: ['base', 'discount', 'tax'],
    });
    registry.registerHandler({ capability: 'pricing', stage: 'base', handle: async () => {} });
    registry.registerHandler({ capability: 'pricing', stage: 'tax', handle: async () => {} });

    expect(() => validateCapabilities(registry)).not.toThrow();
  });

  it('should throw when single-type has multiple handlers', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({ name: 'payment', type: 'single' });
    registry.registerHandler({ capability: 'payment', handle: async () => {} });
    registry.registerHandler({ capability: 'payment', handle: async () => {} });

    expect(() => validateCapabilities(registry)).toThrow(/single-type/i);
  });

  it('should throw when multiple exclusive handlers on same capability', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({ name: 'pricing', type: 'pipeline' });
    registry.registerHandler({ capability: 'pricing', exclusive: true, module: 'mod-a', handle: async () => {} });
    registry.registerHandler({ capability: 'pricing', exclusive: true, module: 'mod-b', handle: async () => {} });

    expect(() => validateCapabilities(registry)).toThrow(/multiple exclusive/i);
  });

  it('should throw on invalid stage for pipeline capability', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({
      name: 'pricing',
      type: 'pipeline',
      stages: ['base', 'discount'],
    });
    registry.registerHandler({ capability: 'pricing', stage: 'invalid', handle: async () => {} });

    expect(() => validateCapabilities(registry)).toThrow(/invalid stage/i);
  });

  it('should allow one exclusive handler', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({ name: 'pricing', type: 'pipeline' });
    registry.registerHandler({ capability: 'pricing', exclusive: true, handle: async () => {} });

    expect(() => validateCapabilities(registry)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/capability/conflict-detector.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create ConflictDetector**

```typescript
// backend/src/core/capability/conflict-detector.ts
import type { CapabilityRegistry } from './capability-registry';

function validateCapabilities(registry: CapabilityRegistry): void {
  const capabilities = (registry as any).capabilities as Map<string, import('./types').Capability>;

  for (const [name, cap] of capabilities) {
    const handlers = registry.getHandlers(name);

    // Single type: at most one handler
    if (cap.type === 'single' && handlers.length > 1) {
      throw new Error(
        `Capability "${name}" is single-type but has ${handlers.length} handlers`,
      );
    }

    // Exclusive check: at most one exclusive handler per capability
    const exclusive = handlers.filter(h => h.exclusive);
    if (exclusive.length > 1) {
      throw new Error(
        `Capability "${name}" has multiple exclusive handlers: `
        + exclusive.map(h => h.module ?? h.plugin ?? 'unknown').join(', '),
      );
    }

    // Pipeline stage validation
    if (cap.type === 'pipeline' && cap.stages) {
      for (const h of handlers) {
        if (h.stage && !cap.stages.includes(h.stage)) {
          throw new Error(
            `Invalid stage "${h.stage}" for capability "${name}". `
            + `Valid stages: ${cap.stages.join(', ')}`,
          );
        }
      }
    }
  }
}

export { validateCapabilities };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability/conflict-detector.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/capability/conflict-detector.ts backend/tests/core/capability/conflict-detector.test.ts
git commit -m "feat: add capability conflict detection at build time

- Single-type: at most one handler
- Exclusive: at most one exclusive handler per capability
- Pipeline: validate stage names against capability.stages"
```

---

### Task 5: Create Barrel Export + Integrate with Container

**Files:**
- Create: `backend/src/core/capability/index.ts`
- Modify: `backend/src/core/di/container.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// backend/src/core/capability/index.ts
export { CapabilityRegistry } from './capability-registry';
export { CapabilityExecutor } from './capability-executor';
export { validateCapabilities } from './conflict-detector';
export type { Capability, CapabilityHandler, CapabilityContext } from './types';
```

- [ ] **Step 2: Add capabilities to ModuleDefinition in container.ts**

In `backend/src/core/di/container.ts`, update `ModuleDefinition`:

```typescript
interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];
  hooks?: HookRegistration[];
  capabilities?: CapabilityHandlerStub[];  // NEW — handlers this module provides
}
```

Add stub type (will be replaced with real import in Task 6):

```typescript
// Stub — replaced by real import from @core/capability/types
interface CapabilityHandlerStub {
  capability: string;
  stage?: string;
  priority?: number;
  exclusive?: boolean;
  module?: string;
  handle: (ctx: any) => Promise<void>;
}
```

Add `pendingCapabilities` field:

```typescript
private pendingCapabilities: CapabilityHandlerStub[] = [];
```

In `build()` — after storing pendingHooks, store capabilities:

```typescript
// Store capabilities from ModuleDefinition
if (def.capabilities) {
  this.pendingCapabilities.push(...def.capabilities);
}
```

After module.onInit() loop — register capabilities:

```typescript
// Register capabilities from ModuleDefinitions
const capabilityRegistry = this.coreInstances.get('CapabilityRegistry') as import('@core/capability/capability-registry').CapabilityRegistry | undefined;
if (capabilityRegistry) {
  for (const handler of this.pendingCapabilities) {
    capabilityRegistry.registerHandler(handler);
  }
}
this.pendingCapabilities = [];
```

In `disposeInternal()` — clear capabilities by module:

```typescript
// Clear capabilities by module name
const capabilityRegistry = this.coreInstances.get('CapabilityRegistry') as import('@core/capability/capability-registry').CapabilityRegistry | undefined;
if (capabilityRegistry) {
  for (const mod of this.modules) {
    capabilityRegistry.clearByModule(mod.name);
  }
}
```

- [ ] **Step 3: Run existing tests to verify no breakage**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/core/capability/index.ts backend/src/core/di/container.ts
git commit -m "feat: integrate CapabilityRegistry into container build/dispose lifecycle

- ModuleDefinition gains capabilities? field for handler declarations
- build() registers capability handlers after module.onInit()
- dispose() clears capabilities by module name
- Barrel export created for capability module"
```

---

### Task 6: Implement Pricing Pipeline (Real Example)

**Files:**
- Create: `backend/src/modules/product/capabilities/pricing.capability.ts`

- [ ] **Step 1: Write failing test for pricing pipeline**

```typescript
// Add to backend/tests/core/capability/capability-executor.test.ts

describe('Pricing Pipeline (real example)', () => {
  it('should calculate final price through base → discount → tax pipeline', async () => {
    const registry = new CapabilityRegistry();
    const executor = new CapabilityExecutor(registry, mockLogger);

    registry.registerCapability({
      name: 'pricing',
      type: 'pipeline',
      stages: ['base', 'discount', 'tax', 'rounding', 'final'],
    });

    // Base price
    registry.registerHandler({
      capability: 'pricing',
      stage: 'base',
      priority: 10,
      module: 'product',
      handle: async (ctx) => {
        ctx.state.basePrice = ctx.input.basePrice;
        ctx.result = ctx.input.basePrice;
      },
    });

    // Discount (10%)
    registry.registerHandler({
      capability: 'pricing',
      stage: 'discount',
      priority: 50,
      module: 'product',
      handle: async (ctx) => {
        ctx.state.discount = 0.1;
        ctx.result = ctx.result * 0.9;
      },
    });

    // Tax (8%)
    registry.registerHandler({
      capability: 'pricing',
      stage: 'tax',
      priority: 50,
      module: 'product',
      handle: async (ctx) => {
        ctx.state.taxRate = 0.08;
        ctx.result = ctx.result * 1.08;
      },
    });

    // Rounding
    registry.registerHandler({
      capability: 'pricing',
      stage: 'rounding',
      priority: 50,
      module: 'product',
      handle: async (ctx) => {
        ctx.result = Math.round(ctx.result * 100) / 100;
      },
    });

    const result = await executor.execute('pricing', { basePrice: 100 });

    // 100 * 0.9 = 90, * 1.08 = 97.2, rounded = 97.20
    expect(result).toBe(97.2);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability/capability-executor.test.ts -t "Pricing Pipeline" -v`
Expected: PASS (executor already works — this tests the pipeline configuration)

- [ ] **Step 3: Create pricing capability definition**

```typescript
// backend/src/modules/product/capabilities/pricing.capability.ts
import type { Capability, CapabilityHandler } from '@core/capability/types';

const pricingCapability: Capability = {
  name: 'pricing',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
};

const basePriceHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'base',
  priority: 10,
  module: 'product',
  handle: async (ctx) => {
    ctx.state.basePrice = ctx.input.basePrice;
    ctx.result = ctx.input.basePrice;
  },
};

const roundingHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'rounding',
  priority: 50,
  module: 'product',
  handle: async (ctx) => {
    ctx.result = Math.round((ctx.result ?? 0) * 100) / 100;
  },
};

const finalPriceHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'final',
  priority: 50,
  module: 'product',
  handle: async (ctx) => {
    ctx.state.finalPrice = ctx.result;
  },
};

export {
  pricingCapability,
  basePriceHandler,
  roundingHandler,
  finalPriceHandler,
};
```

- [ ] **Step 4: Wire pricing capability in product ModuleFactory**

In `backend/src/modules/product/index.ts`, add capabilities to ModuleDefinition:

```typescript
import {
  pricingCapability,
  basePriceHandler,
  roundingHandler,
  finalPriceHandler,
} from './capabilities/pricing.capability';

const productModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    // ... existing code ...

    return {
      module,
      providers: [
        { token: 'IProductService', useFactory: () => module.getService(), moduleName: 'product', exported: true },
      ],
      exports: ['IProductService'],
      capabilities: [basePriceHandler, roundingHandler, finalPriceHandler],
    };
  },
};
```

- [ ] **Step 5: Register pricing capability in main.ts**

In `backend/src/main.ts`, after `container.build()`:

```typescript
import { CapabilityRegistry, validateCapabilities } from '@core/capability';
import { pricingCapability } from '@modules/product/capabilities/pricing.capability';

// Register capability definitions
const capabilityRegistry = container.get<CapabilityRegistry>('CapabilityRegistry');
capabilityRegistry.registerCapability(pricingCapability);

// After container.build() registers handlers:
validateCapabilities(capabilityRegistry);
```

- [ ] **Step 6: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/product/capabilities/pricing.capability.ts backend/src/modules/product/index.ts backend/src/main.ts
git commit -m "feat: implement pricing pipeline as first real capability

Pipeline: base → discount → tax → rounding → final
- Product module provides: base (price lookup), rounding, final
- Discount/tax handlers provided by future plugins or modules
- Pricing capability registered in main.ts
- validateCapabilities() runs after container.build()"
```

---

### Task 7: Wire CapabilityRegistry + CapabilityExecutor in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Register as core providers**

In `backend/src/main.ts`, add:

```typescript
import { CapabilityRegistry, CapabilityExecutor, validateCapabilities } from '@core/capability';

// In core provider registration section:
container.registerCore('CapabilityRegistry', {
  useFactory: () => new CapabilityRegistry(),
});
container.registerCore('CapabilityExecutor', {
  useFactory: () => new CapabilityExecutor(
    container.get('CapabilityRegistry'),
    logger,
  ),
  deps: ['CapabilityRegistry'],
});
```

- [ ] **Step 2: Add validation after container.build()**

After `await container.build(registry.getActive())`:

```typescript
// Validate capabilities at build time
const capabilityRegistry = container.get<CapabilityRegistry>('CapabilityRegistry');
validateCapabilities(capabilityRegistry);
```

- [ ] **Step 3: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire CapabilityRegistry + CapabilityExecutor in bootstrap

- CapabilityRegistry as core provider
- CapabilityExecutor with logger dependency
- validateCapabilities() runs after container.build()
- Pricing capability registered before build"
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

- [ ] `Capability` has `name`, `type` (pipeline/single/composable), `stages?`
- [ ] `CapabilityHandler` has `capability`, `stage?`, `priority?`, `exclusive?`, `condition?`, `handle`
- [ ] `CapabilityContext` has `input`, `state`, `result?`, `stop?`
- [ ] `CapabilityRegistry.registerCapability()` throws on duplicate
- [ ] `CapabilityRegistry.registerHandler()` validates stage for pipeline
- [ ] `CapabilityRegistry.clearByModule()` removes module handlers
- [ ] `CapabilityExecutor.execute()` routes to pipeline/single/composable
- [ ] Pipeline: sorted by stage order then priority
- [ ] Single: throws on 0 or >1 handlers
- [ ] Composable: runs all handlers in parallel
- [ ] `validateCapabilities()` throws on single-type with multiple handlers
- [ ] `validateCapabilities()` throws on multiple exclusive handlers
- [ ] `validateCapabilities()` throws on invalid pipeline stage
- [ ] `ModuleDefinition` has `capabilities?` field
- [ ] Container `build()` registers capability handlers
- [ ] Container `dispose()` clears capabilities by module
- [ ] Pricing pipeline: base → discount → tax → rounding → final produces correct result
- [ ] `product/index.ts` declares capability handlers
- [ ] `main.ts` wires CapabilityRegistry + CapabilityExecutor

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 9 validation — Capability System all checks pass"
```

---

## Self-Review

**Spec coverage (Part D of erp-platform-full-spec.md):**
- ✅ D.1 Capability Types → Task 1
- ✅ D.2 CapabilityRegistry → Task 2
- ✅ D.3 CapabilityExecutor → Task 3
- ✅ D.4 Build-Time Validation → Task 4
- ✅ D.5 Pricing Pipeline → Task 6
- ✅ Container Integration → Task 5
- ✅ Bootstrap Wiring → Task 7

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `Capability`, `CapabilityHandler`, `CapabilityContext` defined in Task 1, used consistently in Tasks 2–7. `ModuleDefinition.capabilities` type matches `CapabilityHandlerStub` which maps to `CapabilityHandler`.
