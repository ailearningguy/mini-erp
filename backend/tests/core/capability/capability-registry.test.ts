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
