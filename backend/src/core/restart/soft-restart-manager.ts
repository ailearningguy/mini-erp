import type { TrafficGate } from '@core/traffic/traffic-gate';
import type { RequestTracker } from '@core/traffic/request-tracker';
import type { PluginLoader } from '@core/plugin-system/plugin-loader';
import type { DIContainer } from '@core/di/container';
import type { AmqpConsumer } from '@core/consumer/amqp-consumer';
import type { QueueManager } from '@core/jobs/queue-manager';
import { metricsService } from '@core/metrics/metrics.service';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

interface ActivePlugin {
  name: string;
}

class SoftRestartManager {
  constructor(
    private gate: TrafficGate,
    private tracker: RequestTracker,
    private pluginLoader: PluginLoader,
    private container: DIContainer,
    private amqpConsumer: AmqpConsumer,
    private queueManager: QueueManager,
    private logger: Logger,
  ) {}

  private getActivePlugins(): ActivePlugin[] {
    return [];
  }

  async restart(reason: string): Promise<void> {
    const startTime = Date.now();
    metricsService.recordCounter('system_restart_total');
    this.logger.info({ reason }, 'soft-restart:start');

    this.gate.pause();

    await this.amqpConsumer.pause();

    await this.queueManager.pauseAll();

    const drained = await this.tracker.drain(5000);
    if (!drained) {
      this.logger.warn(
        { remaining: this.tracker.getActiveCount() },
        'soft-restart: drain timeout, proceeding with active requests',
      );
    }

    const snapshotBefore = this.getActivePlugins();

    try {
      this.logger.info({ reason: 'soft-restart-refresh' }, 'soft-restart:refresh-complete');
      await this.container.rebuild([]);

      const durationMs = Date.now() - startTime;
      metricsService.recordHistogram('system_restart_duration_seconds', durationMs / 1000);
      this.logger.info(
        { durationMs },
        'soft-restart:success',
      );
    } catch (err) {
      metricsService.recordCounter('system_restart_failed_total');
      this.logger.error({ err }, 'soft-restart:failed');

      try {
        await this.container.rebuild(snapshotBefore);
        this.logger.info({ reason: 'rollback' }, 'soft-restart:rollback-success');
      } catch (rollbackErr) {
        this.logger.error({ err: rollbackErr }, 'soft-restart:rollback-failed');
      }
      throw err;
    } finally {
      await this.queueManager.resumeAll();
      await this.amqpConsumer.resume();
      this.gate.resume();
    }
  }
}

export { SoftRestartManager };
