import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ErrorCode } from '@shared/errors';
import { API_CONSTANTS } from '@shared/constants';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

interface ApiResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    version: string;
    request_id: string;
    pagination?: {
      cursor: string | null;
      has_more: boolean;
      limit: number;
    };
  };
}

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: object;
    trace_id: string;
  };
}

function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.id = (req.headers[API_CONSTANTS.REQUEST_ID_HEADER] as string) ?? randomUUID();
  next();
}

function snakeCaseMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = convertKeys(req.body as Record<string, unknown>, camelCase);
  }
  next();
}

function snakeCaseResponseMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  (res as { json: typeof originalJson }).json = function (body: unknown) {
    if (body && typeof body === 'object') {
      const converted = convertKeys(body as Record<string, unknown>, snakeCase);
      return originalJson(converted);
    }
    return originalJson(body);
  };
  next();
}

function successResponse<T>(data: T, requestId: string, pagination?: ApiResponse<T>['meta']['pagination']): ApiResponse<T> {
  return {
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: 'v1',
      request_id: requestId,
      ...(pagination && { pagination }),
    },
  };
}

function errorResponse(error: unknown, requestId: string): ApiErrorResponse {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        trace_id: requestId,
      },
    };
  }

  return {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
      trace_id: requestId,
    },
  };
}

function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id ?? 'unknown';

  if (err instanceof ZodError) {
    const validationError = new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Validation failed',
      400,
      { issues: err.issues },
    );
    const response = errorResponse(validationError, requestId);
    res.status(400).json(response);
    return;
  }

  const response = errorResponse(err, requestId);

  let status = 500;
  if (err instanceof AppError) {
    status = err.httpStatus;
  }

  res.status(status).json(response);
}

// --- Utility helpers ---

function camelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function snakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const SKIP_CONVERSION_KEYS = new Set(['payload']);

function convertKeys(
  obj: Record<string, unknown>,
  converter: (key: string) => string,
  skipKeys: Set<string> = SKIP_CONVERSION_KEYS,
): Record<string, unknown> {
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null
        ? convertKeys(item as Record<string, unknown>, converter, skipKeys)
        : item,
    ) as unknown as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = converter(key);
    if (typeof value === 'object' && value !== null) {
      if (skipKeys.has(key)) {
        result[newKey] = value;
      } else {
        result[newKey] = convertKeys(value as Record<string, unknown>, converter, skipKeys);
      }
    } else {
      result[newKey] = value;
    }
  }
  return result;
}

export {
  requestIdMiddleware,
  snakeCaseMiddleware,
  snakeCaseResponseMiddleware,
  successResponse,
  errorResponse,
  globalErrorHandler,
  camelCase,
  snakeCase,
  convertKeys,
};
export type { ApiResponse, ApiErrorResponse };
