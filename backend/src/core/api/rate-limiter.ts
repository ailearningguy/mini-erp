import type { Request, Response, NextFunction } from 'express';
import { API_CONSTANTS } from '@shared/constants';
import { AppError, ErrorCode } from '@shared/errors';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class SlidingWindowRateLimiter {
  private store = new Map<string, RateLimitEntry>();

  constructor(
    private readonly maxRequests: number = API_CONSTANTS.DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    private readonly windowMs: number = API_CONSTANTS.DEFAULT_RATE_LIMIT_WINDOW_MS,
  ) {}

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowMs };
    }

    entry.count++;
    const remaining = Math.max(0, this.maxRequests - entry.count);
    return { allowed: entry.count <= this.maxRequests, remaining, resetAt: entry.resetAt };
  }
}

export function createRateLimiter(
  maxRequests?: number,
  windowMs?: number,
): (req: Request, res: Response, next: NextFunction) => void {
  const limiter = new SlidingWindowRateLimiter(maxRequests, windowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (req.ip ?? req.headers['x-forwarded-for'] as string) ?? 'unknown';
    const result = limiter.check(key);

    res.setHeader('X-RateLimit-Limit', maxRequests ?? API_CONSTANTS.DEFAULT_RATE_LIMIT_MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        'Too many requests',
        429,
      );
    }

    next();
  };
}
