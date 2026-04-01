import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  database: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    user: z.string().min(1),
    password: z.string().min(1),
    name: z.string().min(1),
  }),
  jwt: z.object({
    publicKey: z.string().min(1),
    privateKey: z.string().min(1),
    accessTokenTtl: z.string().default('15m'),
    refreshTokenTtl: z.string().default('7d'),
  }),
  rabbitmq: z.object({
    url: z.string().url(),
  }),
  redis: z.object({
    url: z.string().min(1),
  }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const raw = {
    port: Number(process.env.PORT) || 3000,
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      name: process.env.DB_NAME || 'erp',
    },
    jwt: {
      publicKey: process.env.JWT_PUBLIC_KEY || '',
      privateKey: process.env.JWT_PRIVATE_KEY || '',
      accessTokenTtl: process.env.JWT_ACCESS_TTL || '15m',
      refreshTokenTtl: process.env.JWT_REFRESH_TTL || '7d',
    },
    rabbitmq: {
      url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    logLevel: process.env.LOG_LEVEL || 'info',
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error('CONFIGURATION ERROR — Application cannot start:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export { ConfigSchema };
