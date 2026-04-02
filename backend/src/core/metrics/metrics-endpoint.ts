import type { Request, Response } from 'express';
import { MetricsService } from '@core/metrics/metrics.service';

function createMetricsHandler(service: MetricsService) {
  return function metricsHandler(_req: Request, res: Response): void {
    const snapshot = service.snapshot();
    let output = '';

    const byName = new Map<string, typeof snapshot.metrics>();
    for (const metric of snapshot.metrics) {
      const existing = byName.get(metric.name) ?? [];
      existing.push(metric);
      byName.set(metric.name, existing);
    }

    for (const [name, metrics] of byName) {
      const type = metrics[0].type;
      output += `# TYPE ${name} ${type}\n`;

      for (const metric of metrics) {
        const labelStr = formatLabels(metric.labels);
        output += `${name}${labelStr} ${metric.value}\n`;
      }
    }

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(output);
  };
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const pairs = entries.map(([k, v]) => `${k}="${v}"`).join(',');
  return `{${pairs}}`;
}

export { createMetricsHandler };
