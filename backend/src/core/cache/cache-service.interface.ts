interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  invalidate(key: string): Promise<void>;
  getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T>;
  getWithFallback<T>(key: string, dbFactory: () => Promise<T>, ttl?: number): Promise<T>;
  getStats(): { hits: number; misses: number; hitRate: number };
  resetStats(): void;
}

export type { ICacheService };
