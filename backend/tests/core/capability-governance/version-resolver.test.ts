import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  resolveHandlerCompatibility,
  validateRequirements,
} from '@core/capability-governance/version-resolver';
import type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler } from '@core/capability-governance/types';
import { CapabilityGovernanceRegistry } from '@core/capability-governance/governance-registry';

describe('resolveHandlerCompatibility', () => {
  it('should pass when handler version satisfies contract', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '1.2.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).not.toThrow();
  });

  it('should throw when handler version does not satisfy contract', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      module: 'product',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).toThrow(/incompatible/i);
  });

  it('should allow old handler on new contract when backwardCompatible is true', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).not.toThrow();
  });

  it('should reject old handler on new contract when backwardCompatible is false', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      module: 'old-module',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).toThrow(/incompatible/i);
  });

  it('should pass when handler version exactly matches', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '1.0.0',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).not.toThrow();
  });
});

describe('validateRequirements', () => {
  let registry: CapabilityGovernanceRegistry;

  beforeEach(() => {
    registry = new CapabilityGovernanceRegistry();
  });

  it('should pass when all required capabilities are satisfied', () => {
    registry.registerContract({
      name: 'pricing',
      version: '1.2.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).not.toThrow();
  });

  it('should throw when required capability is missing', () => {
    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).toThrow(/missing required/i);
  });

  it('should pass when optional capability is missing', () => {
    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'optional' },
    ];

    expect(() => validateRequirements(reqs, registry)).not.toThrow();
  });

  it('should throw when version does not satisfy range', () => {
    registry.registerContract({
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).toThrow(/does not satisfy/i);
  });

  it('should warn on deprecated capability', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    registry.registerContract({
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
      deprecated: true,
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    validateRequirements(reqs, registry);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warnSpy.mockRestore();
  });

  it('should throw when capability has passed sunset date', () => {
    registry.registerContract({
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
      deprecated: true,
      sunsetDate: '2020-01-01',
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).toThrow(/sunset/i);
  });

  it('should pass when sunset date is in the future', () => {
    registry.registerContract({
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
      deprecated: true,
      sunsetDate: '2099-12-31',
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).not.toThrow();
  });
});