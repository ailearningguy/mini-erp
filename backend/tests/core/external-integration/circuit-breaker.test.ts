import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Core Independence — circuit-breaker', () => {
  it('should not contain hardcoded domain service names', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/external-integration/circuit-breaker.ts'),
      'utf-8',
    );
    expect(content).not.toContain('payment-gateway');
    expect(content).not.toContain('email-service');
    expect(content).not.toContain('defaultCircuitBreakerConfigs');
  });
});