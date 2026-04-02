import { describe, it, expect, jest } from '@jest/globals';
import { authMiddleware } from '@core/auth/auth.middleware';
import { TokenRevocationService } from '@core/auth/token-revocation.service';

const mockConfig = {
  jwt: { publicKey: 'test-key', privateKey: 'test', accessTokenTtl: '15m', refreshTokenTtl: '7d' },
  port: 3000,
  database: { host: 'localhost', port: 5432, user: 'test', password: 'test', name: 'test' },
  rabbitmq: { url: 'amqp://localhost' },
  redis: { url: 'redis://localhost' },
  logLevel: 'info' as const,
};

describe('authMiddleware (factory)', () => {
  function createReq(authHeader?: string) {
    return {
      headers: authHeader ? { authorization: authHeader } : {},
      user: undefined,
    } as any;
  }

  function createRes() {
    return { status: jest.fn<(...args: any[]) => any>().mockReturnThis(), json: jest.fn() } as any;
  }

  it('should return a middleware function', () => {
    const middleware = authMiddleware(mockConfig as any);
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });

  it('should reject request without Authorization header', async () => {
    const middleware = authMiddleware(mockConfig as any);
    const req = createReq();
    const res = createRes();
    const next = jest.fn();

    await expect(middleware(req, res, next)).rejects.toThrow('Missing');
  });

  it('should reject non-Bearer token', async () => {
    const middleware = authMiddleware(mockConfig as any);
    const req = createReq('Basic abc123');
    const res = createRes();
    const next = jest.fn();

    await expect(middleware(req, res, next)).rejects.toThrow();
  });

  it('should reject invalid token', async () => {
    const middleware = authMiddleware(mockConfig as any);
    const req = createReq('Bearer invalid-token');
    const res = createRes();
    const next = jest.fn();

    await expect(middleware(req, res, next)).rejects.toThrow('Invalid token');
  });

  it('should check token revocation if service provided', async () => {
    const mockRevocationService = {
      isRevoked: async (token: string) => { return true; },
    };
    const middleware = authMiddleware(mockConfig as any, mockRevocationService as any);
    const req = createReq('Bearer some-token');
    const res = createRes();
    const next = jest.fn();

    await expect(middleware(req, res, next)).rejects.toThrow('revoked');
  });
});

describe('TokenRevocationService integration', () => {
  it('should detect revoked tokens via Redis', async () => {
    const mockRedis = {
      get: jest.fn<(...args: any[]) => any>().mockResolvedValue('1'),
      set: jest.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
      del: jest.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
    };
    const service = new TokenRevocationService(mockRedis as any);
    const result = await service.isRevoked('some-token');
    expect(result).toBe(true);
    expect(mockRedis.get).toHaveBeenCalled();
  });

  it('should return false for non-revoked tokens', async () => {
    const mockRedis = {
      get: jest.fn<(...args: any[]) => any>().mockResolvedValue(null),
      set: jest.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
      del: jest.fn<(...args: any[]) => any>().mockResolvedValue(undefined),
    };
    const service = new TokenRevocationService(mockRedis as any);
    const result = await service.isRevoked('valid-token');
    expect(result).toBe(false);
  });
});
