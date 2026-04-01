import type { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@shared/errors';

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Authentication required', 401);
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(ErrorCode.FORBIDDEN, `Required role: ${roles.join(' or ')}`, 403);
    }
    next();
  };
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Authentication required', 401);
    }
    const userPerms = req.user.permissions ?? [];
    const hasPermission = permissions.some((p) => userPerms.includes(p));
    if (!hasPermission) {
      throw new AppError(ErrorCode.FORBIDDEN, `Required permission: ${permissions.join(' or ')}`, 403);
    }
    next();
  };
}
