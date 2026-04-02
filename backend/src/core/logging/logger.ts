import pino from 'pino';
import { z } from 'zod';

const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info');

const rawLevel = process.env.LOG_LEVEL ?? 'info';
const result = LogLevelSchema.safeParse(rawLevel);

if (!result.success) {
  console.error(`Invalid LOG_LEVEL: "${rawLevel}". Must be one of: fatal, error, warn, info, debug, trace`);
  process.exit(1);
}

export const logger = pino({
  level: result.data,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    service: 'erp-backend',
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}