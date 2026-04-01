import { describe, it, expect, beforeEach } from '@jest/globals';
import { MetricsService, MetricType } from '@core/metrics/metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('should record counter metrics', () => {
    service.recordCounter('requests_total');
    const metric = service.getMetric('requests_total');
    expect(metric).toBeDefined();
    expect(metric?.type).toBe(MetricType.COUNTER);
    expect(metric?.value).toBe(1);
  });

  it('should increment counter by value', () => {
    service.recordCounter('requests_total', 5);
    service.recordCounter('requests_total', 3);
    const metric = service.getMetric('requests_total');
    expect(metric?.value).toBe(8);
  });

  it('should record gauge metrics', () => {
    service.recordGauge('memory_usage_bytes', 1024);
    const metric = service.getMetric('memory_usage_bytes');
    expect(metric?.type).toBe(MetricType.GAUGE);
    expect(metric?.value).toBe(1024);
  });

  it('should record histogram metrics', () => {
    service.recordHistogram('request_duration_ms', 150);
    const metric = service.getMetric('request_duration_ms');
    expect(metric?.type).toBe(MetricType.HISTOGRAM);
    expect(metric?.value).toBe(150);
  });

  it('should track metrics with labels separately', () => {
    service.recordCounter('requests_total', 1, { method: 'GET' });
    service.recordCounter('requests_total', 1, { method: 'POST' });
    const getMetric = service.getMetric('requests_total', { method: 'GET' });
    const postMetric = service.getMetric('requests_total', { method: 'POST' });
    expect(getMetric?.value).toBe(1);
    expect(postMetric?.value).toBe(1);
  });

  it('should return all metrics in snapshot', () => {
    service.recordCounter('a');
    service.recordGauge('b', 10);
    const snapshot = service.snapshot();
    expect(snapshot.metrics).toHaveLength(2);
    expect(snapshot.timestamp).toBeInstanceOf(Date);
  });

  it('should reset all metrics', () => {
    service.recordCounter('test');
    service.reset();
    expect(service.getAllMetrics()).toHaveLength(0);
  });
});