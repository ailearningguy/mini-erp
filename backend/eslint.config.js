import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import customRules from './scripts/eslint-rules.js';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: {
      'erp-architecture': {
        rules: customRules,
      },
    },
    rules: {
      'erp-architecture/no-cross-module-import': 'error',
      'erp-architecture/no-repository-in-plugin': 'error',
      'erp-architecture/no-core-event-from-plugin': 'error',
      'erp-architecture/no-outbox-direct-access': 'error',
      'erp-architecture/no-infra-config-import': 'error',
      'erp-architecture/no-plugin-import-from-module': 'error',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'erp-architecture/no-domain-keyword': 'error',
      'erp-architecture/no-domain-enum': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'database/', 'tests/'],
  },
);
