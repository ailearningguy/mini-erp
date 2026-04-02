import { ErrorCode } from '@shared/errors/app-error';
import { AppError } from '@shared/errors/app-error';

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  target: string;
  failureThreshold: number;
  successThreshold: number;
  resetTimeoutMs: number;
  monitorIntervalMs: number;
  halfOpenMaxProbes: number;
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenProbes = 0;

  constructor(private readonly config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenProbes = 0;
      } else {
        if (fallback) {
          return fallback();
        }
        throw new AppError(
          ErrorCode.CIRCUIT_OPEN,
          `Circuit breaker OPEN for ${this.config.target}`,
          503,
          { target: this.config.target, state: this.state },
          true,
        );
      }
    }

    if (this.state === CircuitState.HALF_OPEN && this.halfOpenProbes >= this.config.halfOpenMaxProbes) {
      if (fallback) return fallback();
      throw new AppError(
        ErrorCode.CIRCUIT_OPEN,
        `Circuit breaker HALF_OPEN probe limit reached for ${this.config.target}`,
        503,
        { target: this.config.target },
        true,
      );
    }

    try {
      if (this.state === CircuitState.HALF_OPEN) this.halfOpenProbes++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) return fallback();
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }
}

export { CircuitBreaker, CircuitState };
export type { CircuitBreakerConfig };
