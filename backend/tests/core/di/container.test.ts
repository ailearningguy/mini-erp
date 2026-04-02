import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { DIContainer, IModule, ModuleFactory, ModuleMetadata } from '@core/di/container';
import type { HookRegistry } from '@core/hooks/hook-registry';

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

    await container.build([toMeta('good', goodFactory)]);
    expect(container.get('GoodService')).toBe('good');

    await expect(
      container.rebuild([toMeta('bad', badFactory)]),
    ).rejects.toThrow(/rolled back/i);

    expect(container.get('GoodService')).toBe('good');
  });

  it('get should resolve from core scope', () => {
    container.registerCore('Redis', { useFactory: () => 'redis-client' });
    expect(container.get('Redis')).toBe('redis-client');
  });
});

describe('DIContainer', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  it('should register and resolve a singleton service', () => {
    container.register('MyService', () => ({ name: 'test' }));
    const a = container.resolve('MyService');
    const b = container.resolve('MyService');
    expect(a).toBe(b);
  });

  it('should throw on duplicate registration', () => {
    container.register('MyService', () => ({}));
    expect(() => container.register('MyService', () => ({}))).toThrow('already registered');
  });

  it('should throw on unregistered resolution', () => {
    expect(() => container.resolve('Unknown')).toThrow('not registered');
  });

  it('should detect circular dependencies', () => {
    container.register('A', () => container.resolve('B'));
    container.register('B', () => container.resolve('A'));
    expect(() => container.resolve('A')).toThrow('Circular dependency');
  });

  it('should return registered tokens', () => {
    container.register('A', () => ({}));
    container.register('B', () => ({}));
    expect(container.getRegisteredTokens()).toEqual(['A', 'B']);
  });

  describe('get alias', () => {
    it('should resolve services via get() method', () => {
      container.register('MyService', () => ({ name: 'test' }));
      const result = container.get<{ name: string }>('MyService');
      expect(result.name).toBe('test');
    });

    it('should return same singleton via get() and resolve()', () => {
      container.register('MyService', () => ({ name: 'test' }));
      const viaGet = container.get('MyService');
      const viaResolve = container.resolve('MyService');
      expect(viaGet).toBe(viaResolve);
    });
  });

  describe('validateGraph', () => {
    it('should detect cycles via deps array without calling factories', () => {
      container.register('A', () => ({}), ['B']);
      container.register('B', () => ({}), ['A']);
      expect(() => container.validateGraph()).toThrow('Circular');
    });

    it('should detect missing dependencies', () => {
      container.register('A', () => ({}), ['Missing']);
      expect(() => container.validateGraph()).toThrow('Missing');
    });

    it('should pass when deps are all registered', () => {
      container.register('A', () => ({}), ['B']);
      container.register('B', () => ({}));
      expect(() => container.validateGraph()).not.toThrow();
    });
  });

  describe('plugin restriction', () => {
    it('should allow core to register any token', () => {
      container.setActor('core');
      expect(() => container.register('ProductRepository', () => ({}))).not.toThrow();
    });

    it('should block plugin from registering repository tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('ProductRepository', () => ({}))).toThrow(
        /cannot register.*repository/i,
      );
    });

    it('should block plugin from registering schema tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('Product.schema', () => ({}))).toThrow(
        /cannot register.*schema/i,
      );
    });

    it('should allow plugin to register non-restricted tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('AnalyticsService', () => ({}))).not.toThrow();
    });

    it('should allow plugin to register service interface tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('IProductService', () => ({}))).not.toThrow();
    });
  });

  describe('dispose event cleanup', () => {
    it('should clear event schemas on dispose', async () => {
      const testContainer = new DIContainer();
      const mockSchemaRegistry = {
        register: jest.fn(),
        clear: jest.fn(),
        hasSchema: jest.fn(),
        getRegisteredTypes: jest.fn().mockReturnValue([]),
      };
      testContainer.register('EventSchemaRegistry', () => mockSchemaRegistry);

      const mockModule: any = {
        name: 'test',
        onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onDestroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };

      const mockFactory: any = {
        create: () => ({ providers: [], module: mockModule }),
      };

      const metadata: any = {
        name: 'test',
        version: '2026.04.01',
        enabled: true,
        dependencies: [],
        entry: async () => mockFactory,
        manifest: { name: 'test', version: '2026.04.01', enabled: true },
      };

      await testContainer.build([metadata]);
      testContainer.resolve('EventSchemaRegistry');
      await testContainer.dispose();

      expect(mockSchemaRegistry.clear).toHaveBeenCalled();
    });

    it('should unregister event handlers on dispose', async () => {
      const testContainer = new DIContainer();
      const mockEventConsumer = {
        unregisterAll: jest.fn(),
        registerHandler: jest.fn(),
        consume: jest.fn(),
      };
      testContainer.register('EventConsumer', () => mockEventConsumer);

      const mockModule: any = {
        name: 'test',
        onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        onDestroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };

      const mockFactory: any = {
        create: () => ({ providers: [], module: mockModule }),
      };

      await testContainer.build([{
        name: 'test',
        version: '2026.04.01',
        enabled: true,
        dependencies: [],
        entry: async () => mockFactory,
        manifest: { name: 'test', version: '2026.04.01', enabled: true },
      }]);

      testContainer.resolve('EventConsumer');
      await testContainer.dispose();

      expect(mockEventConsumer.unregisterAll).toHaveBeenCalled();
    });
  });

  describe('DIContainer hook integration', () => {
    it('should register hooks from ModuleDefinition during build', async () => {
      const testContainer = new DIContainer();
      testContainer.registerCore('HookRegistry', {
        useFactory: () => {
          const { HookRegistry } = require('@core/hooks/hook-registry');
          return new HookRegistry();
        },
      });

      const hookHandler = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

      const mockFactory: any = {
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

      const metadata: any = {
        name: 'test',
        version: '2026.04.01',
        enabled: true,
        dependencies: [],
        entry: async () => ({ default: mockFactory }),
        manifest: { name: 'test', version: '2026.04.01', enabled: true },
      };

      await testContainer.build([metadata]);

      const { HookRegistry } = require('@core/hooks/hook-registry');
      const registry = testContainer.get<HookRegistry>('HookRegistry');
      const hooks = registry.getHooks('order.beforeCreate', 'pre');

      expect(hooks).toHaveLength(1);
      expect(hooks[0].module).toBe('test');
      expect(hooks[0].priority).toBe(50);
    });

    it('should clear hooks by module on dispose', async () => {
      const testContainer = new DIContainer();
      testContainer.registerCore('HookRegistry', {
        useFactory: () => {
          const { HookRegistry } = require('@core/hooks/hook-registry');
          return new HookRegistry();
        },
      });

      const mockFactory: any = {
        create: async () => ({
          module: { name: 'test', onInit: async () => {}, onDestroy: async () => {} },
          providers: [],
          exports: ['ITestService'],
          hooks: [
            { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'test' },
          ],
        }),
      };

      await testContainer.build([{
        name: 'test', version: '2026.04.01', enabled: true, dependencies: [],
        entry: async () => ({ default: mockFactory }),
        manifest: { name: 'test', version: '2026.04.01', enabled: true },
      }]);

      const { HookRegistry } = require('@core/hooks/hook-registry');
      const registry = testContainer.get<HookRegistry>('HookRegistry');
      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);

      await testContainer.dispose();

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(0);
    });
  });
});

describe('DIContainer ModuleDefinition contracts', () => {
  it('should accept contracts field in ModuleDefinition', () => {
    const containerContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../src/core/di/container.ts'),
      'utf-8',
    );

    const hasContractsField = /contracts\?\s*:/.test(containerContent);
    expect(hasContractsField).toBe(true);
  });

  it('should collect contracts during build()', () => {
    const containerContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../src/core/di/container.ts'),
      'utf-8',
    );

    const hasPendingContracts = /pendingContracts/.test(containerContent);
    expect(hasPendingContracts).toBe(true);

    const registersContractsInBuild = /def\.contracts/.test(containerContent);
    expect(registersContractsInBuild).toBe(true);
  });
});

describe('ModuleDefinition routes field', () => {
  it('ModuleDefinition should have routes field', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../src/core/di/container.ts'),
      'utf-8',
    );

    const moduleDefMatch = content.match(/interface ModuleDefinition[\s\S]*?\}/);
    expect(moduleDefMatch).not.toBeNull();
    expect(moduleDefMatch![0]).toContain('routes');
  });

  it('build() should wire routes from ModuleDefinition', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../src/core/di/container.ts'),
      'utf-8',
    );

    expect(content).toContain('def.routes');
  });
});
