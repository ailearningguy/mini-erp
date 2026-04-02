import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sagaState } from './saga.schema';
import type { Db } from '@shared/types/db';

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

class SagaOrchestrator {
  constructor(private readonly db: Db) {}

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
      lastError: null,
    });

    await this.executeSaga(sagaId, definition, initialContext);

    return sagaId;
  }

  private async executeSaga<TContext>(
    sagaId: string,
    definition: SagaDefinition<TContext>,
    context: TContext,
  ): Promise<void> {
    await this.updateSagaState(sagaId, { status: SagaStatus.RUNNING });

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      const completedSteps = await this.getCompletedSteps(sagaId);

      try {
        await this.executeWithTimeout(
          () => step.execute(context),
          step.timeout,
          `Step ${step.name} timed out after ${step.timeout}ms`,
        );

        completedSteps.push(step.name);
        await this.updateSagaState(sagaId, { currentStep: i, completedSteps });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await this.updateSagaState(sagaId, { lastError: message });
        await this.compensate(sagaId, definition, context, i);
        return;
      }
    }

    await this.updateSagaState(sagaId, {
      status: SagaStatus.COMPLETED,
      completedAt: new Date(),
    });
  }

  private async compensate<TContext>(
    sagaId: string,
    definition: SagaDefinition<TContext>,
    context: TContext,
    failedStepIndex: number,
  ): Promise<void> {
    await this.updateSagaState(sagaId, { status: SagaStatus.COMPENSATING });

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
        await this.updateSagaState(sagaId, { compensatedSteps });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await this.updateSagaState(sagaId, { lastError: message, status: SagaStatus.FAILED });
        return;
      }
    }

    await this.updateSagaState(sagaId, { status: SagaStatus.COMPLETED });
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

    await this.updateSagaState(sagaId, { retryCount: state.retryCount + 1 });
    await this.executeSaga(sagaId, definition, state.context as Record<string, unknown>);
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

  // --- Persistence helpers (use Drizzle) ---

  private async withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  private async persistState(state: Omit<SagaStateRecord, 'id' | 'startedAt' | 'updatedAt' | 'completedAt' | 'ttlAt'>): Promise<void> {
    await this.db.insert(sagaState).values({
      sagaId: state.sagaId,
      sagaName: state.sagaName,
      aggregateId: state.aggregateId,
      status: state.status,
      currentStep: state.currentStep,
      completedSteps: JSON.stringify(state.completedSteps),
      compensatedSteps: JSON.stringify(state.compensatedSteps),
      context: JSON.stringify(state.context),
      retryCount: state.retryCount,
      lastError: state.lastError,
    });
  }

  private async updateSagaState(
    sagaId: string,
    updates: Partial<{
      status: SagaStatus;
      currentStep: number;
      completedSteps: string[];
      compensatedSteps: string[];
      lastError: string | null;
      completedAt: Date | null;
      retryCount: number;
    }>,
  ): Promise<void> {
    await this.withTransaction(async (tx) => {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.currentStep !== undefined) setValues.currentStep = updates.currentStep;
      if (updates.completedSteps !== undefined) setValues.completedSteps = JSON.stringify(updates.completedSteps);
      if (updates.compensatedSteps !== undefined) setValues.compensatedSteps = JSON.stringify(updates.compensatedSteps);
      if (updates.lastError !== undefined) setValues.lastError = updates.lastError;
      if (updates.completedAt !== undefined) setValues.completedAt = updates.completedAt;
      if (updates.retryCount !== undefined) setValues.retryCount = updates.retryCount;

      await tx
        .update(sagaState)
        .set(setValues)
        .where(eq(sagaState.sagaId, sagaId));
    });
  }

  private async getState(sagaId: string): Promise<SagaStateRecord | null> {
    const result = await this.db
      .select()
      .from(sagaState)
      .where(eq(sagaState.sagaId, sagaId))
      .limit(1);

    if (!result[0]) return null;

    const row = result[0];
    return {
      id: row.id,
      sagaId: row.sagaId,
      sagaName: row.sagaName,
      aggregateId: row.aggregateId,
      status: row.status,
      currentStep: row.currentStep,
      completedSteps: (row.completedSteps ?? []) as string[],
      compensatedSteps: (row.compensatedSteps ?? []) as string[],
      context: (row.context ?? {}) as Record<string, unknown>,
      retryCount: row.retryCount,
      lastError: row.lastError,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
      ttlAt: row.ttlAt,
    };
  }

  private async getCompletedSteps(sagaId: string): Promise<string[]> {
    const state = await this.getState(sagaId);
    return state?.completedSteps ?? [];
  }

  private async getCompensatedSteps(sagaId: string): Promise<string[]> {
    const state = await this.getState(sagaId);
    return state?.compensatedSteps ?? [];
  }
}

export { SagaOrchestrator, SagaStatus };
export type { SagaDefinition, ISagaStep, StepRetryConfig };
