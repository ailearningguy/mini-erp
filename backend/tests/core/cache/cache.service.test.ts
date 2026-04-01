import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CacheService } from '@core/cache/cache.service';

function createMockRedis() {
  return {
    get: jest.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null),
    set: jest.fn<(key: string, value: string, mode: string, duration: number) => Promise<'OK' | null>>().mockResolvedValue('OK'),
    del: jest.fn<(key: string) => Promise<number>>().mockResolvedValue(1),
    setnx: jest.fn<(key: string, value: string, mode: string, duration: number) => Promise<boolean>>().mockResolvedValue(true),
  };
}

describe('CacheService distributed lock', () => {
  let cacheService: CacheService;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    cacheService = new CacheService(mockRedis as any);
  });

  it('should use Redis SET NX for lock acquisition', async () => {
    const factory = jest.fn(async () => 'computed-value');

    const result = await cacheService.getOrSet('test-key', factory, 60);

    expect(result).toBe('computed-value');
    expect(mockRedis.setnx).toHaveBeenCalledWith('lock:test-key', '1', 'PX', 5000);
    expect(mockRedis.del).toHaveBeenCalledWith('lock:test-key');
    expect(mockRedis.set).toHaveBeenCalledWith('cache:test-key', JSON.stringify('computed-value'), 'EX', 60);
  });

  it('should fallback to DB when lock acquisition fails', async () => {
    mockRedis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockRedis.setnx.mockResolvedValue(false);
    const factory = jest.fn(async () => 'fallback-value');

    const result = await cacheService.getOrSet('test-key', factory, 60);

    expect(result).toBe('fallback-value');
    expect(factory).toHaveBeenCalled();
  });

  it('should release lock after value is set', async () => {
    const factory = jest.fn(async () => 'locked-value');

    await cacheService.getOrSet('test-key', factory, 60);

    expect(mockRedis.del).toHaveBeenCalledWith('lock:test-key');
  });

  it('should release lock even when factory throws', async () => {
    mockRedis.setnx.mockResolvedValue(true);
    const factory = jest.fn(async () => {
      throw new Error('factory failed');
    });

    await expect(cacheService.getOrSet('test-key', factory, 60)).rejects.toThrow('factory failed');
    expect(mockRedis.del).toHaveBeenCalledWith('lock:test-key');
  });

  it('should return cached value without acquiring lock when cache hit', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify('cached-value'));
    const factory = jest.fn(async () => 'should-not-run');

    const result = await cacheService.getOrSet('test-key', factory, 60);

    expect(result).toBe('cached-value');
    expect(factory).not.toHaveBeenCalled();
    expect(mockRedis.setnx).not.toHaveBeenCalled();
  });

  it('should reuse pending request for concurrent calls (in-process mutex)', async () => {
    mockRedis.setnx.mockResolvedValue(true);
    let resolveFactory!: (value: string) => void;
    const factory = jest.fn(async () => {
      await new Promise<void>((resolve) => { resolveFactory = () => resolve(); });
      return 'shared-value';
    });

    const p1 = cacheService.getOrSet('test-key', factory, 60);
    const p2 = cacheService.getOrSet('test-key', factory, 60);
    await new Promise((r) => setTimeout(r, 10));
    resolveFactory('shared-value');

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('shared-value');
    expect(r2).toBe('shared-value');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
