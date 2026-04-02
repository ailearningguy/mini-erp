import { describe, it, expect } from '@jest/globals';
import { detectHookConflicts } from '@core/hooks/conflict-detector';
import type { HookRegistration } from '@core/hooks/types';

describe('detectHookConflicts', () => {
  it('should pass when no hooks', () => {
    expect(() => detectHookConflicts([])).not.toThrow();
  });

  it('should pass when different modules register on same point', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'inventory' },
    ];

    expect(() => detectHookConflicts(hooks)).not.toThrow();
  });

  it('should pass when different plugins register on same point', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'analytics' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'voucher' },
    ];

    expect(() => detectHookConflicts(hooks)).not.toThrow();
  });

  it('should detect duplicate module registration on same point:phase', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
    ];

    expect(() => detectHookConflicts(hooks)).toThrow(/duplicate/i);
  });

  it('should detect duplicate plugin registration on same point:phase', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'analytics' },
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, plugin: 'analytics' },
    ];

    expect(() => detectHookConflicts(hooks)).toThrow(/duplicate/i);
  });

  it('should allow same module on different point:phase combinations', () => {
    const hooks: HookRegistration[] = [
      { point: 'order.beforeCreate', phase: 'pre', handler: async () => {}, module: 'voucher' },
      { point: 'order.beforeCreate', phase: 'post', handler: async () => {}, module: 'voucher' },
      { point: 'order.afterCreate', phase: 'post', handler: async () => {}, module: 'voucher' },
    ];

    expect(() => detectHookConflicts(hooks)).not.toThrow();
  });
});