import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { loadConfig } from '@core/config/config';
import { OutboxRepository } from './outbox.repository';
import { OutboxWorker } from './outbox-worker';

export async function startWorker(): Promise<OutboxWorker> {
  const config = loadConfig();

  const pool = new pg.Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  const db = drizzle(pool);
  const outboxRepo = new OutboxRepository(db as any);

  const amqp = await import('amqplib');
  const connection = await amqp.connect(config.rabbitmq.url);
  const channel = await connection.createChannel();

  const worker = new OutboxWorker(outboxRepo, channel as any);

  process.on('SIGTERM', async () => {
    console.log('[OutboxWorker] SIGTERM received, stopping...');
    await worker.stop();
    await channel.close();
    await connection.close();
    await pool.end();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[OutboxWorker] SIGINT received, stopping...');
    await worker.stop();
    await channel.close();
    await connection.close();
    await pool.end();
    process.exit(0);
  });

  await worker.start();
  return worker;
}

startWorker().catch((error) => {
  console.error('[OutboxWorker] Failed to start:', error);
  process.exit(1);
});
