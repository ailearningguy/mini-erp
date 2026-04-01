import type { Request, Response, NextFunction } from 'express';
import { API_CONSTANTS } from '@shared/constants';

interface IdempotencyStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

interface CachedResponse {
  statusCode: number;
  body: unknown;
}

const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function createIdempotencyMiddleware(store: IdempotencyStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.headers[API_CONSTANTS.IDEMPOTENCY_KEY_HEADER.toLowerCase()] as string | undefined;

    if (!key || !IDEMPOTENT_METHODS.has(req.method)) {
      next();
      return;
    }

    const cached = await store.get<CachedResponse>(key);
    if (cached) {
      res.status(cached.statusCode).json(cached.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      const response: CachedResponse = { statusCode: res.statusCode, body };
      store.set(key, response).catch(() => {});
      return originalJson(body);
    };

    next();
  };
}
