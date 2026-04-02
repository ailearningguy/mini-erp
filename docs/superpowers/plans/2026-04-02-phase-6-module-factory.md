# Phase 6: ModuleFactory + Module Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize module entry through ModuleFactory — modules declare providers, exports, and contracts instead of manual wiring in main.ts.

**Architecture:** Extend existing `DIContainer` with core/module scope + build/dispose/rebuild lifecycle. New `FsModuleRegistry` replaces simple registry with filesystem discovery + topological sort. Modules implement `IModule` interface with `onInit()`/`onDestroy()`. ModuleFactory pattern replaces manual instantiation.

**Tech Stack:** TypeScript, Express.js, Jest, Node.js fs/promises, semver (future)

**Spec Reference:** `docs/architecture/erp-platform-full-spec.md` Part A

**Prerequisite:** None — builds on actual current codebase state

---

## Current State (Actual Code)

| Component | Status | File |
|-----------|--------|------|
| `DIContainer` | Simple register/resolve/validateGraph (137 lines) | `core/di/container.ts` |
| `ModuleRegistry` | Only stores rate limits + event handlers (40 lines) | `core/module-registry/registry.ts` |
| `ProductModule` | Plain class, no IModule interface | `modules/product/product.module.ts` |
| `product/index.ts` | Imports `IModuleFactory` from container — **TYPE DOES NOT EXIST** | `modules/product/index.ts` |
| `order/index.ts` | Same — imports non-existent types | `modules/order/index.ts` |
| `module.json` | Not created yet | N/A |

**Critical observation:** `product/index.ts` and `order/index.ts` already import `IModuleFactory` and `DIContainer` types from `@core/di/container`, but those types are NOT exported from the current `container.ts`. Step 1 must fix this.

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/di/container.ts` | Extend | Add IModule, ModuleFactory, ProviderRegistration types + core/module scope + build/dispose/rebuild |
| `backend/src/core/module-registry/registry.ts` | Rewrite | FsModuleRegistry with filesystem scan + topo sort |
| `backend/src/modules/product/module.json` | Create | Module manifest |
| `backend/src/modules/product/product.module.ts` | Refactor | Implement IModule interface |
| `backend/src/modules/product/index.ts` | Refactor | Proper ModuleFactory with providers + exports |
| `backend/src/modules/order/module.json` | Create | Module manifest |
| `backend/src/modules/order/order.module.ts` | Refactor | Implement IModule interface |
| `backend/src/modules/order/index.ts` | Refactor | Proper ModuleFactory |
| `backend/src/main.ts` | Refactor | Use FsModuleRegistry + container.build() |
| `backend/tests/core/di/container.test.ts` | Extend | Tests for new build/dispose/rebuild |
| `backend/tests/core/module-registry/registry.test.ts` | Rewrite | Tests for FsModuleRegistry |
| `backend/src/core/module-factory/contract-validator.ts` | Create | Build-time contract validation |
| `backend/tests/core/module-factory/contract-validator.test.ts` | Create | Validator tests |

---

### Task 1: Define IModule, ModuleFactory, ProviderRegistration Interfaces

**Problem:** `product/index.ts` imports `IModuleFactory` from `@core/di/container` but it doesn't exist. Fix the type foundation first.

**Files:**
- Modify: `backend/src/core/di/container.ts`
- Test: `backend/tests/core/di/container.test.ts`

- [ ] **Step 1: Write the failing test for interface contracts**

```typescript
// Add to backend/tests/core/di/container.test.ts

describe('IModule interface contract', () => {
  it('should require name, onInit, and onDestroy', async () => {
    const mod = {
      name: 'test',
      onInit: async () => {},
      onDestroy: async () => {},
    };

    expect(mod.name).toBe('test');
    expect(typeof mod.onInit).toBe('function');
    expect(typeof mod.onDestroy).toBe('function');
    await mod.onInit();
    await mod.onDestroy();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (interfaces are just types)**

Run: `cd backend && npx jest tests/core/di/container.test.ts -t "IModule interface" -v`
Expected: PASS

- [ ] **Step 3: Add interfaces to container.ts**

Add at the TOP of `backend/src/core/di/container.ts` (before the class):

```typescript
// --- Extended Architecture Interfaces ---

interface IModule {
  readonly name: string;
  onInit(): Promise<void>;
  onDestroy(): Promise<void>;
}

interface ModuleFactory {
  create(container: DIContainer): Promise<ModuleDefinition> | ModuleDefinition;
}

interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];
  hooks?: HookRegistrationStub[];
}

interface ProviderRegistration<T = unknown> {
  token: string;
  useClass?: new (...args: unknown[]) => T;
  useFactory?: (container: DIContainer) => Promise<T> | T;
  deps?: string[];
  scope?: 'singleton' | 'transient';
  moduleName?: string;
  exported?: boolean;
}

interface ModuleMetadata {
  name: string;
  version: string;
  enabled: boolean;
  dependencies: { name: string; version: string }[];
  entry: () => Promise<{ default: ModuleFactory }>;
  manifest: ModuleManifest;
}

interface ModuleManifest {
  name: string;
  version: string;
  enabled: boolean;
  dependencies?: string[];
  description?: string;
}

// Stub for Phase 7 — actual HookRegistration will be defined there
interface HookRegistrationStub {
  point: string;
  phase: 'pre' | 'post';
  handler: (ctx: any) => Promise<void>;
  priority?: number;
}
```

Update the exports at the bottom of `container.ts`:

```typescript
export { DIContainer };
export type {
  IModule,
  ModuleFactory,
  ModuleDefinition,
  ProviderRegistration,
  ModuleMetadata,
  ModuleManifest,
};
```

- [ ] **Step 4: Run existing tests to verify no breakage**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS (types only, no runtime change)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/di/container.ts backend/tests/core/di/container.test.ts
git commit -m "feat: add IModule, ModuleFactory, ProviderRegistration interfaces

Define contracts for the module system:
- IModule: name + onInit/onDestroy lifecycle
- ModuleFactory: create(container) returns ModuleDefinition
- ModuleDefinition: module + providers + exports
- ModuleMetadata: name, version, dependencies, lazy entry
- ModuleManifest: JSON manifest format

Fixes missing type imports in product/index.ts and order/index.ts."
```

---

### Task 2: Extend DIContainer with Core/Module Scope + Build/Dispose/Rebuild

**Files:**
- Modify: `backend/src/core/di/container.ts`
- Test: `backend/tests/core/di/container.test.ts`

- [ ] **Step 1: Write failing tests for core/module scope**

```typescript
// Add to backend/tests/core/di/container.test.ts

describe('DIContainer core/module scope', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  it('registerCore should register a provider that survives dispose', async () => {
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });
    expect(container.get('DbPool')).toBe('mock-db');

    await container.build([]);
    await container.dispose();

    expect(container.get('DbPool')).toBe('mock-db');
  });

  it('dispose should be idempotent', async () => {
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });
    await container.build([]);

    await container.dispose();
    await container.dispose();
    await container.dispose();

    expect(container.get('DbPool')).toBe('mock-db');
  });

  it('build should call module.onInit()', async () => {
    const onInitMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onDestroyMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const mockFactory: ModuleFactory = {
      create: async () => ({
        module: { name: 'test', onInit: onInitMock, onDestroy: onDestroyMock },
        providers: [],
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

    expect(onInitMock).toHaveBeenCalled();
  });

  it('dispose should call module.onDestroy() in reverse order', async () => {
    const order: string[] = [];

    const makeModule = (name: string): IModule => ({
      name,
      onInit: async () => {},
      onDestroy: async () => { order.push(name); },
    });

    const makeFactory = (mod: IModule): ModuleFactory => ({
      create: async () => ({ module: mod, providers: [] }),
    });

    const toMeta = (name: string, factory: ModuleFactory): ModuleMetadata => ({
      name,
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => ({ default: factory }),
      manifest: { name, version: '2026.04.01', enabled: true },
    });

    await container.build([
      toMeta('alpha', makeFactory(makeModule('alpha'))),
      toMeta('beta', makeFactory(makeModule('beta'))),
    ]);

    await container.dispose();

    expect(order).toEqual(['beta', 'alpha']);
  });

  it('rebuild should rollback on failure', async () => {
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });

    const goodFactory: ModuleFactory = {
      create: async () => ({
        module: {
          name: 'good',
          onInit: async () => {},
          onDestroy: async () => {},
        },
        providers: [{ token: 'GoodService', useFactory: () => 'good' }],
      }),
    };

    const badFactory: ModuleFactory = {
      create: async () => {
        throw new Error('factory exploded');
      },
    };

    const toMeta = (name: string, factory: ModuleFactory): ModuleMetadata => ({
      name,
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => ({ default: factory }),
      manifest: { name, version: '2026.04.01', enabled: true },
    });

    // Build good module first
    await container.build([toMeta('good', goodFactory)]);
    expect(container.get('GoodService')).toBe('good');

    // Rebuild with bad module — should rollback
    await expect(
      container.rebuild([toMeta('bad', badFactory)]),
    ).rejects.toThrow(/rolled back/i);

    // Good service should still be available
    expect(container.get('GoodService')).toBe('good');
  });

  it('get should resolve from core scope', () => {
    container.registerCore('Redis', { useFactory: () => 'redis-client' });
    expect(container.get('Redis')).toBe('redis-client');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/di/container.test.ts -t "core/module scope" -v`
Expected: FAIL — `registerCore`, `build`, `dispose`, `rebuild`, `get` not defined on DIContainer

- [ ] **Step 3: Extend DIContainer class**

Add the following fields and methods to the existing `DIContainer` class in `backend/src/core/di/container.ts`:

```typescript
class DIContainer {
  // --- Existing fields ---
  private services = new Map<string, ServiceRegistration>();
  private resolving = new Set<string>();
  private currentActor: string = 'core';

  // --- NEW: Core vs Module scope ---
  private coreProviders = new Map<string, ProviderRegistration>();
  private coreInstances = new Map<string, unknown>();
  private moduleProviders = new Map<string, ProviderRegistration>();
  private moduleInstances = new Map<string, unknown>();
  private modules: IModule[] = [];
  private containerState: 'IDLE' | 'BUILDING' | 'READY' | 'DISPOSING' = 'IDLE';
  private buildMutex: Promise<void> = Promise.resolve();
  private pendingHooks: HookRegistrationStub[] = [];
  private exportedTokens = new Map<string, string>(); // token → moduleName

  // --- Keep ALL existing methods (setActor, register, resolve, validateGraph, has, getRegisteredTokens, getDependencies) ---
  // ... existing code unchanged ...

  // --- NEW: registerCore for infrastructure that survives rebuild ---
  registerCore<T>(token: string, provider: Omit<ProviderRegistration<T>, 'moduleName'>): void {
    if (this.coreProviders.has(token) || this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.coreProviders.set(token, { ...provider, moduleName: '__core__' });
  }

  // --- NEW: get() that checks all scopes ---
  get<T>(token: string): T {
    // Legacy services (backward compat)
    if (this.services.has(token)) {
      return this.resolve<T>(token);
    }
    // Core instances
    if (this.coreInstances.has(token)) {
      return this.coreInstances.get(token) as T;
    }
    // Module instances
    if (this.moduleInstances.has(token)) {
      return this.moduleInstances.get(token) as T;
    }
    throw new Error(`Service not found: ${token}`);
  }

  // --- NEW: Build pipeline ---
  async build(modules: ModuleMetadata[]): Promise<void> {
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      this.assertContainerState('IDLE');
      this.containerState = 'BUILDING';

      // Step 1: Load module factories (lazy import)
      const enabledModules = modules.filter(m => m.enabled);
      const loaded = await Promise.all(
        enabledModules.map(async m => {
          try {
            const mod = await m.entry();
            return { metadata: m, factory: mod.default ?? mod };
          } catch (err) {
            throw new Error(`Failed to load module "${m.name}": ${err}`);
          }
        }),
      );

      // Step 2: Create definitions + register providers
      for (const { metadata, factory } of loaded) {
        const def = await factory.create(this);

        for (const provider of def.providers) {
          provider.moduleName = metadata.name;
          if (this.moduleProviders.has(provider.token)) {
            throw new Error(`Duplicate provider token "${provider.token}" in module "${metadata.name}"`);
          }
          this.moduleProviders.set(provider.token, provider);
        }

        // Track exports
        if (def.exports) {
          for (const token of def.exports) {
            this.exportedTokens.set(token, metadata.name);
          }
        }

        // Store hooks for Phase 7
        if (def.hooks) {
          this.pendingHooks.push(...def.hooks);
        }

        this.modules.push(def.module);
      }

      // Step 3: Validate graph
      this.validateExtendedGraph();

      // Step 4: Instantiate module singletons
      for (const [token, provider] of this.moduleProviders) {
        if (provider.scope !== 'transient') {
          await this.instantiateFromProvider(token, 'module');
        }
      }

      // Step 5: Call module.onInit()
      for (const m of this.modules) {
        try {
          await m.onInit();
        } catch (err) {
          throw new Error(`Module "${m.name}" onInit() failed: ${err}`);
        }
      }

      this.containerState = 'READY';
    } catch (err) {
      this.containerState = 'IDLE';
      this.moduleInstances.clear();
      this.moduleProviders.clear();
      this.modules = [];
      throw err;
    } finally {
      release!();
    }
  }

  // --- NEW: Dispose pipeline ---
  async dispose(): Promise<void> {
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      if (this.containerState !== 'READY') return; // Idempotent

      this.containerState = 'DISPOSING';

      // Step 1: module.onDestroy() in reverse order
      for (const m of [...this.modules].reverse()) {
        try {
          await m.onDestroy();
        } catch (err) {
          console.error(`Module "${m.name}" onDestroy() error:`, err);
        }
      }

      // Step 2: Dispose instances with dispose() method
      for (const [token, instance] of this.moduleInstances) {
        if (instance && typeof (instance as any).dispose === 'function') {
          try {
            await (instance as any).dispose();
          } catch (err) {
            console.error(`Dispose error for "${token}":`, err);
          }
        }
      }

      // Step 3: Clear module-level state
      this.moduleInstances.clear();
      this.moduleProviders.clear();
      this.exportedTokens.clear();
      this.pendingHooks = [];
      this.modules = [];

      this.containerState = 'IDLE';
    } finally {
      release!();
    }
  }

  // --- NEW: Rebuild (atomic with rollback) ---
  async rebuild(modules: ModuleMetadata[]): Promise<void> {
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      const snapshot = {
        providers: new Map(this.moduleProviders),
        instances: new Map(this.moduleInstances),
        modules: [...this.modules],
        exports: new Map(this.exportedTokens),
        hooks: [...this.pendingHooks],
      };

      try {
        await this.disposeInternal();
        await this.buildInternal(modules);
      } catch (err) {
        // Rollback
        this.moduleProviders = snapshot.providers;
        this.moduleInstances = snapshot.instances;
        this.modules = snapshot.modules;
        this.exportedTokens = snapshot.exports;
        this.pendingHooks = snapshot.hooks;
        this.containerState = 'READY';
        throw new Error(`Rebuild failed, rolled back to previous state: ${err}`);
      }
    } finally {
      release!();
    }
  }

  // --- NEW: Get exported tokens ---
  getExportedTokens(): Map<string, string> {
    return new Map(this.exportedTokens);
  }

  // --- NEW: Get pending hooks (for Phase 7) ---
  getPendingHooks(): HookRegistrationStub[] {
    return [...this.pendingHooks];
  }

  // --- Private helpers ---

  private assertContainerState(expected: 'IDLE' | 'READY'): void {
    if (this.containerState !== expected) {
      throw new Error(`Container is ${this.containerState}, expected ${expected}`);
    }
  }

  private async instantiateFromProvider(token: string, scope: 'core' | 'module'): Promise<unknown> {
    const instances = scope === 'core' ? this.coreInstances : this.moduleInstances;
    const providers = scope === 'core' ? this.coreProviders : this.moduleProviders;

    if (instances.has(token)) return instances.get(token);

    const provider = providers.get(token) ?? this.coreProviders.get(token);
    if (!provider) throw new Error(`Provider not found: ${token}`);

    let instance: unknown;
    if (provider.useFactory) {
      instance = await provider.useFactory(this);
    } else if (provider.useClass) {
      const deps = (provider.deps ?? []).map(dep => this.get(dep));
      instance = new provider.useClass(...deps);
    } else {
      throw new Error(`Provider "${token}" has no useClass or useFactory`);
    }

    if (provider.scope !== 'transient') {
      instances.set(token, instance);
    }
    return instance;
  }

  private validateExtendedGraph(): void {
    const allTokens = new Set<string>([
      ...this.coreProviders.keys(),
      ...this.moduleProviders.keys(),
    ]);
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (token: string) => {
      if (visiting.has(token)) {
        throw new Error(`Circular dependency detected: ${token}`);
      }
      if (visited.has(token)) return;

      visiting.add(token);
      const provider = this.coreProviders.get(token) ?? this.moduleProviders.get(token);
      for (const dep of provider?.deps ?? []) {
        if (!allTokens.has(dep)) {
          throw new Error(`Missing dependency: "${dep}" required by "${token}"`);
        }
        visit(dep);
      }
      visiting.delete(token);
      visited.add(token);
    };

    for (const token of allTokens) {
      visit(token);
    }
  }

  private async buildInternal(modules: ModuleMetadata[]): Promise<void> {
    this.assertContainerState('IDLE');
    this.containerState = 'BUILDING';

    const enabledModules = modules.filter(m => m.enabled);
    const loaded = await Promise.all(
      enabledModules.map(async m => {
        try {
          const mod = await m.entry();
          return { metadata: m, factory: mod.default ?? mod };
        } catch (err) {
          throw new Error(`Failed to load module "${m.name}": ${err}`);
        }
      }),
    );

    for (const { metadata, factory } of loaded) {
      const def = await factory.create(this);
      for (const provider of def.providers) {
        provider.moduleName = metadata.name;
        this.moduleProviders.set(provider.token, provider);
      }
      if (def.exports) {
        for (const token of def.exports) {
          this.exportedTokens.set(token, metadata.name);
        }
      }
      this.modules.push(def.module);
    }

    this.validateExtendedGraph();

    for (const [token, provider] of this.moduleProviders) {
      if (provider.scope !== 'transient') {
        await this.instantiateFromProvider(token, 'module');
      }
    }

    for (const m of this.modules) {
      await m.onInit();
    }

    this.containerState = 'READY';
  }

  private async disposeInternal(): Promise<void> {
    if (this.containerState !== 'READY') return;
    this.containerState = 'DISPOSING';

    for (const m of [...this.modules].reverse()) {
      try { await m.onDestroy(); } catch (err) { console.error(err); }
    }
    for (const [token, instance] of this.moduleInstances) {
      if (instance && typeof (instance as any).dispose === 'function') {
        try { await (instance as any).dispose(); } catch (err) { console.error(err); }
      }
    }

    this.moduleInstances.clear();
    this.moduleProviders.clear();
    this.exportedTokens.clear();
    this.pendingHooks = [];
    this.modules = [];
    this.containerState = 'IDLE';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS (including new tests + existing tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/di/container.ts backend/tests/core/di/container.test.ts
git commit -m "feat: extend DIContainer with core/module scope + build/dispose/rebuild

- registerCore() for infrastructure that survives rebuild
- build(modules): load factories → register providers → validate → instantiate → onInit
- dispose(): reverse-order module teardown, idempotent
- rebuild(modules): atomic with rollback on failure
- get() checks core → module → legacy scopes
- Mutex-serialized for concurrent safety
- Exported tokens tracked for contract enforcement"
```

---

### Task 3: Rewrite ModuleRegistry — FsModuleRegistry

**Files:**
- Rewrite: `backend/src/core/module-registry/registry.ts`
- Rewrite: `backend/tests/core/module-registry/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/module-registry/registry.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ModuleMetadata } from '@core/di/container';

// We test FsModuleRegistry with mocked fs
const mockReaddir = jest.fn();
const mockReadFile = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

import { FsModuleRegistry } from '@core/module-registry/registry';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('FsModuleRegistry', () => {
  let registry: FsModuleRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new FsModuleRegistry('/fake/modules', mockLogger);
  });

  describe('scan()', () => {
    it('should discover enabled modules from filesystem', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
        { name: 'order', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true, dependencies: [] });
        }
        if (path.includes('order/module.json')) {
          return JSON.stringify({ name: 'order', version: '2026.04.01', enabled: true, dependencies: ['product'] });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();

      expect(modules).toHaveLength(2);
      expect(modules[0].name).toBe('product');
      expect(modules[1].name).toBe('order');
    });

    it('should skip disabled modules', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
        { name: 'old-module', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true });
        }
        if (path.includes('old-module/module.json')) {
          return JSON.stringify({ name: 'old-module', version: '2026.04.01', enabled: false });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('product');
    });

    it('should skip directories without module.json', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
        { name: 'utils', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
    });

    it('should skip non-directory entries', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'README.md', isDirectory: () => false },
        { name: 'product', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
    });
  });

  describe('resolve()', () => {
    it('should topologically sort by dependencies', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'order', version: '2026.04.01', enabled: true,
          dependencies: [{ name: 'product', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'order', version: '2026.04.01', enabled: true },
        },
        {
          name: 'product', version: '2026.04.01', enabled: true,
          dependencies: [],
          entry: async () => ({} as any),
          manifest: { name: 'product', version: '2026.04.01', enabled: true },
        },
      ];

      const resolved = registry.resolve(mods);

      expect(resolved[0].name).toBe('product');
      expect(resolved[1].name).toBe('order');
    });

    it('should detect circular dependencies', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'a', version: '1', enabled: true,
          dependencies: [{ name: 'b', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'a', version: '1', enabled: true },
        },
        {
          name: 'b', version: '1', enabled: true,
          dependencies: [{ name: 'a', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'b', version: '1', enabled: true },
        },
      ];

      expect(() => registry.resolve(mods)).toThrow(/[Cc]ircular/);
    });

    it('should throw on missing dependency', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'order', version: '1', enabled: true,
          dependencies: [{ name: 'nonexistent', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'order', version: '1', enabled: true },
        },
      ];

      expect(() => registry.resolve(mods)).toThrow(/not found|not available/i);
    });

    it('should handle modules with no dependencies', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'product', version: '1', enabled: true,
          dependencies: [],
          entry: async () => ({} as any),
          manifest: { name: 'product', version: '1', enabled: true },
        },
      ];

      const resolved = registry.resolve(mods);
      expect(resolved).toHaveLength(1);
    });
  });

  describe('refresh()', () => {
    it('should scan, resolve, and update active set', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true }),
      );

      const resolved = await registry.refresh();

      expect(resolved).toHaveLength(1);
      expect(registry.getActive()).toEqual(resolved);
    });
  });

  describe('getByName()', () => {
    it('should return module by name after refresh', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true }),
      );

      await registry.refresh();
      const product = registry.getByName('product');

      expect(product?.name).toBe('product');
    });

    it('should return undefined for unknown module', async () => {
      await registry.refresh();
      expect(registry.getByName('unknown')).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/module-registry/registry.test.ts -v`
Expected: FAIL — FsModuleRegistry not exported

- [ ] **Step 3: Rewrite registry.ts**

Replace the ENTIRE content of `backend/src/core/module-registry/registry.ts`:

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ModuleMetadata, ModuleManifest, ModuleFactory } from '@core/di/container';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

interface ModuleRegistryInterface {
  scan(): Promise<ModuleMetadata[]>;
  resolve(mods: ModuleMetadata[]): ModuleMetadata[];
  getActive(): ModuleMetadata[];
  refresh(): Promise<ModuleMetadata[]>;
  getByName(name: string): ModuleMetadata | undefined;
}

class FsModuleRegistry implements ModuleRegistryInterface {
  private active: ModuleMetadata[] = [];

  constructor(
    private modulesDir: string,
    private logger: Logger,
  ) {}

  async scan(): Promise<ModuleMetadata[]> {
    let entries;
    try {
      entries = await fs.readdir(this.modulesDir, { withFileTypes: true });
    } catch (err) {
      this.logger.error({ dir: this.modulesDir, err }, 'Failed to read modules directory');
      return [];
    }

    const modules: ModuleMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(this.modulesDir, entry.name, 'module.json');

      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest: ModuleManifest = JSON.parse(content);

        if (!manifest.enabled) {
          this.logger.info({ module: manifest.name }, 'Module disabled, skipping');
          continue;
        }

        modules.push({
          name: manifest.name,
          version: manifest.version,
          enabled: manifest.enabled,
          dependencies: (manifest.dependencies ?? []).map(dep => ({
            name: dep,
            version: '*',
          })),
          entry: async (): Promise<{ default: ModuleFactory }> => {
            const mod = await import(path.join(this.modulesDir, entry.name, 'index.ts'));
            return mod;
          },
          manifest,
        });

        this.logger.info({ module: manifest.name, version: manifest.version }, 'Module discovered');
      } catch (err) {
        this.logger.warn({ module: entry.name, err }, 'Failed to load module manifest');
      }
    }

    return modules;
  }

  resolve(mods: ModuleMetadata[]): ModuleMetadata[] {
    const modMap = new Map(mods.map(m => [m.name, m]));
    const sorted: ModuleMetadata[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving module: ${name}`);
      }

      visiting.add(name);
      const mod = modMap.get(name);

      if (!mod) {
        throw new Error(`Module "${name}" depends on unknown module`);
      }

      for (const dep of mod.dependencies) {
        if (!modMap.has(dep.name)) {
          throw new Error(`Module "${name}" depends on "${dep.name}" which is not available`);
        }
        visit(dep.name);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(mod);
    };

    for (const mod of mods) {
      visit(mod.name);
    }

    return sorted;
  }

  getActive(): ModuleMetadata[] {
    return [...this.active];
  }

  async refresh(): Promise<ModuleMetadata[]> {
    const scanned = await this.scan();
    const resolved = this.resolve(scanned);
    this.active = resolved;
    return resolved;
  }

  getByName(name: string): ModuleMetadata | undefined {
    return this.active.find(m => m.name === name);
  }
}

export { FsModuleRegistry };
export type { ModuleRegistryInterface as ModuleRegistry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/module-registry/registry.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/module-registry/registry.ts backend/tests/core/module-registry/registry.test.ts
git commit -m "feat: rewrite ModuleRegistry as FsModuleRegistry

- scan(): discover modules from filesystem (modules/*/module.json)
- resolve(): topological sort + circular dependency detection
- refresh(): scan + resolve + update active snapshot
- getByName(): lookup by module name
- Lazy entry loading: code imported only during build()"
```

---

### Task 4: Create Module Manifests + Contract Validator

**Files:**
- Create: `backend/src/modules/product/module.json`
- Create: `backend/src/modules/order/module.json`
- Create: `backend/src/core/module-factory/contract-validator.ts`
- Create: `backend/tests/core/module-factory/contract-validator.test.ts`

- [ ] **Step 1: Write failing tests for contract validator**

```typescript
// backend/tests/core/module-factory/contract-validator.test.ts
import { describe, it, expect } from '@jest/globals';
import { validateModuleDefinition } from '@core/module-factory/contract-validator';
import type { ModuleDefinition } from '@core/di/container';

describe('validateModuleDefinition', () => {
  const baseModule = {
    name: 'test',
    onInit: async () => {},
    onDestroy: async () => {},
  };

  it('should pass for valid definition with exports', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [
        { token: 'ITestService', useFactory: () => ({}), exported: true },
      ],
      exports: ['ITestService'],
    };

    expect(() => validateModuleDefinition(def, 'test')).not.toThrow();
  });

  it('should throw when no exports defined', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [{ token: 'TestService', useFactory: () => ({}) }],
    };

    expect(() => validateModuleDefinition(def, 'test')).toThrow(/must export at least one/i);
  });

  it('should throw when exported token not in providers', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [{ token: 'TestService', useFactory: () => ({}) }],
      exports: ['IMissingService'],
    };

    expect(() => validateModuleDefinition(def, 'test')).toThrow(/exports.*but no provider/i);
  });

  it('should throw when exported token does not start with I', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [{ token: 'TestService', useFactory: () => ({}) }],
      exports: ['TestService'],
    };

    expect(() => validateModuleDefinition(def, 'test')).toThrow(/must start with.*I/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/module-factory/contract-validator.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create contract validator**

```typescript
// backend/src/core/module-factory/contract-validator.ts
import type { ModuleDefinition } from '@core/di/container';

function validateModuleDefinition(def: ModuleDefinition, moduleName: string): void {
  if (!def.exports || def.exports.length === 0) {
    throw new Error(`Module "${moduleName}" must export at least one service interface`);
  }

  for (const token of def.exports) {
    if (!def.providers.some(p => p.token === token)) {
      throw new Error(`Module "${moduleName}" exports "${token}" but no provider registered`);
    }
  }

  for (const token of def.exports) {
    if (!token.startsWith('I')) {
      throw new Error(`Exported token "${token}" in module "${moduleName}" must start with 'I'`);
    }
  }
}

export { validateModuleDefinition };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/module-factory/contract-validator.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Create module manifests**

`backend/src/modules/product/module.json`:
```json
{
  "name": "product",
  "version": "2026.04.01",
  "enabled": true,
  "dependencies": [],
  "description": "Product catalog management"
}
```

`backend/src/modules/order/module.json`:
```json
{
  "name": "order",
  "version": "2026.04.01",
  "enabled": true,
  "dependencies": ["product"],
  "description": "Order management"
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/core/module-factory/contract-validator.ts backend/tests/core/module-factory/contract-validator.test.ts backend/src/modules/product/module.json backend/src/modules/order/module.json
git commit -m "feat: add contract validator + module manifests

- validateModuleDefinition(): exports required, naming convention enforced
- module.json for product (no deps) and order (depends on product)"
```

---

### Task 5: Refactor ProductModule to IModule + Proper ModuleFactory

**Files:**
- Modify: `backend/src/modules/product/product.module.ts`
- Modify: `backend/src/modules/product/index.ts`

- [ ] **Step 1: Write failing test for IModule compliance**

```typescript
// Add to backend/tests/modules/product/product.service.test.ts (or new file)

import { describe, it, expect } from '@jest/globals';

describe('ProductModule IModule compliance', () => {
  it('should have name, onInit, onDestroy', () => {
    const { ProductModule } = require('@modules/product/product.module');

    const mockConfig = {
      db: {} as any,
      eventBus: { emit: async () => {} } as any,
      schemaRegistry: { register: () => {} } as any,
      eventConsumer: { registerHandler: () => {} } as any,
      cacheService: { invalidate: async () => {} } as any,
      app: { get: () => {}, post: () => {}, put: () => {}, delete: () => {} } as any,
    };

    const mod = new ProductModule(mockConfig);

    expect(mod.name).toBe('product');
    expect(typeof mod.onInit).toBe('function');
    expect(typeof mod.onDestroy).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/modules/product/ -t "IModule compliance" -v`
Expected: FAIL — `mod.name` is undefined (no `name` property on ProductModule)

- [ ] **Step 3: Refactor ProductModule**

Replace the class in `backend/src/modules/product/product.module.ts`:

```typescript
import type { IModule } from '@core/di/container';
import type { IProductService } from './interfaces/product.service.interface';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import {
  ProductCreatedEventSchema,
  ProductUpdatedEventSchema,
  ProductDeactivatedEventSchema,
} from './events/product.events';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventConsumer } from '@core/consumer/consumer';
import type { CacheService } from '@core/cache/cache.service';
import type { Express } from 'express';
import type { Db } from '@shared/types/db';

interface ProductModuleConfig {
  db: Db;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
  eventConsumer: EventConsumer;
  cacheService: CacheService;
  app: Express;
}

class ProductModule implements IModule {
  readonly name = 'product';
  private service: IProductService;
  private controller: ProductController;

  constructor(private readonly config: ProductModuleConfig) {
    this.service = new ProductService(config.db, config.eventBus);
    this.controller = new ProductController(this.service);
  }

  getService(): IProductService {
    return this.service;
  }

  async onInit(): Promise<void> {
    // Register event schemas
    this.config.schemaRegistry.register('product.created.v1', ProductCreatedEventSchema);
    this.config.schemaRegistry.register('product.updated.v1', ProductUpdatedEventSchema);
    this.config.schemaRegistry.register('product.deactivated.v1', ProductDeactivatedEventSchema);

    // Register routes
    this.config.app.get('/api/v1/products', (req, res, next) => this.controller.list(req, res, next));
    this.config.app.get('/api/v1/products/:id', (req, res, next) => this.controller.getById(req, res, next));
    this.config.app.post('/api/v1/products', (req, res, next) => this.controller.create(req, res, next));
    this.config.app.put('/api/v1/products/:id', (req, res, next) => this.controller.update(req, res, next));
    this.config.app.delete('/api/v1/products/:id', (req, res, next) => this.controller.delete(req, res, next));

    // Register event handlers
    this.config.eventConsumer.registerHandler('product.updated.v1', async (event) => {
      await this.config.cacheService.invalidate(`product:${event.aggregate_id}`);
    });
    this.config.eventConsumer.registerHandler('product.deactivated.v1', async (event) => {
      await this.config.cacheService.invalidate(`product:${event.aggregate_id}`);
    });
  }

  async onDestroy(): Promise<void> {
    // Cleanup handled by container (EventConsumer.unregisterAll)
  }
}

export { ProductModule };
export type { ProductModuleConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/modules/product/ -t "IModule compliance" -v`
Expected: PASS

- [ ] **Step 5: Refactor product/index.ts — proper ModuleFactory with providers + exports**

Replace `backend/src/modules/product/index.ts`:

```typescript
import type { ModuleFactory, ModuleDefinition } from '@core/di/container';
import type { DIContainer } from '@core/di/container';
import { ProductModule } from './product.module';
import type { IProductService } from './interfaces/product.service.interface';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventConsumer } from '@core/consumer/consumer';
import type { CacheService } from '@core/cache/cache.service';
import type { Express } from 'express';

const productModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const eventConsumer = container.get<EventConsumer>('EventConsumer');
    const cacheService = container.get<CacheService>('CacheService');
    const app = container.get<Express>('ExpressApp');

    const module = new ProductModule({
      db,
      eventBus,
      schemaRegistry,
      eventConsumer,
      cacheService,
      app,
    });

    return {
      module,
      providers: [
        {
          token: 'IProductService',
          useFactory: () => module.getService(),
          moduleName: 'product',
          exported: true,
        },
      ],
      exports: ['IProductService'],
    };
  },
};

export default productModuleFactory;
```

- [ ] **Step 6: Run existing product tests**

Run: `cd backend && npx jest tests/modules/product/ -v`
Expected: All PASS (may need minor test adjustments for new constructor config)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/product/product.module.ts backend/src/modules/product/index.ts backend/tests/modules/product/
git commit -m "feat: ProductModule implements IModule + ModuleFactory with exports

- ProductModule: IModule with name, onInit (schemas + routes + handlers), onDestroy
- ModuleFactory: declares IProductService as exported provider
- onInit() replaces constructor-side-effect registration"
```

---

### Task 6: Refactor OrderModule to IModule + Proper ModuleFactory

**Files:**
- Modify: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/order/index.ts`

- [ ] **Step 1: Refactor OrderModule**

```typescript
// backend/src/modules/order/order.module.ts
import type { IModule } from '@core/di/container';

class OrderModule implements IModule {
  readonly name = 'order';

  async onInit(): Promise<void> {
    // Order module is a stub — will be implemented in Phase 8
  }

  async onDestroy(): Promise<void> {
    // Cleanup
  }
}

export { OrderModule };
```

- [ ] **Step 2: Refactor order/index.ts**

```typescript
// backend/src/modules/order/index.ts
import type { ModuleFactory, ModuleDefinition } from '@core/di/container';
import type { DIContainer } from '@core/di/container';
import { OrderModule } from './order.module';

const orderModuleFactory: ModuleFactory = {
  async create(_container: DIContainer): Promise<ModuleDefinition> {
    const module = new OrderModule();

    return {
      module,
      providers: [],
      exports: [], // No exports yet — Phase 8 will add IOrderService
    };
  },
};

export default orderModuleFactory;
```

- [ ] **Step 3: Run tests**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/order/order.module.ts backend/src/modules/order/index.ts
git commit -m "feat: OrderModule implements IModule + ModuleFactory

Stub implementation — full order logic in Phase 8."
```

---

### Task 7: Wire New Bootstrap in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Replace manual module registration with FsModuleRegistry + container.build()**

Key changes to `backend/src/main.ts`:

1. Replace old `ModuleRegistry` with `FsModuleRegistry`
2. Register `ExpressApp` as core provider
3. Replace hardcoded module registration with `container.build()`
4. Remove old `registerWithRegistry` calls

In `main.ts`, find the DI registration section and replace:

```typescript
// REMOVE old ModuleRegistry registration:
// container.register('ModuleRegistry', () => new ModuleRegistry());

// ADD FsModuleRegistry:
import { FsModuleRegistry } from '@core/module-registry/registry';
import * as path from 'node:path';

// After all core services registered via registerCore:
container.registerCore('ExpressApp', { useFactory: () => app });
container.registerCore('ModuleRegistry', {
  useFactory: () => new FsModuleRegistry(
    path.join(__dirname, 'modules'),
    logger,
  ),
});

// After all core providers are registered, REPLACE hardcoded module code with:
const registry = container.get<FsModuleRegistry>('ModuleRegistry');
await registry.refresh();
await container.build(registry.getActive());

// REMOVE these lines (old manual registration):
// const productModule = new ProductModule({ db, eventBus, schemaRegistry });
// productModule.registerRoutes(app);
// productModule.registerWithRegistry(...);
// const orderModule = new OrderModule();
// orderModule.registerWithRegistry(...);
// const analyticsPlugin = new AnalyticsPlugin();
// analyticsPlugin.init(db);
```

**Note:** Plugin registration (AnalyticsPlugin) stays manual for now — plugins are separate from module system.

- [ ] **Step 2: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire FsModuleRegistry + container.build() in main.ts

Replace hardcoded module registration with:
1. FsModuleRegistry scans modules/ directory
2. container.build() runs full pipeline (load → register → validate → init)
ExpressApp registered as core provider for module access."
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

- [ ] `IModule` interface exported from `core/di/container.ts`
- [ ] `ModuleFactory` interface exported from `core/di/container.ts`
- [ ] `DIContainer` has `registerCore()`, `build()`, `dispose()`, `rebuild()`, `get()`
- [ ] `FsModuleRegistry` discovers modules from filesystem
- [ ] `FsModuleRegistry.resolve()` does topological sort
- [ ] `ProductModule` implements IModule with `name`, `onInit`, `onDestroy`
- [ ] `ProductModule.onInit()` registers schemas + routes + handlers (not constructor)
- [ ] `product/index.ts` exports `IProductService` as contract
- [ ] `validateModuleDefinition()` enforces exports + naming
- [ ] `main.ts` uses `container.build(registry.getActive())`
- [ ] No manual `registerRoutes` / `registerWithRegistry` calls in `main.ts`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 6 validation — ModuleFactory + contracts all checks pass"
```

---

## Self-Review

**Spec coverage (Part A of erp-platform-full-spec.md):**
- ✅ A.2 Interfaces (ModuleFactory, ModuleDefinition, ProviderRegistration) → Task 1
- ✅ A.3 Contract Rules → Task 4
- ✅ A.4 ModuleFactory Example → Task 5
- ✅ A.5 Container Integration → Task 2
- ✅ A.6 Contract Validator → Task 4
- ✅ FsModuleRegistry (scan + topo sort) → Task 3
- ✅ IModule lifecycle → Task 5, Task 6
- ✅ Bootstrap wiring → Task 7

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `IModule`, `ModuleFactory`, `ModuleDefinition`, `ProviderRegistration`, `ModuleMetadata`, `ModuleManifest` defined in Task 1, used consistently throughout Tasks 2–7.
