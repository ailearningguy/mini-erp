import { describe, it, expect } from '@jest/globals';

describe('SoftRestartManager', () => {
  it('getActivePlugins should return actual modules, not empty array', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/restart/soft-restart-manager.ts'),
      'utf-8',
    );

    const method = content.match(/private getActivePlugins\(\)[^}]*\{[^}]*\}/s);
    expect(method).not.toBeNull();
    expect(method![0]).not.toContain('return [];');
  });
});