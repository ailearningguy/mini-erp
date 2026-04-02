import type { Request, Response, NextFunction } from 'express';

class RequestTracker {
  private active = 0;

  middleware = (_req: Request, res: Response, next: NextFunction): void => {
    this.active++;
    res.on('finish', () => { this.active--; });
    res.on('close', () => { this.active--; });
    next();
  };

  getActiveCount(): number {
    return this.active;
  }

  async drain(timeoutMs: number = 5000): Promise<boolean> {
    const start = Date.now();
    while (this.active > 0) {
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await new Promise(r => setTimeout(r, 25));
    }
    return true;
  }
}

export { RequestTracker };
