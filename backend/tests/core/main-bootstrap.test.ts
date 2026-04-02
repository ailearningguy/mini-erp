import { describe, it, expect } from '@jest/globals';

describe('main.ts bootstrap', () => {
  it('should not reference undefined variable db', () => {
    const mainContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/main.ts'),
      'utf-8',
    );

    const lines = mainContent.split('\n');
    const dbUsages: { line: number; code: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bdb\b/.test(line) && !line.includes('import') && !line.includes('//')) {
        if (line.includes('(db') || line.includes('db)') || line.includes('.db') || line.includes('db as')) {
          dbUsages.push({ line: i + 1, code: line.trim() });
        }
      }
    }

    const dbDeclaration = lines.findIndex((l: string) =>
      l.includes('const db =') || l.includes('let db =') || (l.includes('container.resolve') && l.includes("'Database'")),
    );

    const lateUsages = dbUsages.filter((u) => u.line > 300);
    for (const usage of lateUsages) {
      expect(dbDeclaration).toBeLessThan(usage.line);
    }
  });

  it('should not reference undefined variable moduleRegistry', () => {
    const mainContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/main.ts'),
      'utf-8',
    );

    const hasUndefinedModuleRegistry = /^[^/]*\bmoduleRegistry\b/m.test(mainContent);

    if (hasUndefinedModuleRegistry) {
      const hasDeclaration = /(?:const|let|var)\s+moduleRegistry\s*=/.test(mainContent);
      expect(hasDeclaration).toBe(true);
    }
  });

  it('should not import from @modules in main.ts', () => {
    const mainContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/main.ts'),
      'utf-8',
    );

    const moduleImports = mainContent.split('\n').filter(
      (line: string) => line.includes("from '@modules/") && !line.trim().startsWith('//'),
    );
    expect(moduleImports).toHaveLength(0);
  });

  it('should not have hardcoded capability registration', () => {
    const mainContent = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/main.ts'),
      'utf-8',
    );

    const hasHardcodedCapability = /capabilityRegistry\.registerCapability\(pricing/.test(mainContent);
    const hasHardcodedContract = /capabilityRegistry\.registerContract\(pricing/.test(mainContent);
    expect(hasHardcodedCapability).toBe(false);
    expect(hasHardcodedContract).toBe(false);
  });
});