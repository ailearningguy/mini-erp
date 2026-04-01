import { CircuitBreaker, defaultCircuitBreakerConfigs } from './circuit-breaker';
import { PluginGuard, type IPlugin } from '@core/plugin-system/plugin-loader';
import { AppError, ErrorCode } from '@shared/errors';

class ExternalServiceProxy {
  private breakers = new Map<string, CircuitBreaker>();
  private pluginGuard = new PluginGuard();

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
      const config = defaultCircuitBreakerConfigs[target] ?? {
        target,
        failureThreshold: 5,
        successThreshold: 3,
        resetTimeoutMs: 30_000,
        monitorIntervalMs: 60_000,
        halfOpenMaxProbes: 3,
      };
      this.breakers.set(target, new CircuitBreaker(config));
    }
    return this.breakers.get(target)!;
  }
}

export { ExternalServiceProxy };
