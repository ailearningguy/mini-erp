enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
  PLUGIN_NOT_ACTIVE = 'PLUGIN_NOT_ACTIVE',
  SAGA_FAILED = 'SAGA_FAILED',
}

class AppError extends Error {
  public readonly name = 'AppError';

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: object,
    public readonly retryable: boolean = false,
  ) {
    super(message);
  }
}

export { ErrorCode, AppError };
