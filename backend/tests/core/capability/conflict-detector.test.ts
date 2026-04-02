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

  it('should allow one exclusive handler', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability({ name: 'pricing', type: 'pipeline' });
    registry.registerHandler({ capability: 'pricing', exclusive: true, handle: async () => {} });

    expect(() => validateCapabilities(registry)).not.toThrow();
  });
});
