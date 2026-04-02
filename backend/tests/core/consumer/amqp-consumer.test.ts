import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('amqplib', () => ({
  default: { connect: jest.fn(() => Promise.resolve({})) },
  connect: jest.fn(() => Promise.resolve({})),
}));

const { AmqpConsumer } = require('@core/consumer/amqp-consumer');

describe('AmqpConsumer', () => {
  it('should throw if connect is called without connection', async () => {
    const consumer = new AmqpConsumer({ consume: jest.fn() } as any, {
      rabbitmqUrl: 'amqp://localhost:5672',
      exchange: 'test',
      queue: 'test',
    });

    await expect(consumer.start()).rejects.toThrow('not connected');
  });
});

describe('AmqpConsumer pause/resume', () => {
  it('should have pause() method', () => {
    const consumer = new AmqpConsumer({ consume: jest.fn() } as any, {
      rabbitmqUrl: 'amqp://localhost:5672',
      exchange: 'test',
      queue: 'test',
    });
    expect(typeof consumer.pause).toBe('function');
  });

  it('should have resume() method', () => {
    const consumer = new AmqpConsumer({ consume: jest.fn() } as any, {
      rabbitmqUrl: 'amqp://localhost:5672',
      exchange: 'test',
      queue: 'test',
    });
    expect(typeof consumer.resume).toBe('function');
  });

  it('pause() should be safe to call when not connected', async () => {
    const consumer = new AmqpConsumer({ consume: jest.fn() } as any, {
      rabbitmqUrl: 'amqp://localhost:5672',
      exchange: 'test',
      queue: 'test',
    });
    await expect(consumer.pause()).resolves.not.toThrow();
  });

  it('resume() should be safe to call when not connected', async () => {
    const consumer = new AmqpConsumer({ consume: jest.fn() } as any, {
      rabbitmqUrl: 'amqp://localhost:5672',
      exchange: 'test',
      queue: 'test',
    });
    await expect(consumer.resume()).resolves.not.toThrow();
  });
});