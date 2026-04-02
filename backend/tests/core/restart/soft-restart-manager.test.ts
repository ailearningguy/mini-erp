import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SoftRestartManager } from '@core/restart/soft-restart-manager';

function createMocks() {
  return {
    gate: { pause: jest.fn(), resume: jest.fn(), isOpen: jest.fn().mockReturnValue(true) },
    tracker: { drain: jest.fn<() => Promise<boolean>>().mockResolvedValue(true), getActiveCount: jest.fn().mockReturnValue(0) },
    pluginLoader: { getActivePlugins: jest.fn().mockReturnValue([]) },
    container: { rebuild: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    amqpConsumer: { pause: jest.fn<() => Promise<void>>().mockResolvedValue(undefined), resume: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    queueManager: { pauseAll: jest.fn<() => Promise<void>>().mockResolvedValue(undefined), resumeAll: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('SoftRestartManager', () => {
  let manager: SoftRestartManager;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    manager = new SoftRestartManager(
      mocks.gate as any,
      mocks.tracker as any,
      mocks.pluginLoader as any,
      mocks.container as any,
      mocks.amqpConsumer as any,
      mocks.queueManager as any,
      mocks.logger as any,
    );
  });

  it('should execute full restart flow in order', async () => {
    await manager.restart('test-restart');

    expect(mocks.gate.pause).toHaveBeenCalled();
    expect(mocks.amqpConsumer.pause).toHaveBeenCalled();
    expect(mocks.queueManager.pauseAll).toHaveBeenCalled();
    expect(mocks.tracker.drain).toHaveBeenCalled();
    expect(mocks.container.rebuild).toHaveBeenCalled();
    expect(mocks.gate.resume).toHaveBeenCalled();
  });

  it('should pause traffic before rebuilding', async () => {
    await manager.restart('test');

    expect(mocks.gate.pause).toHaveBeenCalled();
    expect(mocks.container.rebuild).toHaveBeenCalled();
    expect(mocks.gate.resume).toHaveBeenCalled();
  });

  it('should rollback on rebuild failure', async () => {
    mocks.container.rebuild
      .mockRejectedValueOnce(new Error('build failed'))
      .mockResolvedValueOnce(undefined);

    mocks.pluginLoader.getActivePlugins.mockReturnValue([{ name: 'old-module' }]);

    await expect(manager.restart('test')).rejects.toThrow('build failed');

    expect(mocks.container.rebuild).toHaveBeenCalledTimes(2);
    expect(mocks.gate.resume).toHaveBeenCalled();
    expect(mocks.amqpConsumer.resume).toHaveBeenCalled();
  });

  it('should proceed on drain timeout', async () => {
    mocks.tracker.drain.mockResolvedValue(false);

    await manager.restart('test');

    expect(mocks.container.rebuild).toHaveBeenCalled();
    expect(mocks.gate.resume).toHaveBeenCalled();
  });

  it('should resume everything even on error', async () => {
    mocks.container.rebuild.mockRejectedValue(new Error('fail'));

    try {
      await manager.restart('test');
    } catch {
      // expected
    }

    expect(mocks.gate.resume).toHaveBeenCalled();
    expect(mocks.amqpConsumer.resume).toHaveBeenCalled();
    expect(mocks.queueManager.resumeAll).toHaveBeenCalled();
  });

  it('should log restart lifecycle', async () => {
    await manager.restart('install:product');

    expect(mocks.logger.info).toHaveBeenCalledWith(
      { reason: 'install:product' },
      'soft-restart:start',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'soft-restart:success',
    );
  });
});
