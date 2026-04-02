import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { checkDeprecations } from '@core/capability-governance/deprecation-checker';
import type { CapabilityContract } from '@core/capability-governance/types';

describe('checkDeprecations', () => {
  it('should not warn for non-deprecated contracts', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
      },
    ];

    checkDeprecations(contracts);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should warn for deprecated contracts', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
        deprecated: true,
      },
    ];

    checkDeprecations(contracts);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warnSpy.mockRestore();
  });

  it('should include sunset date in warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
        deprecated: true,
        sunsetDate: '2027-01-01',
      },
    ];

    checkDeprecations(contracts);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2027-01-01'));
    warnSpy.mockRestore();
  });

  it('should throw for contracts past sunset date', () => {
    const contracts: CapabilityContract[] = [
      {
        name: 'old-capability',
        version: '1.0.0',
        type: 'single',
        compatibility: { backwardCompatible: true },
        deprecated: true,
        sunsetDate: '2020-01-01',
      },
    ];

    expect(() => checkDeprecations(contracts)).toThrow(/sunset/i);
  });

  it('should not throw for contracts with future sunset date', () => {
    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
        deprecated: true,
        sunsetDate: '2099-12-31',
      },
    ];

    expect(() => checkDeprecations(contracts)).not.toThrow();
  });
});