import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createIdempotencyMiddleware } from '@core/idempotency/idempotency.middleware';

describe('IdempotencyMiddleware', () => {
  let mockStore: any;

  beforeEach(() => {
    mockStore = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => {}),
    };
  });

  it('should pass through requests without Idempotency-Key header', async () => {
    const middleware = createIdempotencyMiddleware(mockStore);
    const req = { method: 'POST', headers: {}, body: {} } as any;
    const res = { json: jest.fn(), statusCode: 200 } as any;
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockStore.get).not.toHaveBeenCalled();
  });

  it('should return cached response for duplicate Idempotency-Key', async () => {
    mockStore.get = jest.fn(async () => ({ statusCode: 201, body: { id: '1' } }));

    const middleware = createIdempotencyMiddleware(mockStore);
    const req = { method: 'POST', headers: { 'idempotency-key': 'key-1' }, body: {} } as any;
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as any;
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: '1' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should skip GET, HEAD, OPTIONS requests', async () => {
    const middleware = createIdempotencyMiddleware(mockStore);

    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const req = { method, headers: { 'idempotency-key': 'key-1' }, body: {} } as any;
      const res = {} as any;
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    }
  });
});
