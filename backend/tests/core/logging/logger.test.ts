import { describe, it, expect } from '@jest/globals';
import { logger, createChildLogger } from '@core/logging/logger';

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