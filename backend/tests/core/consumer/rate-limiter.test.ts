import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventRateLimiter, TokenBucket } from '@core/consumer/rate-limiter';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('TokenBucket', () => {
  it('should allow requests within limit', () => {
    const bucket = new TokenBucket(5, 5);
    for (let i = 0; i < 5; i++) {
      expect(bucket.tryConsume()).toBe(true);
    }
  });

  it('should reject requests exceeding limit', () => {
    const bucket = new TokenBucket(2, 2);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('should refill tokens over time', async () => {
    const bucket = new TokenBucket(1, 10); // 10 per second
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    // Wait for refill
    await new Promise((r) => setTimeout(r, 110));
    expect(bucket.tryConsume()).toBe(true);
  });
});

describe('EventRateLimiter', () => {
  it('should return true for unconfigured event types (no limit)', () => {
    const limiter = new EventRateLimiter([]);
    expect(limiter.checkLimit('unknown.event.v1')).toBe(true);
  });

  it('should enforce per-type rate limits', () => {
    const limiter = new EventRateLimiter([
      { eventType: 'product.created.v1', maxEventsPerSecond: 2 },
    ]);
    expect(limiter.checkLimit('product.created.v1')).toBe(true);
    expect(limiter.checkLimit('product.created.v1')).toBe(true);
    expect(limiter.checkLimit('product.created.v1')).toBe(false);
  });

  it('should not affect other event types', () => {
    const limiter = new EventRateLimiter([
      { eventType: 'product.created.v1', maxEventsPerSecond: 1 },
    ]);
    expect(limiter.checkLimit('product.created.v1')).toBe(true);
    expect(limiter.checkLimit('product.created.v1')).toBe(false);
    expect(limiter.checkLimit('order.created.v1')).toBe(true);
  });
});

describe('Core Independence — rate-limiter', () => {
  it('should not contain hardcoded domain event types', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/consumer/rate-limiter.ts'),
      'utf-8',
    );
    expect(content).not.toContain('product.created');
    expect(content).not.toContain('order.created');
    expect(content).not.toContain('inventory.reserved');
    expect(content).not.toContain('DEFAULT_EVENT_RATE_LIMITS');
  });
});