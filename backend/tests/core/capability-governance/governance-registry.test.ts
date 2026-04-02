import { describe, it, expect, beforeEach } from '@jest/globals';
import { CapabilityGovernanceRegistry } from '@core/capability-governance/governance-registry';
import type { CapabilityContract, VersionedCapabilityHandler } from '@core/capability-governance/types';

describe('CapabilityGovernanceRegistry', () => {
  let registry: CapabilityGovernanceRegistry;

  beforeEach(() => {
    registry = new CapabilityGovernanceRegistry();
  });

  describe('registerContract()', () => {
    it('should register a versioned contract', () => {
      const contract: CapabilityContract = {
        name: 'pricing',
        version: '1.2.0',
        type: 'pipeline',
        stages: ['base', 'discount', 'tax'],
        compatibility: { backwardCompatible: true },
      };

      registry.registerContract(contract);

      expect(registry.getContract('pricing')).toEqual(contract);
    });

    it('should also register as capability (inherited)', () => {
      registry.registerContract({
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        stages: ['base', 'tax'],
        compatibility: { backwardCompatible: true },
      });

      const cap = registry.getCapability('pricing');
      expect(cap?.name).toBe('pricing');
      expect(cap?.type).toBe('pipeline');
      expect(cap?.stages).toEqual(['base', 'tax']);
    });
  });

  describe('registerVersionedHandler()', () => {
    it('should register handler when version is compatible', () => {
      registry.registerContract({
        name: 'pricing',
        version: '1.2.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
      });

      const handler: VersionedCapabilityHandler = {
        capability: 'pricing',
        stage: 'base',
        supportedVersion: '^1.0.0',
        handle: async () => {},
      };

      registry.registerVersionedHandler(handler);

      expect(registry.getHandlers('pricing')).toHaveLength(1);
    });

    it('should throw when handler version is incompatible', () => {
      registry.registerContract({
        name: 'pricing',
        version: '2.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: false },
      });

      const handler: VersionedCapabilityHandler = {
        capability: 'pricing',
        supportedVersion: '^1.0.0',
        handle: async () => {},
      };

      expect(() => registry.registerVersionedHandler(handler)).toThrow(/incompatible/i);
    });

    it('should allow handler without contract (no version check)', () => {
      registry.registerCapability({
        name: 'pricing',
        type: 'pipeline',
        stages: ['base'],
      });

      const handler: VersionedCapabilityHandler = {
        capability: 'pricing',
        supportedVersion: '^1.0.0',
        handle: async () => {},
      };

      registry.registerVersionedHandler(handler);

      expect(registry.getHandlers('pricing')).toHaveLength(1);
    });
  });
});