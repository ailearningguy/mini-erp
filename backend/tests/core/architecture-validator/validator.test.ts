import { describe, it, expect, beforeEach } from '@jest/globals';
import { ArchitectureValidator } from '@core/architecture-validator/validator';
import type { DependencyGraph, PluginRegistration, ServiceBinding } from '@core/architecture-validator/validator';

describe('ArchitectureValidator', () => {
  let validator: ArchitectureValidator;

  beforeEach(() => {
    validator = new ArchitectureValidator();
  });

  describe('validateDIGraph', () => {
    it('should detect cycles', async () => {
      const result = await validator.validateOnStartup(['A', 'B'], (token) => {
        if (token === 'A') return ['B'];
        if (token === 'B') return ['A'];
        return [];
      });
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Circular');
    });

    it('should pass with no cycles', async () => {
      const testTokens = ['EventBus', 'EventSchemaRegistry', 'OutboxRepository', 'Config', 'Database', 'A', 'B'];
      await expect(
        validator.validateOnStartup(testTokens, (token) => {
          if (token === 'A') return ['EventBus', 'B'];
          if (token === 'B') return ['EventBus'];
          return [];
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('validateNoCoreToModule', () => {
    it('should throw when core depends on module', () => {
      const graph: DependencyGraph = {
        nodes: ['EventBus', 'IProductService'],
        edges: [{ from: 'EventBus', to: 'IProductService' }],
      };
      const moduleTokens = ['IProductService', 'IOrderService'];
      expect(() => validator.validateNoCoreToModule(graph, moduleTokens)).toThrow(/Core must not depend on modules/);
    });

    it('should pass when no core-to-module edges', () => {
      const graph: DependencyGraph = {
        nodes: ['EventBus', 'IProductService'],
        edges: [{ from: 'IProductService', to: 'EventBus' }],
      };
      const moduleTokens = ['IProductService', 'IOrderService'];
      expect(() => validator.validateNoCoreToModule(graph, moduleTokens)).not.toThrow();
    });
  });

  describe('validateNoCoreToPlugin', () => {
    it('should throw when core depends on plugin', () => {
      const graph: DependencyGraph = {
        nodes: ['ProxyService', 'analytics'],
        edges: [{ from: 'ProxyService', to: 'analytics' }],
      };
      const pluginTokens = ['analytics'];
      expect(() => validator.validateNoCoreToPlugin(graph, pluginTokens)).toThrow(/Core must not depend on plugins/);
    });
  });

  describe('validatePluginGuards', () => {
    it('should pass for plugins with valid permissions', () => {
      const plugins: PluginRegistration[] = [
        {
          name: 'analytics',
          permissions: [{ resource: 'product', actions: ['read'] }],
          activatedAt: new Date(),
        },
      ];
      expect(() => validator.validatePluginGuards(plugins)).not.toThrow();
    });

    it('should throw for plugin with empty actions', () => {
      const plugins: PluginRegistration[] = [
        {
          name: 'bad-plugin',
          permissions: [{ resource: 'product', actions: [] }],
          activatedAt: new Date(),
        },
      ];
      expect(() => validator.validatePluginGuards(plugins)).toThrow(/Invalid permission/);
    });
  });

  describe('validateServiceInterfaces', () => {
    it('should pass for interface tokens bound to interface flag', () => {
      const bindings: ServiceBinding[] = [
        { token: 'IProductService', implementation: 'ProductService', isInterface: true },
      ];
      expect(() => validator.validateServiceInterfaces(bindings)).not.toThrow();
    });
  });

  describe('ArchitectureValidator with empty inputs', () => {
    it('should skip plugin validation when plugins array is empty', async () => {
      const testValidator = new ArchitectureValidator();
      const tokens = ['EventBus', 'Database', 'CacheService', 'EventSchemaRegistry', 'OutboxRepository', 'Config'];

      const result = await testValidator.validateOnStartup(
        tokens,
        () => [],
        {
          dependencyGraph: { nodes: tokens.map(t => t.toLowerCase()), edges: [] },
          plugins: [],
          serviceBindings: [],
        },
      );

      expect(result.valid).toBe(true);
    });

    it('should validate plugin permissions when plugins are provided', async () => {
      const testValidator = new ArchitectureValidator();
      const tokens = ['EventBus', 'Database', 'PluginLoader', 'EventSchemaRegistry', 'OutboxRepository', 'Config'];

      const result = await testValidator.validateOnStartup(
        tokens,
        () => [],
        {
          dependencyGraph: { nodes: tokens.map(t => t.toLowerCase()), edges: [] },
          plugins: [{
            name: 'analytics',
            permissions: [{ resource: 'product', actions: ['read'] }],
            activatedAt: new Date(),
          }],
          serviceBindings: [{ token: 'IProductService', implementation: 'ProductService', isInterface: true }],
        },
      );

      expect(result.valid).toBe(true);
    });
  });
});