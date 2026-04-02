import { describe, it, expect } from '@jest/globals';

describe('IPlugin interface', () => {
  it('should have init(db) method in IPlugin interface', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/plugin-system/plugin-loader.ts'),
      'utf-8',
    );

    const ipluginMatch = content.match(/interface IPlugin[\s\S]*?\}/);
    expect(ipluginMatch).not.toBeNull();
    expect(ipluginMatch![0]).toContain('init(');
  });
});