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
      await expect(
        validator.validateOnStartup(['A', 'B'], (token) => {
          if (token === 'A') return ['B'];
          if (token === 'B') return ['A'];
          return [];
        }),
      ).rejects.toThrow('Circular');
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
        nodes: ['core/event-bus', 'modules/product'],
        edges: [{ from: 'core/event-bus', to: 'modules/product' }],
      };
      expect(() => validator.validateNoCoreToModule(graph)).toThrow(/Core must not depend on modules/);
    });

    it('should pass when no core-to-module edges', () => {
      const graph: DependencyGraph = {
        nodes: ['core/event-bus', 'modules/product'],
        edges: [{ from: 'modules/product', to: 'core/event-bus' }],
      };
      expect(() => validator.validateNoCoreToModule(graph)).not.toThrow();
    });
  });

  describe('validateNoCoreToPlugin', () => {
    it('should throw when core depends on plugin', () => {
      const graph: DependencyGraph = {
        nodes: ['core/proxy', 'plugins/analytics'],
        edges: [{ from: 'core/proxy', to: 'plugins/analytics' }],
      };
      expect(() => validator.validateNoCoreToPlugin(graph)).toThrow(/Core must not depend on plugins/);
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
});