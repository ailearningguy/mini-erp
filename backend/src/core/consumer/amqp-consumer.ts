import { logger } from '@core/logging/logger';

interface AmqpConsumerConfig {
  rabbitmqUrl: string;
  exchange: string;
  queue: string;
  prefetchCount?: number;
}

interface AmqpConnection {
  createChannel(): Promise<AmqpChannel>;
  close(): Promise<void>;
  on(event: string, handler: (err: Error) => void): void;
}

interface AmqpChannel {
  assertExchange(exchange: string, type: string, options?: Record<string, unknown>): Promise<void>;
  assertQueue(queue: string, options?: Record<string, unknown>): Promise<{ queue: string }>;
  bindQueue(queue: string, exchange: string, pattern: string): Promise<void>;
  consume(queue: string, callback: (msg: AmqpMessage | null) => void): void;
  ack(message: AmqpMessage): void;
  nack(message: AmqpMessage, allUpTo?: boolean, requeue?: boolean): void;
  close(): Promise<void>;
  prefetch(count: number): void;
}

interface AmqpMessage {
  content: Buffer;
  fields: { deliveryTag: number };
  properties: Record<string, unknown>;
}

interface EventConsumerLike {
  consume(rawMessage: unknown): Promise<void>;
}

class AmqpConsumer {
  private connection: AmqpConnection | null = null;
  private channel: AmqpChannel | null = null;
  private _running = false;

  constructor(
    private readonly eventConsumer: EventConsumerLike,
    private readonly config: AmqpConsumerConfig,
  ) {}

  isRunning(): boolean {
    return this._running;
  }

  async connect(): Promise<void> {
    const amqp = await import('amqplib');
    this.connection = (await (amqp as any).connect(this.config.rabbitmqUrl)) as AmqpConnection;

    this.connection.on('error', (err: Error) => {
      logger.error({ err }, 'AMQP connection error');
    });

    this.channel = await this.connection.createChannel();

    if (this.config.prefetchCount) {
      this.channel.prefetch(this.config.prefetchCount);
    }

    await this.channel.assertExchange(this.config.exchange, 'topic', { durable: true });
    await this.channel.assertQueue(this.config.queue, { durable: true });

    await this.channel.bindQueue(this.config.queue, this.config.exchange, '#');

    this._running = true;
    logger.info({ exchange: this.config.exchange, queue: this.config.queue }, 'AMQP consumer connected');
  }

  async start(): Promise<void> {
    if (!this.channel) {
      throw new Error('AmqpConsumer not connected. Call connect() first.');
    }

    this.channel.consume(this.config.queue, async (msg: AmqpMessage | null) => {
      if (!msg) return;

      try {
        const rawEvent = JSON.parse(msg.content.toString());
        await this.eventConsumer.consume(rawEvent);
        this.channel!.ack(msg);
      } catch (error) {
        logger.error({ err: error, deliveryTag: msg.fields.deliveryTag }, 'Failed to process message');
        this.channel!.nack(msg, false, true);
      }
    });

    logger.info('AMQP consumer started, waiting for messages');
  }

  async shutdown(): Promise<void> {
    this._running = false;

    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    logger.info('AMQP consumer shut down');
  }
}

export { AmqpConsumer };
export type { AmqpConsumerConfig, EventConsumerLike };