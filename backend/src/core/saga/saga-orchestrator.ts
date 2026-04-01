import { randomUUID } from 'node:crypto';
import { SAGA_CONSTANTS } from '@shared/constants';

enum SagaStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  COMPENSATING = 'COMPENSATING',
  FAILED = 'FAILED',
}

interface ISagaStep<TContext = unknown> {
  name: string;
  execute(ctx: TContext): Promise<void>;
  compensate(ctx: TContext): Promise<void>;
  timeout: number;
  retry: StepRetryConfig;
}

interface StepRetryConfig {
  maxAttempts: number;
  backoffMs: number;
  retryableErrors: string[];
}

interface SagaDefinition<TContext = unknown> {
  name: string;
  aggregateId: string;
  steps: ISagaStep<TContext>[];
  maxRetries: number;
  retryDelayMs: number;
}

interface SagaStateRecord {
  id: string;
  sagaId: string;
  sagaName: string;
  aggregateId: string;
  status: string;
  currentStep: number;
  completedSteps: string[];
  compensatedSteps: string[];
  context: Record<string, unknown>;
  retryCount: number;
  lastError: string | null;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  ttlAt: Date | null;
}

type AnyDb = Record<string, unknown>;

class SagaOrchestrator {
  constructor(private readonly db: AnyDb) {}

  async startSaga<TContext>(
    definition: SagaDefinition<TContext>,
    initialContext: TContext,
  ): Promise<string> {
    const sagaId = randomUUID();

    await this.persistState({
      sagaId,
      sagaName: definition.name,
      aggregateId: definition.aggregateId,
      status: SagaStatus.PENDING,
      currentStep: 0,
      completedSteps: [],
      compensatedSteps: [],
      context: initialContext as Record<string, unknown>,
      retryCount: 0,
    });

    await this.executeSaga(sagaId, definition, initialContext);

    return sagaId;
  }

  private async executeSaga<TContext>(
    sagaId: string,
    definition: SagaDefinition<TContext>,
    context: TContext,
  ): Promise<void> {
    await this.updateStatus(sagaId, SagaStatus.RUNNING);

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      await this.updateCurrentStep(sagaId, i);

      try {
        await this.executeWithTimeout(
          () => step.execute(context),
          step.timeout,
          `Step ${step.name} timed out after ${step.timeout}ms`,
        );

        const completedSteps = await this.getCompletedSteps(sagaId);
        completedSteps.push(step.name);
        await this.updateCompletedSteps(sagaId, completedSteps);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await this.updateLastError(sagaId, message);
        await this.compensate(sagaId, definition, context, i);
        return;
      }
    }

    await this.updateStatus(sagaId, SagaStatus.COMPLETED);
    await this.updateCompletedAt(sagaId);
  }

  private async compensate<TContext>(
    sagaId: string,
    definition: SagaDefinition<TContext>,
    context: TContext,
    failedStepIndex: number,
  ): Promise<void> {
    await this.updateStatus(sagaId, SagaStatus.COMPENSATING);

    for (let i = failedStepIndex - 1; i >= 0; i--) {
      const step = definition.steps[i];
      try {
        await this.executeWithTimeout(
          () => step.compensate(context),
          step.timeout,
          `Compensation for step ${step.name} timed out`,
        );

        const compensatedSteps = await this.getCompensatedSteps(sagaId);
        compensatedSteps.push(step.name);
        await this.updateCompensatedSteps(sagaId, compensatedSteps);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await this.updateLastError(sagaId, message);
        await this.updateStatus(sagaId, SagaStatus.FAILED);
        return;
      }
    }

    await this.updateStatus(sagaId, SagaStatus.COMPLETED);
  }

  async retrySaga(sagaId: string, definition: SagaDefinition): Promise<void> {
    const state = await this.getState(sagaId);
    if (!state) throw new Error(`Saga not found: ${sagaId}`);
    if (state.status !== SagaStatus.FAILED) {
      throw new Error(`Cannot retry saga in status: ${state.status}`);
    }
    if (state.retryCount >= definition.maxRetries) {
      throw new Error(`Saga ${sagaId} exceeded max retries (${definition.maxRetries})`);
    }

    await this.updateRetryCount(sagaId, state.retryCount + 1);
    await this.executeSaga(sagaId, definition, state.context as any);
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
      ),
    ]);
  }

  // --- Persistence helpers (use Drizzle in real implementation) ---

  private async persistState(state: Omit<SagaStateRecord, 'id' | 'startedAt' | 'updatedAt' | 'completedAt' | 'ttlAt'>): Promise<void> {
    // Insert into saga_state table
    // In skeleton: delegate to injected db
  }

  private async updateStatus(sagaId: string, status: SagaStatus): Promise<void> {
    // Update saga_state.status
  }

  private async updateCurrentStep(sagaId: string, step: number): Promise<void> {
    // Update saga_state.current_step
  }

  private async updateCompletedSteps(sagaId: string, steps: string[]): Promise<void> {
    // Update saga_state.completed_steps
  }

  private async updateCompensatedSteps(sagaId: string, steps: string[]): Promise<void> {
    // Update saga_state.compensated_steps
  }

  private async updateLastError(sagaId: string, error: string): Promise<void> {
    // Update saga_state.last_error
  }

  private async updateCompletedAt(sagaId: string): Promise<void> {
    // Update saga_state.completed_at
  }

  private async updateRetryCount(sagaId: string, count: number): Promise<void> {
    // Update saga_state.retry_count
  }

  private async getState(sagaId: string): Promise<SagaStateRecord | null> {
    // Query saga_state by saga_id
    return null;
  }

  private async getCompletedSteps(sagaId: string): Promise<string[]> {
    return [];
  }

  private async getCompensatedSteps(sagaId: string): Promise<string[]> {
    return [];
  }
}

export { SagaOrchestrator, SagaStatus };
export type { SagaDefinition, ISagaStep, StepRetryConfig };
