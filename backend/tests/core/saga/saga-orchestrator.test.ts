import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SagaOrchestrator, SagaStatus } from '@core/saga/saga-orchestrator';

function createMockDb() {
  const insertMock = jest.fn(() => ({ values: jest.fn(async () => {}) }));
  const updateMock = jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => {}) })) }));
  const selectMock = jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        limit: jest.fn(async () => []),
      })),
    })),
  }));

  return {
    insert: insertMock,
    update: updateMock,
    select: selectMock,
    transaction: jest.fn(async (fn: any) => fn(createMockDb())),
    _insertMock: insertMock,
    _updateMock: updateMock,
    _selectMock: selectMock,
  };
}

describe('SagaOrchestrator', () => {
  let orchestrator: SagaOrchestrator;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    orchestrator = new SagaOrchestrator(mockDb as any);
  });

  it('should persist saga state on start', async () => {
    const definition = {
      name: 'test-saga',
      aggregateId: 'agg-1',
      steps: [
        {
          name: 'step1',
          execute: jest.fn(async () => {}),
          compensate: jest.fn(async () => {}),
          timeout: 5000,
          retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
        },
      ],
      maxRetries: 3,
      retryDelayMs: 1000,
    };

    const sagaId = await orchestrator.startSaga(definition, { data: 'test' });

    expect(sagaId).toBeDefined();
    expect(typeof sagaId).toBe('string');
    expect(mockDb._insertMock).toHaveBeenCalled();
  });

  it('should execute all steps in order', async () => {
    const executionOrder: string[] = [];

    const definition = {
      name: 'ordered-saga',
      aggregateId: 'agg-1',
      steps: [
        {
          name: 'step-a',
          execute: jest.fn(async () => { executionOrder.push('a'); }),
          compensate: jest.fn(async () => {}),
          timeout: 5000,
          retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
        },
        {
          name: 'step-b',
          execute: jest.fn(async () => { executionOrder.push('b'); }),
          compensate: jest.fn(async () => {}),
          timeout: 5000,
          retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
        },
      ],
      maxRetries: 3,
      retryDelayMs: 1000,
    };

    await orchestrator.startSaga(definition, {});

    expect(executionOrder).toEqual(['a', 'b']);
  });

  it('should compensate completed steps when a step fails', async () => {
    const compensated: string[] = [];

    const definition = {
      name: 'fail-saga',
      aggregateId: 'agg-1',
      steps: [
        {
          name: 'step-ok',
          execute: jest.fn(async () => {}),
          compensate: jest.fn(async () => { compensated.push('step-ok'); }),
          timeout: 5000,
          retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
        },
        {
          name: 'step-fail',
          execute: jest.fn(async () => { throw new Error('Step failed'); }),
          compensate: jest.fn(async () => {}),
          timeout: 5000,
          retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
        },
      ],
      maxRetries: 3,
      retryDelayMs: 1000,
    };

    await orchestrator.startSaga(definition, {});

    expect(compensated).toContain('step-ok');
  });
});