import { describe, it, expect } from '@jest/globals';

describe('ESLint config scoping', () => {
  it('should scope no-cross-module-import to modules only', () => {
    const config = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../eslint.config.js'),
      'utf-8',
    );

    const broadBlock = config.match(/files:\s*\[\s*'src\/\*\*\/\*\.ts'\s*\][^}]*rules:\s*\{([^}]*)\}/s);
    if (broadBlock) {
      const rules = broadBlock[1];
      expect(rules).not.toContain('no-cross-module-import');
    }
  });

  it('should have a separate block for src/modules/**/*.ts', () => {
    const config = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../eslint.config.js'),
      'utf-8',
    );

    expect(config).toContain("src/modules/**/*.ts");
  });

  it('should have a separate block for src/plugins/**/*.ts', () => {
    const config = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../eslint.config.js'),
      'utf-8',
    );

    expect(config).toContain("src/plugins/**/*.ts");
  });
});