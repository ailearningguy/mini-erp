import { createHash } from 'node:crypto';

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, seconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class TokenRevocationService {
  constructor(private readonly redis: RedisClient) {}

  private getKey(token: string): string {
    return `token:revoked:${this.hashToken(token)}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async isRevoked(token: string): Promise<boolean> {
    const key = this.getKey(token);
    const result = await this.redis.get(key);
    return result !== null;
  }

  async revokeToken(token: string, ttlSeconds: number = 86400): Promise<void> {
    const key = this.getKey(token);
    await this.redis.set(key, '1', 'EX', ttlSeconds);
  }

  async unrevokeToken(token: string): Promise<void> {
    const key = this.getKey(token);
    await this.redis.del(key);
  }
}