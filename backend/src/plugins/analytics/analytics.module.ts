import type { Express } from 'express';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import type { AnyDb } from '@shared/types/db';

export class AnalyticsModule {
  private service: AnalyticsService;
  private controller: AnalyticsController;

  constructor(db: AnyDb) {
    this.service = new AnalyticsService(db);
    this.controller = new AnalyticsController(this.service);
  }

  getService(): AnalyticsService {
    return this.service;
  }

  registerRoutes(app: Express): void {
    app.get('/api/v1/analytics/events', (req, res, next) => this.controller.queryEvents(req, res, next));
    app.get('/api/v1/analytics/events/count', (req, res, next) => this.controller.getEventCount(req, res, next));
  }
}