import { describe, it, expect } from '@jest/globals';

describe('Plugin config', () => {
  it('main.ts should read config/plugins.json', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/main.ts'),
      'utf-8',
    );

    const hasPluginConfig = content.includes('plugins.json') || content.includes('pluginConfig') || content.includes('pluginConfig');
    expect(hasPluginConfig).toBe(true);
  });
});