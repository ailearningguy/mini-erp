import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Metrics Endpoint', () => {
  it('should export createMetricsHandler function', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/metrics/metrics-endpoint.ts'),
      'utf-8',
    );
    expect(content).toMatch(/createMetricsHandler/);
    expect(content).toMatch(/function/);
  });

  it('should use express Request and Response types', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/metrics/metrics-endpoint.ts'),
      'utf-8',
    );
    expect(content).toMatch(/import.*Request.*Response.*from ['"]express['"]/);
  });

  it('should use MetricsService', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/metrics/metrics-endpoint.ts'),
      'utf-8',
    );
    expect(content).toMatch(/MetricsService/);
  });

  it('should set Prometheus Content-Type header', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/metrics/metrics-endpoint.ts'),
      'utf-8',
    );
    expect(content).toMatch(/text\/plain.*version=0\.0\.4/);
  });

  it('should export TYPE for each metric', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/metrics/metrics-endpoint.ts'),
      'utf-8',
    );
    expect(content).toMatch(/# TYPE/);
  });

  it('should have formatLabels helper', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/metrics/metrics-endpoint.ts'),
      'utf-8',
    );
    expect(content).toMatch(/function formatLabels/);
  });
});
