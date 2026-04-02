import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TrafficGate } from '@core/traffic/traffic-gate';

describe('TrafficGate', () => {
  let gate: TrafficGate;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    gate = new TrafficGate();
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should pass through when state is OPEN', () => {
    gate.middleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should return 503 when state is PAUSED', () => {
    gate.pause();
    gate.middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'MAINTENANCE',
        message: 'System is updating, please retry later',
      },
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should pass through again after resume', () => {
    gate.pause();
    gate.resume();
    gate.middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('isOpen() should reflect current state', () => {
    expect(gate.isOpen()).toBe(true);
    gate.pause();
    expect(gate.isOpen()).toBe(false);
    gate.resume();
    expect(gate.isOpen()).toBe(true);
  });
});
