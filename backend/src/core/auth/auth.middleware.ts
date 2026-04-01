import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError, ErrorCode } from '@shared/errors';
import type { AppConfig } from '@core/config/config';
import { TokenRevocationService } from './token-revocation.service';

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

export function authMiddleware(config: AppConfig, revocationService?: TokenRevocationService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Missing or invalid Authorization header', 401);
    }

    const token = authHeader.slice(7);

    if (revocationService) {
      const isRevoked = await revocationService.isRevoked(token);
      if (isRevoked) {
        throw new AppError(ErrorCode.UNAUTHORIZED, 'Token has been revoked', 401);
      }
    }

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
  };
}
