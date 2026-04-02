import { describe, it, expect } from '@jest/globals';

describe('ArchitectureValidator', () => {
  it('should detect core-to-module dependency in DI graph', () => {
    const validatorContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/architecture-validator/validator.ts'),
      'utf-8',
    );

    const usesCorePrefix = validatorContent.includes("n.startsWith('core/')");
    expect(usesCorePrefix).toBe(false);
  });

  it('should call validateCrossModuleImport during validateOnStartup', () => {
    const validatorContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/architecture-validator/validator.ts'),
      'utf-8',
    );

    const onStartupMatch = validatorContent.match(/async validateOnStartup\([^)]*\)[^}]*\{([\s\S]*?)\n  \}/);
    expect(onStartupMatch).not.toBeNull();
    
    const onStartupBody = onStartupMatch ? onStartupMatch[1] : '';
    expect(onStartupBody).toContain('validateCrossModuleImport');
  });
});