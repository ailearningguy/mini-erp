import { describe, it, expect } from '@jest/globals';

describe('product module factory', () => {
  it('should export contracts in ModuleDefinition', () => {
    const indexContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../src/modules/product/index.ts'),
      'utf-8',
    );

    const hasContracts = /contracts\s*:/.test(indexContent);
    expect(hasContracts).toBe(true);
  });

  it('should export pricingContract in contracts array', () => {
    const indexContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../src/modules/product/index.ts'),
      'utf-8',
    );

    const hasPricingContract = /pricingContract/.test(indexContent);
    expect(hasPricingContract).toBe(true);
  });
});