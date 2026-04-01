import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/**/*.schema.ts',
  out: './database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'erp',
  },
});
