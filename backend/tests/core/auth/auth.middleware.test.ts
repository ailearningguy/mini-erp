import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '@core/auth/auth.middleware';

describe('authMiddleware', () => {
  function createReq(authHeader?: string) {
    return {
      headers: authHeader ? { authorization: authHeader } : {},
      user: undefined,
    } as any;
  }

  function createRes() {
    return { status: jest.fn<(...args: any[]) => any>().mockReturnThis(), json: jest.fn() } as any;
  }

  it('should reject request without Authorization header', () => {
    const req = createReq();
    const res = createRes();
    const next = jest.fn();

    expect(() => authMiddleware(req, res, next)).toThrow();
  });

  it('should reject non-Bearer token', () => {
    const req = createReq('Basic abc123');
    const res = createRes();
    const next = jest.fn();

    expect(() => authMiddleware(req, res, next)).toThrow();
  });
});
