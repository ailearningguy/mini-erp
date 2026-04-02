import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Core Independence — proxy.ts', () => {
  it('should not import PluginGuard class directly', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/external-integration/proxy.ts'),
      'utf-8',
    );
    expect(content).not.toMatch(/import\s+\{[^}]*PluginGuard[^}]*\}/);
    expect(content).toMatch(/IPermissionValidator/);
  });
});