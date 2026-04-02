# Phase 4: Module Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ModuleInstaller (install/uninstall orchestration), REST API endpoints cho module management, và event schema/handler cleanup on module unload.

**Architecture:** ModuleInstaller orchestrates: validate manifest → trigger SoftRestartManager.restart(). REST endpoints expose install/uninstall/list operations. EventSchemaRegistry gets unregister/clear methods for cleanup.

**Tech Stack:** TypeScript, Express.js, Jest, Node.js fs/promises

**Spec Reference:** `docs/architecture/extended-architecture-implementation-spec.md` Part B.12, B.13

**Prerequisite:** Phase 0 + Phase 1 + Phase 2 + Phase 3 complete

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/module-installer/module-installer.ts` | Create | ModuleInstaller orchestration |
| `backend/src/core/module-installer/module.routes.ts` | Create | REST endpoints for module management |
| `backend/src/core/event-schema-registry/registry.ts` | Modify | Add unregister(), clear() |
| `backend/tests/core/module-installer/module-installer.test.ts` | Create | Unit tests |
| `backend/tests/core/event-schema-registry/registry.test.ts` | Modify | Tests for unregister/clear |
| `backend/src/main.ts` | Modify | Wire module routes |

---

### Task 1: Add EventSchemaRegistry Cleanup Methods

**Files:**
- Modify: `backend/src/core/event-schema-registry/registry.ts`
- Test: `backend/tests/core/event-schema-registry/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/event-schema-registry/registry.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { z } from 'zod';

describe('EventSchemaRegistry cleanup', () => {
  let registry: EventSchemaRegistry;

  beforeEach(() => {
    registry = new EventSchemaRegistry();
  });

  it('should unregister a specific event type', () => {
    registry.register('test.event.v1', z.object({ id: z.string() }));
    expect(registry.hasSchema('test.event.v1')).toBe(true);

    registry.unregister('test.event.v1');
    expect(registry.hasSchema('test.event.v1')).toBe(false);
  });

  it('unregister should be safe for non-existent type', () => {
    registry.unregister('nonexistent.v1');
    // Should not throw
  });

  it('should clear all schemas', () => {
    registry.register('event.a.v1', z.object({}));
    registry.register('event.b.v1', z.object({}));

    registry.clear();

    expect(registry.getRegisteredTypes()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/event-schema-registry/registry.test.ts -t "cleanup" -v`
Expected: FAIL — unregister/clear not defined

- [ ] **Step 3: Add methods to EventSchemaRegistry**

Add to `backend/src/core/event-schema-registry/registry.ts`:

```typescript
unregister(eventType: string): void {
  this.schemas.delete(eventType);
}

clear(): void {
  this.schemas.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/event-schema-registry/registry.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/event-schema-registry/registry.ts backend/tests/core/event-schema-registry/registry.test.ts
git commit -m "feat: add unregister() and clear() to EventSchemaRegistry

Needed for soft restart — clear module-registered schemas before rebuild."
```

---

### Task 2: Implement ModuleInstaller

**Files:**
- Create: `backend/src/core/module-installer/module-installer.ts`
- Create: `backend/tests/core/module-installer/module-installer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/module-installer/module-installer.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFs = {
  readFile: jest.fn(),
  readdir: jest.fn(),
  access: jest.fn(),
};

jest.mock('node:fs/promises', () => mockFs);

import { ModuleInstaller } from '@core/module-installer/module-installer';

describe('ModuleInstaller', () => {
  let installer: ModuleInstaller;
  let mocks: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mocks = {
      registry: {
        getByName: jest.fn(),
        getActive: jest.fn().mockReturnValue([]),
        refresh: jest.fn().mockResolvedValue([]),
      },
      restartManager: {
        restart: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };
    installer = new ModuleInstaller(
      mocks.registry,
      mocks.restartManager,
      '/fake/modules',
      mocks.logger,
    );
  });

  describe('install()', () => {
    it('should validate manifest and trigger restart', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        name: 'new-module',
        version: '2026.04.01',
        enabled: true,
        dependencies: [],
      }));
      mockFs.access.mockResolvedValue(undefined);

      await installer.install('new-module');

      expect(mocks.restartManager.restart).toHaveBeenCalledWith('install:new-module');
      expect(mocks.logger.info).toHaveBeenCalledWith(
        { module: 'new-module' },
        'module-installed',
      );
    });

    it('should throw on invalid manifest (missing name)', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        version: '2026.04.01',
        enabled: true,
      }));

      await expect(installer.install('bad-module')).rejects.toThrow(/invalid|missing/i);
    });

    it('should throw when dependency not satisfied', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        name: 'dependent-module',
        version: '2026.04.01',
        enabled: true,
        dependencies: ['nonexistent'],
      }));
      mockFs.access.mockResolvedValue(undefined);
      mocks.registry.getActive.mockReturnValue([]);
      mocks.registry.getByName.mockReturnValue(undefined);

      await expect(installer.install('dependent-module')).rejects.toThrow(/depend|not satisfied/i);
    });
  });

  describe('uninstall()', () => {
    it('should trigger restart for uninstall', async () => {
      mocks.registry.getByName.mockReturnValue({ name: 'test-module' });

      await installer.uninstall('test-module');

      expect(mocks.restartManager.restart).toHaveBeenCalledWith('uninstall:test-module');
      expect(mocks.logger.info).toHaveBeenCalledWith(
        { module: 'test-module' },
        'module-uninstalled',
      );
    });

    it('should throw when module not found', async () => {
      mocks.registry.getByName.mockReturnValue(undefined);

      await expect(installer.uninstall('unknown')).rejects.toThrow(/not found/i);
    });
  });

  describe('list()', () => {
    it('should return active modules', () => {
      mocks.registry.getActive.mockReturnValue([
        { name: 'product', version: '2026.04.01', enabled: true, dependencies: [] },
        { name: 'order', version: '2026.04.01', enabled: true, dependencies: ['product'] },
      ]);

      const list = installer.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('product');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/module-installer/module-installer.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create ModuleInstaller implementation**

```typescript
// backend/src/core/module-installer/module-installer.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ModuleRegistry } from '@core/module-registry/registry';
import type { SoftRestartManager } from '@core/restart/soft-restart-manager';
import type { ModuleManifest } from '@core/di/container';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class ModuleInstaller {
  constructor(
    private registry: ModuleRegistry,
    private restartManager: SoftRestartManager,
    private modulesDir: string,
    private logger: Logger,
  ) {}

  async install(moduleName: string): Promise<void> {
    // Step 1: Validate manifest
    const manifestPath = path.join(this.modulesDir, moduleName, 'module.json');
    const manifest = await this.validateManifest(manifestPath);

    // Step 2: Check dependencies
    const active = this.registry.getActive();
    for (const dep of manifest.dependencies ?? []) {
      if (!active.some(m => m.name === dep)) {
        throw new Error(`Dependency "${dep}" not satisfied for module "${moduleName}"`);
      }
    }

    // Step 3: Verify module directory exists
    try {
      await fs.access(path.join(this.modulesDir, moduleName));
    } catch {
      throw new Error(`Module directory not found: ${moduleName}`);
    }

    // Step 4: Trigger soft restart
    await this.restartManager.restart(`install:${moduleName}`);

    this.logger.info({ module: moduleName }, 'module-installed');
  }

  async uninstall(name: string): Promise<void> {
    const mod = this.registry.getByName(name);
    if (!mod) {
      throw new Error(`Module "${name}" not found in active modules`);
    }

    await this.restartManager.restart(`uninstall:${name}`);
    this.logger.info({ module: name }, 'module-uninstalled');
  }

  list(): { name: string; version: string; enabled: boolean; dependencies: { name: string; version: string }[] }[] {
    return this.registry.getActive().map(m => ({
      name: m.name,
      version: m.version,
      enabled: m.enabled,
      dependencies: m.dependencies,
    }));
  }

  private async validateManifest(manifestPath: string): Promise<ModuleManifest> {
    const content = await fs.readFile(manifestPath, 'utf-8');
    let manifest: ModuleManifest;
    try {
      manifest = JSON.parse(content);
    } catch {
      throw new Error(`Invalid manifest JSON: ${manifestPath}`);
    }

    if (!manifest.name || !manifest.version) {
      throw new Error(`Invalid manifest: missing name or version in ${manifestPath}`);
    }

    return manifest;
  }
}

export { ModuleInstaller };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/module-installer/module-installer.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/module-installer/module-installer.ts backend/tests/core/module-installer/module-installer.test.ts
git commit -m "feat: add ModuleInstaller for runtime module install/uninstall

- install(): validate manifest → check deps → soft restart
- uninstall(): verify active → soft restart
- list(): return active modules from registry"
```

---

### Task 3: Create Module REST Endpoints

**Files:**
- Create: `backend/src/core/module-installer/module.routes.ts`

- [ ] **Step 1: Create Express router for module endpoints**

```typescript
// backend/src/core/module-installer/module.routes.ts
import { Router } from 'express';
import type { ModuleInstaller } from './module-installer';
import type { Request, Response, NextFunction } from 'express';

function createModuleRoutes(moduleInstaller: ModuleInstaller): Router {
  const router = Router();

  // GET /api/v1/modules — list active modules
  router.get('/modules', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const modules = moduleInstaller.list();
      res.json({ data: modules });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/modules/install — install a module
  router.post('/modules/install', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Missing required field: name' },
        });
        return;
      }
      await moduleInstaller.install(name);
      res.json({ data: { status: 'installed', module: name } });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/modules/uninstall — uninstall a module
  router.post('/modules/uninstall', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Missing required field: name' },
        });
        return;
      }
      await moduleInstaller.uninstall(name);
      res.json({ data: { status: 'uninstalled', module: name } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export { createModuleRoutes };
```

- [ ] **Step 2: Wire in main.ts**

After container.build() and SoftRestartManager creation:

```typescript
import { ModuleInstaller } from '@core/module-installer/module-installer';
import { createModuleRoutes } from '@core/module-installer/module.routes';

const moduleInstaller = new ModuleInstaller(
  registry,
  softRestartManager,
  path.join(__dirname, 'modules'),
  logger,
);

// Mount module routes (after auth middleware)
app.use('/api/v1', authMiddleware(config));
app.use('/api/v1', createModuleRoutes(moduleInstaller));
```

- [ ] **Step 3: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/core/module-installer/module.routes.ts backend/src/main.ts
git commit -m "feat: add REST endpoints for module management

GET  /api/v1/modules           — list active modules
POST /api/v1/modules/install   — install module (triggers soft restart)
POST /api/v1/modules/uninstall — uninstall module (triggers soft restart)
All endpoints require auth."
```

---

### Task 4: Full Phase 4 Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Manual verification**

- [ ] EventSchemaRegistry has `unregister()` and `clear()`
- [ ] ModuleInstaller validates manifest before install
- [ ] ModuleInstaller checks dependencies
- [ ] `GET /api/v1/modules` returns active modules
- [ ] `POST /api/v1/modules/install` triggers SoftRestartManager
- [ ] `POST /api/v1/modules/uninstall` triggers SoftRestartManager
- [ ] 400 returned for missing `name` field

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 4 validation — module management all checks pass"
```

---

## Self-Review

**Spec coverage:**
- ✅ EventSchemaRegistry cleanup → Task 1
- ✅ ModuleInstaller → Task 2
- ✅ REST endpoints → Task 3

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `ModuleInstaller` constructor matches spec. Router uses standard Express patterns.
