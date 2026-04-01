import { CACHE_CONSTANTS } from '@shared/constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface CacheLogger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

interface CacheMetrics {
  increment(metric: string, value?: number): void;
  timing(metric: string, durationMs: number): void;
}

interface CacheHooks {
  logger?: CacheLogger;
  metrics?: CacheMetrics;
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, duration: number): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  setnx(key: string, value: string, mode: string, duration: number): Promise<boolean>;
}

interface CacheConfig {
  ttl: number;
  strategy: 'cache-aside' | 'write-through';
  invalidation: 'event-driven' | 'ttl-only';
}

const NOOP_HOOKS: CacheHooks = {};

class CacheService {
  private mutexes = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly redis: RedisClient,
    private readonly hooks: CacheHooks = NOOP_HOOKS,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const start = Date.now();
    try {
      const data = await this.redis.get(`cache:${key}`);
      if (!data) {
        this.misses++;
        this.hooks.metrics?.increment('cache.miss');
        this.hooks.logger?.log('debug', 'Cache miss', { key, cacheKey: `cache:${key}` });
        return null;
      }
      this.hits++;
      this.hooks.metrics?.increment('cache.hit');
      this.hooks.logger?.log('debug', 'Cache hit', { key, cacheKey: `cache:${key}` });
      return JSON.parse(data) as T;
    } catch (error) {
      this.hooks.logger?.log('error', 'Cache get error', { key, error: String(error) });
      return null;
    } finally {
      this.hooks.metrics?.timing('cache.get.duration', Date.now() - start);
    }
  }

  async set<T>(key: string, value: T, ttl: number = CACHE_CONSTANTS.DEFAULT_TTL_SECONDS): Promise<void> {
    const start = Date.now();
    try {
      await this.redis.set(`cache:${key}`, JSON.stringify(value), 'EX', ttl);
      this.hooks.metrics?.increment('cache.set');
      this.hooks.logger?.log('debug', 'Cache set', { key, ttl });
    } catch (error) {
      this.hooks.logger?.log('error', 'Cache set error', { key, error: String(error) });
    } finally {
      this.hooks.metrics?.timing('cache.set.duration', Date.now() - start);
    }
  }

  async invalidate(key: string): Promise<void> {
    const start = Date.now();
    try {
      await this.redis.del(`cache:${key}`);
      this.hooks.metrics?.increment('cache.invalidate');
      this.hooks.logger?.log('debug', 'Cache invalidated', { key });
    } catch (error) {
      this.hooks.logger?.log('error', 'Cache invalidate error', { key, error: String(error) });
    } finally {
      this.hooks.metrics?.timing('cache.invalidate.duration', Date.now() - start);
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = CACHE_CONSTANTS.DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    let pending = this.mutexes.get(key) as Promise<T> | undefined;
    if (pending) {
      return pending;
    }

    pending = (async () => {
      try {
        return await this.acquireLockAndFetch(key, factory, ttl);
      } finally {
        this.mutexes.delete(key);
      }
    })();

    this.mutexes.set(key, pending);

    try {
      const result = await pending;
      return result;
    } catch (error) {
      this.mutexes.delete(key);
      throw error;
    }
  }

  private async acquireLockAndFetch<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number,
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    const lockTtlMs = CACHE_CONSTANTS.LOCK_TTL_MS;

    const acquired = await this.redis.setnx(lockKey, '1', 'PX', lockTtlMs);
    if (acquired) {
      try {
        const value = await factory();
        await this.set(key, value, ttl);
        return value;
      } finally {
        await this.redis.del(lockKey);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CACHE_CONSTANTS.LOCK_RETRY_DELAY_MS));
    const retryCached = await this.get<T>(key);
    if (retryCached !== null) return retryCached;

    return factory();
  }

  async getWithFallback<T>(
    key: string,
    dbFactory: () => Promise<T>,
    ttl: number = CACHE_CONSTANTS.DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const result = await dbFactory();
    await this.set(key, result, ttl);
    return result;
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

export { CacheService };
export type { CacheConfig, CacheHooks, CacheLogger, CacheMetrics, LogLevel };
