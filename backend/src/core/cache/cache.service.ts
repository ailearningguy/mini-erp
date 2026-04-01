import { CACHE_CONSTANTS } from '@shared/constants';

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

class CacheService {
  private mutexes = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(`cache:${key}`);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl = CACHE_CONSTANTS.DEFAULT_TTL_SECONDS): Promise<void> {
    try {
      await this.redis.set(`cache:${key}`, JSON.stringify(value), 'EX', ttl);
    } catch {
      // Fail-safe: cache write failure should not break the application
    }
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(`cache:${key}`);
    } catch {
      // Fail-safe: cache invalidation failure should not break the application
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl = CACHE_CONSTANTS.DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    let pending = this.mutexes.get(key) as Promise<T> | undefined;
    if (pending) {
      return pending;
    }

    pending = (async () => {
      try {
        return await factory();
      } finally {
        this.mutexes.delete(key);
      }
    })();

    this.mutexes.set(key, pending);

    try {
      const result = await pending;
      await this.set(key, result, ttl);
      return result;
    } catch (error) {
      this.mutexes.delete(key);
      throw error;
    }
  }

  async getWithFallback<T>(
    key: string,
    dbFactory: () => Promise<T>,
    ttl = CACHE_CONSTANTS.DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key);
      if (cached !== null) return cached;
    } catch {
      // Fail-safe: cache read failure — fallback to DB
    }

    const result = await dbFactory();
    await this.set(key, result, ttl);
    return result;
  }
}

const cacheDefaults: Record<string, CacheConfig> = {
  product: { ttl: 300, strategy: 'cache-aside', invalidation: 'event-driven' },
  user: { ttl: 60, strategy: 'cache-aside', invalidation: 'event-driven' },
  config: { ttl: 3600, strategy: 'write-through', invalidation: 'event-driven' },
};

export { CacheService, cacheDefaults };
export type { CacheConfig };
