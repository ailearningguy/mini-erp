import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createRateLimiter } from '@core/api/rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  let rateLimiterMiddleware: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    rateLimiterMiddleware = createRateLimiter(3, 1000);
  });

  function createMockReq(ip: string = '127.0.0.1') {
    return { ip, headers: {} } as any;
  }

  function createMockRes() {
    const headers: Record<string, string | number> = {};
    return {
      setHeader: (name: string, value: string | number) => { headers[name] = value; },
      _headers: headers,
    } as any;
  }

  it('should allow requests within limit', () => {
    const next = jest.fn();
    rateLimiterMiddleware(createMockReq(), createMockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject requests exceeding limit', () => {
    const next = jest.fn();
    for (let i = 0; i < 3; i++) {
      rateLimiterMiddleware(createMockReq('10.0.0.1'), createMockRes(), next);
    }
    expect(() => {
      rateLimiterMiddleware(createMockReq('10.0.0.1'), createMockRes(), next);
    }).toThrow(/Too many requests/);
  });

  it('should set rate limit headers on response', () => {
    const next = jest.fn();
    const res = createMockRes();
    rateLimiterMiddleware(createMockReq(), res, next);
    expect(res._headers['X-RateLimit-Limit']).toBe(3);
    expect(res._headers['X-RateLimit-Remaining']).toBe(2);
    expect(res._headers['X-RateLimit-Reset']).toBeDefined();
  });

  it('should track different IPs independently', () => {
    const next = jest.fn();
    for (let i = 0; i < 3; i++) {
      rateLimiterMiddleware(createMockReq('10.0.0.1'), createMockRes(), next);
    }
    expect(() => {
      rateLimiterMiddleware(createMockReq('10.0.0.2'), createMockRes(), next);
    }).not.toThrow();
  });
});