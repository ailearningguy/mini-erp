import { metricsService } from '@core/metrics/metrics.service';

enum SystemState {
  RUNNING = 'RUNNING',
  RESTARTING = 'RESTARTING',
  MAINTENANCE = 'MAINTENANCE',
}

class SystemStateManager {
  private state: SystemState = SystemState.RUNNING;

  getState(): SystemState {
    return this.state;
  }

  async transitionTo(newState: SystemState): Promise<void> {
    this.state = newState;
    metricsService.recordGauge('system_state', this.state === SystemState.RUNNING ? 1 : 0);
  }

  isRunning(): boolean {
    return this.state === SystemState.RUNNING;
  }
}

export { SystemState, SystemStateManager };
