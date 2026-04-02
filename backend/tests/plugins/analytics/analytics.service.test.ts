import { describe, it, expect, jest } from '@jest/globals';
import { AnalyticsService } from '@plugins/analytics/analytics.service';

describe('AnalyticsService', () => {
  describe('getEventCount', () => {
    it('should return count value from SQL COUNT query', async () => {
      const mockDb = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockResolvedValue([{ count: 42 }] as never),
        }),
      };
      const service = new AnalyticsService(mockDb as any);
      const count = await service.getEventCount();
      expect(count).toBe(42);
    });

    it('should return 0 when no events exist', async () => {
      const mockDb = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockResolvedValue([{ count: 0 }] as never),
        }),
      };
      const service = new AnalyticsService(mockDb as any);
      const count = await service.getEventCount();
      expect(count).toBe(0);
    });

    it('should return 0 when result is empty', async () => {
      const mockDb = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockResolvedValue([] as never),
        }),
      };
      const service = new AnalyticsService(mockDb as any);
      const count = await service.getEventCount();
      expect(count).toBe(0);
    });
  });
});