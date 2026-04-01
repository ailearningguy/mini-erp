import { API_CONSTANTS } from '@shared/constants';

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, duration: number): Promise<'OK' | null>;
  del(key: string): Promise<number>;
}

class ApiIdempotencyStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number = API_CONSTANTS.IDEMPOTENCY_TTL_SECONDS,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(`idempotency:${key}`);
    if (!data) return null;
    return JSON.parse(data) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.redis.set(
      `idempotency:${key}`,
      JSON.stringify(value),
      'EX',
      this.ttlSeconds,
    );
  }

  async has(key: string): Promise<boolean> {
    const data = await this.redis.get(`idempotency:${key}`);
    return data !== null;
  }
}

export { ApiIdempotencyStore };
