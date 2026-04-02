import type { Request, Response, NextFunction } from 'express';

class TrafficGate {
  private state: 'OPEN' | 'PAUSED' = 'OPEN';

  middleware = (_req: Request, res: Response, next: NextFunction): void => {
    if (this.state === 'PAUSED') {
      res.status(503).json({
        error: {
          code: 'MAINTENANCE',
          message: 'System is updating, please retry later',
        },
      });
      return;
    }
    next();
  };

  pause(): void {
    this.state = 'PAUSED';
  }

  resume(): void {
    this.state = 'OPEN';
  }

  isOpen(): boolean {
    return this.state === 'OPEN';
  }
}

export { TrafficGate };
