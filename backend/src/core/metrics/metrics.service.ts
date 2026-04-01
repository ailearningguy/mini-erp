import { randomUUID } from 'node:crypto';

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

export interface MetricsSnapshot {
  timestamp: Date;
  metrics: Metric[];
}

class MetricsService {
  private metrics = new Map<string, Metric>();

  recordCounter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const key = this.getKey(name, labels);
    const existing = this.metrics.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.metrics.set(key, {
        name,
        type: MetricType.COUNTER,
        value,
        labels,
        timestamp: new Date(),
      });
    }
  }

  recordGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getKey(name, labels);
    this.metrics.set(key, {
      name,
      type: MetricType.GAUGE,
      value,
      labels,
      timestamp: new Date(),
    });
  }

  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.getKey(name, labels);
    this.metrics.set(key, {
      name,
      type: MetricType.HISTOGRAM,
      value,
      labels,
      timestamp: new Date(),
    });
  }

  getMetric(name: string, labels: Record<string, string> = {}): Metric | undefined {
    return this.metrics.get(this.getKey(name, labels));
  }

  getAllMetrics(): Metric[] {
    return Array.from(this.metrics.values());
  }

  snapshot(): MetricsSnapshot {
    return {
      timestamp: new Date(),
      metrics: this.getAllMetrics(),
    };
  }

  reset(): void {
    this.metrics.clear();
  }

  private getKey(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return `${name}:${JSON.stringify(sortedLabels)}`;
  }
}

export const metricsService = new MetricsService();
export { MetricsService };