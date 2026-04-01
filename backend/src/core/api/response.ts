import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode } from '@shared/errors';
import { API_CONSTANTS } from '@shared/constants';

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

type ExpressRequest = {
  id?: string;
  headers: Record<string, string | undefined>;
  [key: string]: unknown;
};

type ExpressResponse = {
  status(code: number): ExpressResponse;
  json(body: unknown): void;
};

type NextFunction = (error?: unknown) => void;

function requestIdMiddleware(req: ExpressRequest, _res: unknown, next: NextFunction): void {
  req.id = req.headers[API_CONSTANTS.REQUEST_ID_HEADER] ?? randomUUID();
  next();
}

function snakeCaseMiddleware(req: ExpressRequest, _res: unknown, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = convertKeys(req.body, camelCase);
  }
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

function globalErrorHandler(err: unknown, req: ExpressRequest, res: ExpressResponse, _next: NextFunction): void {
  const requestId = req.id ?? 'unknown';
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

function convertKeys(obj: Record<string, unknown>, converter: (key: string) => string): Record<string, unknown> {
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null
        ? convertKeys(item as Record<string, unknown>, converter)
        : item,
    ) as unknown as Record<string, unknown>;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = converter(key);
    result[newKey] =
      typeof value === 'object' && value !== null
        ? convertKeys(value as Record<string, unknown>, converter)
        : value;
  }
  return result;
}

export {
  requestIdMiddleware,
  snakeCaseMiddleware,
  successResponse,
  errorResponse,
  globalErrorHandler,
  camelCase,
  snakeCase,
  convertKeys,
};
export type { ApiResponse, ApiErrorResponse };
