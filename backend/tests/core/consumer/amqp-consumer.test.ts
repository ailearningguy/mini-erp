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