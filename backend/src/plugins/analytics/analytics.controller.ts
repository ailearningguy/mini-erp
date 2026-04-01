import type { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { successResponse } from '@core/api/response';

export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  async queryEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = AnalyticsQueryDto.parse(req.query);
      const result = await this.service.queryEvents(query);
      res.json(successResponse(result.items, (req as any).id!, {
        cursor: result.nextCursor,
        has_more: result.nextCursor !== null,
        limit: query.limit,
      }));
    } catch (error) {
      next(error);
    }
  }

  async getEventCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const count = await this.service.getEventCount();
      res.json(successResponse({ count }, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }
}