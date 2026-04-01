import pino from 'pino';

const logLevel = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level: logLevel,
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