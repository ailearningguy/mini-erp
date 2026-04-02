import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import { DIContainer } from '@core/di/container';
import { TrafficGate } from '@core/traffic/traffic-gate';
import { RequestTracker } from '@core/traffic/request-tracker';

describe('Soft Restart E2E', () => {
  let container: DIContainer;
  let gate: TrafficGate;
  let tracker: RequestTracker;

  beforeAll(() => {
    container = new DIContainer();
    gate = new TrafficGate();
    tracker = new RequestTracker();
  });

  it('should complete full build → dispose → rebuild cycle', async () => {
    container.register('ExpressApp', () => ({
      get: () => {}, post: () => {}, put: () => {}, delete: () => {},
    }));
    container.register('Database', () => ({}));
    container.register('EventBus', () => ({ emit: async () => {} }));
    container.register('EventSchemaRegistry', () => ({ register: () => {}, clear: () => {}, validate: () => ({}) }));
    container.register('EventConsumer', () => ({ registerHandler: () => {}, unregisterAll: () => {}, consume: async () => {} }));
    container.register('CacheService', () => ({ invalidate: async () => {} }));

    const mockModule: any = {
      name: 'test',
      onInit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      onDestroy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const mockFactory: any = {
      create: () => ({ providers: [], module: mockModule }),
    };

    const metadata: any = {
      name: 'test',
      version: '2026.04.01',
      enabled: true,
      dependencies: [],
      entry: async () => mockFactory,
      manifest: { name: 'test', version: '2026.04.01', enabled: true },
    };

    await container.build([metadata]);
    expect(container.has('EventSchemaRegistry')).toBe(true);

    await container.dispose();

    await container.build([metadata]);
    await container.rebuild([]);
  });

  it('should gate traffic during simulated restart', () => {
    gate.pause();
    expect(gate.isOpen()).toBe(false);

    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const mockNext = jest.fn();
    gate.middleware({} as any, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockNext).not.toHaveBeenCalled();

    gate.resume();
    expect(gate.isOpen()).toBe(true);
  });
});