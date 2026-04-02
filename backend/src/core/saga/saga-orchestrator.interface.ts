import type { SagaDefinition } from './saga-orchestrator';

interface ISagaOrchestrator {
  startSaga<TContext>(
    definition: SagaDefinition<TContext>,
    initialContext: TContext,
  ): Promise<string>;
  retrySaga(sagaId: string, definition: SagaDefinition): Promise<void>;
}

export type { ISagaOrchestrator };
