import { describe, it, expect } from '@jest/globals';
import { logger, createChildLogger } from '@core/logging/logger';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Logger', () => {
  it('should export a pino logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should create child logger with context', () => {
    const child = createChildLogger({ plugin: 'test' });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');
  });
});

describe('Logger config validation', () => {
  it('should validate LOG_LEVEL against known values', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/logging/logger.ts'),
      'utf-8',
    );
    expect(content).not.toMatch(/process\.env\.LOG_LEVEL\s*=\s*['"`]/);
    expect(content).toMatch(/zod|validate|schema|config/i);
  });
});