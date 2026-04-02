import { CircuitBreaker, type CircuitBreakerConfig } from './circuit-breaker';
import type { IPermissionValidator, IPlugin } from '@core/plugin-system/plugin-loader';
import { AppError, ErrorCode } from '@shared/errors';

const GENERIC_DEFAULT_CONFIG: CircuitBreakerConfig = {
  target: '',
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30_000,
  monitorIntervalMs: 60_000,
  halfOpenMaxProbes: 3,
};

class ExternalServiceProxy {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly pluginGuard: IPermissionValidator,
    private readonly customConfigs: Record<string, CircuitBreakerConfig> = {},
  ) {}

  call<T>(
    plugin: IPlugin,
    target: string,
    fn: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    this.validatePermission(plugin, target);

    const breaker = this.getOrCreateBreaker(target);
    return breaker.execute(fn, fallback);
  }

  private validatePermission(plugin: IPlugin, target: string): void {
    const metadata = plugin.getMetadata();
    const hasPermission = this.pluginGuard.validate(
      metadata.permissions ?? [],
      { resource: `external:${target}`, action: 'call' },
    );
    if (!hasPermission) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `Plugin "${metadata.name}" does not have permission to call external service: ${target}`,
        403,
        { plugin: metadata.name, target },
      );
    }
  }

  private getOrCreateBreaker(target: string): CircuitBreaker {
    if (!this.breakers.has(target)) {
      const config = this.customConfigs[target] ?? {
        ...GENERIC_DEFAULT_CONFIG,
        target,
      };
      this.breakers.set(target, new CircuitBreaker(config));
    }
    return this.breakers.get(target)!;
  }
}

export { ExternalServiceProxy };