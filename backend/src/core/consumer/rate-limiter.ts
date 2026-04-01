interface RateLimitConfig {
  eventType: string;
  maxEventsPerSecond: number;
  burstAllowance?: number;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number,
    burstAllowance?: number,
  ) {
    this.tokens = burstAllowance ?? maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

class EventRateLimiter {
  private limiters = new Map<string, TokenBucket>();

  constructor(configs: RateLimitConfig[]) {
    for (const cfg of configs) {
      this.limiters.set(
        cfg.eventType,
        new TokenBucket(cfg.maxEventsPerSecond, cfg.maxEventsPerSecond, cfg.burstAllowance),
      );
    }
  }

  checkLimit(eventType: string): boolean {
    const limiter = this.limiters.get(eventType);
    if (!limiter) return true;
    return limiter.tryConsume();
  }
}

export { EventRateLimiter, TokenBucket };
export type { RateLimitConfig };
