import { describe, it, expect } from '@jest/globals';
import { validateModuleDefinition } from '@core/module-factory/contract-validator';
import type { ModuleDefinition } from '@core/di/container';

describe('validateModuleDefinition', () => {
  const baseModule = {
    name: 'test',
    onInit: async () => {},
    onDestroy: async () => {},
  };

  it('should pass for valid definition with exports', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [
        { token: 'ITestService', useFactory: () => ({}), exported: true },
      ],
      exports: ['ITestService'],
    };

    expect(() => validateModuleDefinition(def, 'test')).not.toThrow();
  });

  it('should throw when no exports defined', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [{ token: 'TestService', useFactory: () => ({}) }],
    };

    expect(() => validateModuleDefinition(def, 'test')).toThrow(/must export at least one/i);
  });

  it('should throw when exported token not in providers', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [{ token: 'TestService', useFactory: () => ({}) }],
      exports: ['IMissingService'],
    };

    expect(() => validateModuleDefinition(def, 'test')).toThrow(/exports.*but no provider/i);
  });

  it('should throw when exported token does not start with I', () => {
    const def: ModuleDefinition = {
      module: baseModule as any,
      providers: [{ token: 'TestService', useFactory: () => ({}) }],
      exports: ['TestService'],
    };

    expect(() => validateModuleDefinition(def, 'test')).toThrow(/must start with.*I/i);
  });
});