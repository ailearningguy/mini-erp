import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError, ErrorCode } from '@shared/errors';
import { loadConfig } from '@core/config/config';

interface JwtPayload {
  sub: string;
  role: string;
  permissions?: string[];
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Missing or invalid Authorization header', 401);
  }

  const token = authHeader.slice(7);
  const config = loadConfig();

  try {
    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: ['RS256'],
    }) as JwtPayload;

    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Token expired', 401);
    }
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid token', 401);
  }
}
