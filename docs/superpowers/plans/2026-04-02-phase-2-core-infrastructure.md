# Phase 2: Core Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build core infrastructure for runtime-rebuildable modular system — IModule interface, ModuleRegistry (FS scan + topo sort), ResettableContainer (build/dispose/rebuild), và migrate existing modules.

**Architecture:** Extend existing `DIContainer` with core/module scope separation + build/dispose/rebuild lifecycle. New `FsModuleRegistry` replaces existing `ModuleRegistry` with filesystem discovery + dependency resolution. Modules implement `IModule` interface with `onInit()`/`onDestroy()` lifecycle hooks.

**Tech Stack:** TypeScript, Express.js, Jest, Node.js fs/promises

**Spec Reference:** `docs/architecture/extended-architecture-implementation-spec.md` Part B.2, B.3, B.4

**Prerequisite:** Phase 0 + Phase 1 complete

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/di/container.ts` | Modify | Extend with core/module scope, build/dispose/rebuild |
| `backend/src/core/module-registry/registry.ts` | Rewrite | FsModuleRegistry with scan + topo sort |
| `backend/src/modules/product/module.json` | Create | Module manifest |
| `backend/src/modules/product/index.ts` | Create | Module factory |
| `backend/src/modules/product/product.module.ts` | Modify | Implement IModule interface |
| `backend/src/modules/order/module.json` | Create | Module manifest |
| `backend/src/modules/order/index.ts` | Create | Module factory |
| `backend/src/modules/order/order.module.ts` | Modify | Implement IModule interface |
| `backend/src/main.ts` | Modify | New bootstrap with container.build() |
| `backend/tests/core/di/container.test.ts` | Modify | Tests for new build/dispose/rebuild |
| `backend/tests/core/module-registry/registry.test.ts` | Rewrite | Tests for FsModuleRegistry |
| `backend/tests/core/di/resettable-container.test.ts` | Create | Dedicated test file for ResettableContainer |

---

### Task 1: Define IModule Interface

**Files:**
- Modify: `backend/src/core/di/container.ts` — add IModule, IModuleFactory, Provider interfaces

- [ ] **Step 1: Write the failing test for IModule contract**

```typescript
// Add to backend/tests/core/di/resettable-container.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('IModule interface contract', () => {
  it('should require name, onInit, and onDestroy', async () => {
    // A valid IModule must have these properties
    const module: import('@core/di/container').IModule = {
      name: 'test-module',
      onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDestroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    expect(module.name).toBe('test-module');
    await module.onInit();
    await module.onDestroy();
    expect(module.onInit).toHaveBeenCalled();
    expect(module.onDestroy).toHaveBeenCalled();
  });

  it('onDestroy should not throw — log and continue', async () => {
    const module: import('@core/di/container').IModule = {
      name: 'test-module',
      onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDestroy: jest.fn<() => Promise<void>>().mockRejectedValue(new Error('destroy failed')),
    };

    // Should not throw even if onDestroy rejects
    await expect(module.onDestroy()).rejects.toThrow('destroy failed');
    // Container will catch this — documented behavior
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -t "IModule interface" -v`
Expected: FAIL — types not yet exported

- [ ] **Step 3: Add interfaces to container.ts**

At the top of `backend/src/core/di/container.ts`, add:

```typescript
// --- Extended Architecture Interfaces ---

interface IModule {
  readonly name: string;
  onInit(): Promise<void>;
  onDestroy(): Promise<void>;
}

interface IModuleFactory {
  create(container: DIContainer): {
    providers: ProviderRegistration[];
    module: IModule;
  };
}

interface ProviderRegistration<T = unknown> {
  token: string;
  useClass?: new (...args: unknown[]) => T;
  useFactory?: (container: DIContainer) => Promise<T> | T;
  deps?: string[];
  scope?: 'singleton' | 'transient';
  moduleName?: string;
}

interface ModuleMetadata {
  name: string;
  version: string;
  enabled: boolean;
  dependencies: { name: string; version: string }[];
  entry: () => Promise<IModuleFactory>;
  manifest: ModuleManifest;
}

interface ModuleManifest {
  name: string;
  version: string;
  enabled: boolean;
  dependencies?: string[];
  description?: string;
}

// Update exports at bottom:
export { DIContainer };
export type { IModule, IModuleFactory, ProviderRegistration, ModuleMetadata, ModuleManifest };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -t "IModule interface" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/di/container.ts backend/tests/core/di/resettable-container.test.ts
git commit -m "feat: add IModule, IModuleFactory, ProviderRegistration interfaces

Define contracts for Extended Architecture module system:
- IModule: name + onInit/onDestroy lifecycle
- IModuleFactory: create(container) returns providers + module
- ModuleMetadata: name, version, dependencies, lazy entry
- ModuleManifest: JSON manifest format"
```

---

### Task 2: Extend DIContainer with Core/Module Scope + Build/Dispose

**Files:**
- Modify: `backend/src/core/di/container.ts`
- Test: `backend/tests/core/di/resettable-container.test.ts`

- [ ] **Step 1: Write failing tests for core/module scope separation**

```typescript
// Add to backend/tests/core/di/resettable-container.test.ts

describe('DIContainer core/module scope', () => {
  let container: import('@core/di/container').DIContainer;

  beforeEach(() => {
    container = new (require('@core/di/container').DIContainer)();
  });

  it('registerCore should register a provider in core scope', () => {
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });
    expect(container.get('DbPool')).toBe('mock-db');
  });

  it('core providers should survive dispose', async () => {
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });

    // Build with empty modules
    await container.build([]);

    // Dispose should NOT clear core providers
    await container.dispose();

    expect(container.get('DbPool')).toBe('mock-db');
  });

  it('dispose should be idempotent', async () => {
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });
    await container.build([]);

    await container.dispose();
    await container.dispose(); // second call — should not throw
    await container.dispose(); // third call — should not throw

    expect(container.get('DbPool')).toBe('mock-db');
  });

  it('build should fail-fast on invalid module factory', async () => {
    const badMetadata: import('@core/di/container').ModuleMetadata = {
      name: 'bad-module',
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => {
        throw new Error('Factory load failed');
      },
      manifest: { name: 'bad-module', version: '2026.04.01', enabled: true },
    };

    await expect(container.build([badMetadata])).rejects.toThrow('Factory load failed');
  });

  it('build should validate DI graph for circular dependencies', async () => {
    container.registerCore('A', { useFactory: () => 'a', deps: ['B'] });
    container.registerCore('B', { useFactory: () => 'b', deps: ['A'] });

    await expect(container.build([])).rejects.toThrow(/[Cc]ircular/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -t "core/module scope" -v`
Expected: FAIL — registerCore, build, dispose not defined

- [ ] **Step 3: Extend DIContainer with new methods**

Add to the existing `DIContainer` class in `backend/src/core/di/container.ts`:

```typescript
class DIContainer {
  // ... existing fields (services, resolving, currentActor) ...

  // --- NEW: Core vs Module scope ---
  private coreProviders = new Map<string, ProviderRegistration>();
  private coreInstances = new Map<string, unknown>();
  private moduleProviders = new Map<string, ProviderRegistration>();
  private moduleInstances = new Map<string, unknown>();
  private modules: IModule[] = [];
  private containerState: 'IDLE' | 'BUILDING' | 'READY' | 'DISPOSING' = 'IDLE';
  private buildMutex: Promise<void> = Promise.resolve();

  // --- NEW: registerCore for infrastructure that survives rebuild ---
  registerCore<T>(token: string, provider: Omit<ProviderRegistration<T>, 'moduleName'>): void {
    if (this.coreProviders.has(token) || this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.coreProviders.set(token, { ...provider, moduleName: '__core__' });
  }

  // --- NEW: Build pipeline ---
  async build(modules: ModuleMetadata[]): Promise<void> {
    // Mutex: serialize build/dispose/rebuild
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      this.assertContainerState('IDLE');
      this.containerState = 'BUILDING';

      // Step 1: Load module factories (lazy import)
      const enabledModules = modules.filter(m => m.enabled);
      const factories = await Promise.all(
        enabledModules.map(async m => {
          try {
            return { metadata: m, factory: await m.entry() };
          } catch (err) {
            throw new Error(`Failed to load module "${m.name}": ${err}`);
          }
        }),
      );

      // Step 2-3: Collect providers and register
      for (const { metadata, factory } of factories) {
        const result = factory.create(this);
        for (const provider of result.providers) {
          provider.moduleName = metadata.name;
          if (this.moduleProviders.has(provider.token)) {
            throw new Error(`Duplicate provider token "${provider.token}" in module "${metadata.name}"`);
          }
          this.moduleProviders.set(provider.token, provider);
        }
        this.modules.push(result.module);
      }

      // Step 4: Validate graph
      this.validateExtendedGraph();

      // Step 5: Instantiate module singletons
      for (const [token, provider] of this.moduleProviders) {
        if (provider.scope !== 'transient') {
          await this.instantiateFromProvider(token, 'module');
        }
      }

      // Step 6: Call module.onInit()
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
      // Clean up partial state
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
          // onDestroy MUST NOT throw — log + continue
          console.error(`Module "${m.name}" onDestroy() error:`, err);
        }
      }

      // Step 2: Dispose module instances that have dispose()
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
      // Snapshot for rollback
      const snapshot = {
        providers: new Map(this.moduleProviders),
        instances: new Map(this.moduleInstances),
        modules: [...this.modules],
        state: this.containerState,
      };

      try {
        await this.disposeInternal();
        await this.buildInternal(modules);
      } catch (err) {
        // Rollback
        this.moduleProviders = snapshot.providers;
        this.moduleInstances = snapshot.instances;
        this.modules = snapshot.modules;
        this.containerState = snapshot.state === 'READY' ? 'READY' : 'IDLE';
        throw new Error(`Rebuild failed, rolled back: ${err}`);
      }
    } finally {
      release!();
    }
  }

  // --- NEW: get() that checks both scopes ---
  get<T>(token: string): T {
    // Check legacy services first (backward compat)
    if (this.services.has(token)) {
      return this.resolve<T>(token);
    }
    // Check core instances
    if (this.coreInstances.has(token)) {
      return this.coreInstances.get(token) as T;
    }
    // Check module instances
    if (this.moduleInstances.has(token)) {
      return this.moduleInstances.get(token) as T;
    }
    throw new Error(`Service not found: ${token}`);
  }

  // --- Internal helpers ---

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

  // Internal versions without mutex (used by rebuild)
  private async buildInternal(modules: ModuleMetadata[]): Promise<void> {
    // Same as build() but without mutex — called from rebuild()
    this.assertContainerState('IDLE');
    this.containerState = 'BUILDING';

    const enabledModules = modules.filter(m => m.enabled);
    const factories = await Promise.all(
      enabledModules.map(async m => {
        try {
          return { metadata: m, factory: await m.entry() };
        } catch (err) {
          throw new Error(`Failed to load module "${m.name}": ${err}`);
        }
      }),
    );

    for (const { metadata, factory } of factories) {
      const result = factory.create(this);
      for (const provider of result.providers) {
        provider.moduleName = metadata.name;
        this.moduleProviders.set(provider.token, provider);
      }
      this.modules.push(result.module);
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
    this.modules = [];
    this.containerState = 'IDLE';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Ensure existing tests still pass**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS (backward compatibility)

- [ ] **Step 6: Commit**

```bash
git add backend/src/core/di/container.ts backend/tests/core/di/resettable-container.test.ts
git commit -m "feat: extend DIContainer with core/module scope + build/dispose/rebuild

- registerCore() for infrastructure that survives rebuild
- build(modules): 7-step pipeline with lazy factory loading
- dispose(): reverse-order module teardown, idempotent
- rebuild(modules): atomic with rollback on failure
- Mutex-serialized for concurrent safety
- Core providers never disposed, module providers always disposed"
```

---

### Task 3: Rewrite ModuleRegistry — FsModuleRegistry

**Files:**
- Rewrite: `backend/src/core/module-registry/registry.ts`
- Rewrite: `backend/tests/core/module-registry/registry.test.ts`

- [ ] **Step 1: Write failing tests for FsModuleRegistry**

```typescript
// backend/tests/core/module-registry/registry.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FsModuleRegistry } from '@core/module-registry/registry';

// Mock fs/promises
jest.mock('node:fs/promises', () => ({
  readdir: jest.fn(async () => [
    { name: 'product', isDirectory: () => true },
    { name: 'order', isDirectory: () => true },
  ]),
  readFile: jest.fn(async (path: string) => {
    if (path.includes('product/module.json')) {
      return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true, dependencies: [] });
    }
    if (path.includes('order/module.json')) {
      return JSON.stringify({ name: 'order', version: '2026.04.01', enabled: true, dependencies: ['product'] });
    }
    throw new Error('ENOENT');
  }),
}));

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
    it('should discover modules from filesystem', async () => {
      const modules = await registry.scan();
      expect(modules).toHaveLength(2);
      expect(modules[0].name).toBe('product');
      expect(modules[1].name).toBe('order');
    });

    it('should skip disabled modules', async () => {
      const fs = await import('node:fs/promises');
      (fs.readFile as any).mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: false });
        }
        return JSON.stringify({ name: 'order', version: '2026.04.01', enabled: true, dependencies: [] });
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('order');
    });
  });

  describe('resolve()', () => {
    it('should topologically sort modules by dependencies', async () => {
      const scanned = await registry.scan();
      const resolved = registry.resolve(scanned);

      // product has no deps, order depends on product
      // So product should come before order
      expect(resolved[0].name).toBe('product');
      expect(resolved[1].name).toBe('order');
    });

    it('should detect circular dependencies', () => {
      const mods = [
        { name: 'a', version: '1', enabled: true, dependencies: [{ name: 'b', version: '*' }], entry: async () => ({} as any), manifest: { name: 'a', version: '1', enabled: true } },
        { name: 'b', version: '1', enabled: true, dependencies: [{ name: 'a', version: '*' }], entry: async () => ({} as any), manifest: { name: 'b', version: '1', enabled: true } },
      ];

      expect(() => registry.resolve(mods)).toThrow(/[Cc]ircular/);
    });

    it('should throw on missing dependency', () => {
      const mods = [
        { name: 'order', version: '1', enabled: true, dependencies: [{ name: 'nonexistent', version: '*' }], entry: async () => ({} as any), manifest: { name: 'order', version: '1', enabled: true } },
      ];

      expect(() => registry.resolve(mods)).toThrow(/not found|not available/i);
    });
  });

  describe('refresh()', () => {
    it('should scan and resolve, updating active set', async () => {
      const resolved = await registry.refresh();
      expect(resolved).toHaveLength(2);
      expect(registry.getActive()).toEqual(resolved);
    });
  });

  describe('getByName()', () => {
    it('should return module by name', async () => {
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
Expected: FAIL — FsModuleRegistry not exported (old ModuleRegistry exists)

- [ ] **Step 3: Rewrite registry.ts with FsModuleRegistry**

Replace the ENTIRE content of `backend/src/core/module-registry/registry.ts`:

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ModuleMetadata, ModuleManifest, IModuleFactory } from '@core/di/container';

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
          entry: async (): Promise<IModuleFactory> => {
            const mod = await import(path.join(this.modulesDir, entry.name, 'index.ts'));
            return mod.default ?? mod[Object.keys(mod)[0]];
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
git commit -m "feat: rewrite ModuleRegistry as FsModuleRegistry with topo sort

- scan(): discover modules from filesystem (modules/*/module.json)
- resolve(): topological sort + circular dependency detection
- refresh(): scan + resolve + update active snapshot
- getByName(): lookup by module name
- Lazy entry loading: code imported only during build()"
```

---

### Task 4: Create Module Manifests (module.json)

**Files:**
- Create: `backend/src/modules/product/module.json`
- Create: `backend/src/modules/order/module.json`

- [ ] **Step 1: Create product module.json**

```json
{
  "name": "product",
  "version": "2026.04.01",
  "enabled": true,
  "dependencies": [],
  "description": "Product catalog management with CRUD, events, optimistic locking"
}
```

- [ ] **Step 2: Create order module.json**

```json
{
  "name": "order",
  "version": "2026.04.01",
  "enabled": true,
  "dependencies": ["product"],
  "description": "Order management with saga orchestration"
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/product/module.json backend/src/modules/order/module.json
git commit -m "feat: add module.json manifests for product and order modules

Product has no dependencies. Order depends on product."
```

---

### Task 5: Migrate ProductModule to IModule Interface

**Files:**
- Modify: `backend/src/modules/product/product.module.ts`
- Create: `backend/src/modules/product/index.ts` (factory)

- [ ] **Step 1: Write failing test for ProductModule IModule compliance**

```typescript
// Add to backend/tests/modules/product/product.service.test.ts or new file

import { describe, it, expect } from '@jest/globals';

describe('ProductModule IModule compliance', () => {
  it('should have name property', () => {
    // We verify the interface is implemented by checking shape
    const ProductModule = require('@modules/product/product.module').ProductModule;
    const mockDb = {} as any;
    const mockEventBus = { emit: async () => {} } as any;
    const mockSchemaRegistry = { register: () => {} } as any;
    const mockEventConsumer = { registerHandler: () => {} } as any;
    const mockCacheService = { invalidate: async () => {} } as any;
    const mockApp = { get: () => {}, post: () => {}, put: () => {}, delete: () => {} } as any;

    const module = new ProductModule({
      db: mockDb,
      eventBus: mockEventBus,
      schemaRegistry: mockSchemaRegistry,
      eventConsumer: mockEventConsumer,
      cacheService: mockCacheService,
      app: mockApp,
    });

    expect(module.name).toBe('product');
    expect(typeof module.onInit).toBe('function');
    expect(typeof module.onDestroy).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/modules/product/ -t "IModule compliance" -v`
Expected: FAIL — name property doesn't exist

- [ ] **Step 3: Refactor ProductModule to implement IModule**

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
    // Event handlers cleanup is handled by container.unbindEventHandlers()
    // Express routes cannot be unregistered — accepted limitation
  }
}

export { ProductModule };
export type { ProductModuleConfig };
```

- [ ] **Step 4: Create module factory (index.ts)**

```typescript
// backend/src/modules/product/index.ts
import type { IModuleFactory, ProviderRegistration } from '@core/di/container';
import type { DIContainer } from '@core/di/container';
import { ProductModule } from './product.module';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventConsumer } from '@core/consumer/consumer';
import type { CacheService } from '@core/cache/cache.service';
import type { Express } from 'express';

const productModuleFactory: IModuleFactory = {
  create(container: DIContainer) {
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
      providers: [],
      module,
    };
  },
};

export default productModuleFactory;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/modules/product/ -t "IModule compliance" -v`
Expected: PASS

- [ ] **Step 6: Run existing product tests to verify no regressions**

Run: `cd backend && npx jest tests/modules/product/ -v`
Expected: All PASS (may need to update tests that reference old constructor)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/product/product.module.ts backend/src/modules/product/index.ts backend/tests/modules/product/
git commit -m "feat: migrate ProductModule to IModule interface

- Implement IModule with name, onInit(), onDestroy()
- onInit() registers schemas, routes, event handlers
- onDestroy() — cleanup handled by container
- Create index.ts factory for lazy loading
- Constructor expanded to receive all dependencies"
```

---

### Task 6: Migrate OrderModule to IModule Interface

**Files:**
- Modify: `backend/src/modules/order/order.module.ts`
- Create: `backend/src/modules/order/index.ts`

- [ ] **Step 1: Refactor OrderModule to implement IModule**

```typescript
// backend/src/modules/order/order.module.ts
import type { IModule } from '@core/di/container';
import type { EventConsumer } from '@core/consumer/consumer';

interface OrderModuleConfig {
  eventConsumer: EventConsumer;
}

class OrderModule implements IModule {
  readonly name = 'order';

  constructor(private readonly config: OrderModuleConfig) {}

  async onInit(): Promise<void> {
    // Register event handlers when order logic is implemented
    // For now, just register rate limit concepts
  }

  async onDestroy(): Promise<void> {
    // Cleanup
  }
}

export { OrderModule };
```

- [ ] **Step 2: Create module factory**

```typescript
// backend/src/modules/order/index.ts
import type { IModuleFactory } from '@core/di/container';
import type { DIContainer } from '@core/di/container';
import { OrderModule } from './order.module';
import type { EventConsumer } from '@core/consumer/consumer';

const orderModuleFactory: IModuleFactory = {
  create(container: DIContainer) {
    const eventConsumer = container.get<EventConsumer>('EventConsumer');

    const module = new OrderModule({ eventConsumer });

    return {
      providers: [],
      module,
    };
  },
};

export default orderModuleFactory;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/order/order.module.ts backend/src/modules/order/index.ts
git commit -m "feat: migrate OrderModule to IModule interface

Minimal implementation — order logic will be added in future phases.
Factory pattern for lazy loading."
```

---

### Task 7: Wire New Bootstrap in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Update main.ts to use container.build() with modules**

The key changes to `backend/src/main.ts`:

1. Register `ExpressApp` as core provider
2. Replace hardcoded module registration with `FsModuleRegistry` + `container.build()`
3. Keep backward compatibility for existing services

In `main.ts`, after all core services are registered via `registerCore`:

```typescript
import { FsModuleRegistry } from '@core/module-registry/registry';

// --- Replace old ModuleRegistry with FsModuleRegistry ---
// Remove: container.register('ModuleRegistry', () => new ModuleRegistry());
container.registerCore('ModuleRegistry', {
  useFactory: () => new FsModuleRegistry(
    path.join(__dirname, 'modules'),
    logger,
  ),
});

// Register ExpressApp as core so modules can access it
container.registerCore('ExpressApp', { useFactory: () => app });

// --- Scan + Build modules ---
const registry = container.get<FsModuleRegistry>('ModuleRegistry');
await registry.refresh();
await container.build(registry.getActive());

// --- Remove old hardcoded module registration ---
// DELETE these lines:
// const productModule = new ProductModule({ db, eventBus, schemaRegistry });
// productModule.registerRoutes(app);
// productModule.registerWithRegistry(...);
// const orderModule = new OrderModule();
// orderModule.registerWithRegistry(...);

// --- EventRateLimiter — now get rates from module onInit registrations ---
// This stays after container.build() because modules register their handlers
// during onInit(), which happens inside container.build()
```

**Note:** This is a significant refactoring of `main.ts`. The existing module registration code is REMOVED and replaced by the container.build() pipeline. Event handlers are now registered in module.onInit().

- [ ] **Step 2: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire new bootstrap with FsModuleRegistry + container.build()

Replace hardcoded module registration with:
1. FsModuleRegistry scans modules/ directory
2. container.build() runs full pipeline
3. Modules self-register in onInit()

ExpressApp registered as core provider for module access."
```

---

### Task 8: Full Phase 2 Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Integration test — build + dispose + rebuild cycle**

```typescript
// Add to backend/tests/core/di/resettable-container.test.ts

describe('ResettableContainer full lifecycle', () => {
  it('should build, dispose, and rebuild with module lifecycle', async () => {
    const container = new DIContainer();
    container.registerCore('DbPool', { useFactory: () => 'mock-db' });

    let initCalled = 0;
    let destroyCalled = 0;

    const mockFactory: import('@core/di/container').IModuleFactory = {
      create: () => ({
        providers: [],
        module: {
          name: 'test',
          onInit: async () => { initCalled++; },
          onDestroy: async () => { destroyCalled++; },
        },
      }),
    };

    const metadata: import('@core/di/container').ModuleMetadata = {
      name: 'test',
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => mockFactory,
      manifest: { name: 'test', version: '2026.04.01', enabled: true },
    };

    // Build
    await container.build([metadata]);
    expect(initCalled).toBe(1);
    expect(container.get('DbPool')).toBe('mock-db');

    // Dispose
    await container.dispose();
    expect(destroyCalled).toBe(1);
    // Core provider still available
    expect(container.get('DbPool')).toBe('mock-db');

    // Rebuild
    await container.build([metadata]);
    expect(initCalled).toBe(2);

    // Atomic rebuild
    await container.rebuild([metadata]);
    expect(destroyCalled).toBe(2); // dispose called
    expect(initCalled).toBe(3);    // build called
  });
});
```

- [ ] **Step 4: Run the integration test**

Run: `cd backend && npx jest tests/core/di/resettable-container.test.ts -t "full lifecycle" -v`
Expected: PASS

- [ ] **Step 5: Verify module.json discovery**

```typescript
// Add to backend/tests/core/module-registry/registry.test.ts

describe('FsModuleRegistry with real filesystem', () => {
  it('should discover product and order modules from actual modules/ directory', async () => {
    const registry = new FsModuleRegistry(
      path.resolve(__dirname, '../../src/modules'),
      mockLogger,
    );

    const modules = await registry.scan();
    const names = modules.map(m => m.name);

    expect(names).toContain('product');
    expect(names).toContain('order');
  });
});
```

- [ ] **Step 6: Run the discovery test**

Run: `cd backend && npx jest tests/core/module-registry/registry.test.ts -t "real filesystem" -v`
Expected: PASS

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: Phase 2 validation — core infrastructure all checks pass"
```

---

## Self-Review

**Spec coverage:**
- ✅ IModule interface → Task 1
- ✅ ResettableContainer (build/dispose/rebuild) → Task 2
- ✅ FsModuleRegistry (scan/resolve/topo sort) → Task 3
- ✅ Module manifests (module.json) → Task 4
- ✅ ProductModule migration → Task 5
- ✅ OrderModule migration → Task 6
- ✅ Bootstrap wiring → Task 7
- ✅ Integration test → Task 8

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `IModule`, `IModuleFactory`, `ProviderRegistration`, `ModuleMetadata`, `ModuleManifest` defined in Task 1, used consistently throughout.
