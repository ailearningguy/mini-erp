import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RequestTracker } from '@core/traffic/request-tracker';

describe('RequestTracker', () => {
  let tracker: RequestTracker;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    tracker = new RequestTracker();
    mockReq = {};
    mockRes = {
      on: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should track active requests via middleware', () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(mockRes.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(tracker.getActiveCount()).toBe(1);
  });

  it('should decrement on finish event', () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    const finishHandler = mockRes.on.mock.calls.find(
      (call: any[]) => call[0] === 'finish'
    )[1];
    finishHandler();

    expect(tracker.getActiveCount()).toBe(0);
  });

  it('drain() should resolve when no active requests', async () => {
    const result = await tracker.drain(1000);
    expect(result).toBe(true);
  });

  it('drain() should timeout when requests are still active', async () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    const result = await tracker.drain(50);
    expect(result).toBe(false);
    expect(tracker.getActiveCount()).toBe(1);
  });

  it('drain() should resolve when all requests complete during drain', async () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    const finishHandler = mockRes.on.mock.calls.find(
      (call: any[]) => call[0] === 'finish'
    )[1];
    setTimeout(() => finishHandler(), 10);

    const result = await tracker.drain(1000);
    expect(result).toBe(true);
    expect(tracker.getActiveCount()).toBe(0);
  });
});
