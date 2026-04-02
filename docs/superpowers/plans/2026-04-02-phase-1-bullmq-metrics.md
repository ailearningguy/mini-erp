# Phase 1: BullMQ Integration + Metrics Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate BullMQ for background job processing và expose Prometheus metrics endpoint — nền tảng cho soft restart (pause/resume) và observability.

**Architecture:** BullMQ QueueManager wraps Redis connection (shared core infrastructure). Metrics endpoint exports existing MetricsService in Prometheus text format.

**Tech Stack:** BullMQ 5.x, ioredis (existing), Express.js, Jest

**Spec Reference:** `docs/architecture/extended-architecture-implementation-spec.md` Part B.10, B.11

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/jobs/queue-manager.ts` | Create | BullMQ Queue + Worker manager with pause/resume |
| `backend/src/core/metrics/metrics-endpoint.ts` | Create | Prometheus format handler for GET /metrics |
| `backend/tests/core/jobs/queue-manager.test.ts` | Create | Unit tests for QueueManager |
| `backend/tests/core/metrics/metrics-endpoint.test.ts` | Create | Unit tests for metrics endpoint |
| `backend/src/main.ts` | Modify | Wire QueueManager + /metrics endpoint |
| `backend/package.json` | Modify | Add bullmq dependency |

---

### Task 1: Add BullMQ Dependency

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add bullmq to package.json dependencies**

In `backend/package.json`, add to `dependencies`:

```json
"bullmq": "^5.34.0"
```

- [ ] **Step 2: Install**

Run: `cd backend && npm install`
Expected: bullmq installed, no peer dependency errors

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add bullmq dependency for background job processing"
```

---

### Task 2: Implement QueueManager

**Files:**
- Create: `backend/src/core/jobs/queue-manager.ts`
- Create: `backend/tests/core/jobs/queue-manager.test.ts`

- [ ] **Step 1: Write the failing test for QueueManager creation**

```typescript
// backend/tests/core/jobs/queue-manager.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock bullmq before import
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string, opts: any) => ({
    name,
    opts,
    pause: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    resume: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    add: jest.fn<(name: string, data: any) => Promise<any>>().mockResolvedValue({ id: '1' }),
    getJobCounts: jest.fn<() => Promise<any>>().mockResolvedValue({ waiting: 0, active: 0 }),
  })),
  Worker: jest.fn().mockImplementation((name: string, processor: any, opts: any) => ({
    name,
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    on: jest.fn(),
  })),
}));

import { QueueManager } from '@core/jobs/queue-manager';

describe('QueueManager', () => {
  let mockRedis: any;
  let queueManager: QueueManager;

  beforeEach(() => {
    mockRedis = {
      duplicate: jest.fn().mockReturnValue({}),
      quit: jest.fn(),
    };
    queueManager = new QueueManager(mockRedis);
  });

  it('should create a queue with given name', () => {
    const queue = queueManager.createQueue({ name: 'test-queue' });
    expect(queue).toBeDefined();
    expect(queue.name).toBe('test-queue');
  });

  it('should pause all queues', async () => {
    const queue1 = queueManager.createQueue({ name: 'queue-1' });
    const queue2 = queueManager.createQueue({ name: 'queue-2' });

    await queueManager.pauseAll();

    expect(queue1.pause).toHaveBeenCalled();
    expect(queue2.pause).toHaveBeenCalled();
  });

  it('should resume all queues', async () => {
    const queue1 = queueManager.createQueue({ name: 'queue-1' });

    await queueManager.resumeAll();

    expect(queue1.resume).toHaveBeenCalled();
  });

  it('should close all queues and workers on closeAll', async () => {
    const queue = queueManager.createQueue({ name: 'test-queue' });

    await queueManager.closeAll();

    expect(queue.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/jobs/queue-manager.test.ts -v`
Expected: FAIL — "Cannot find module '@core/jobs/queue-manager'"

- [ ] **Step 3: Create QueueManager implementation**

```typescript
// backend/src/core/jobs/queue-manager.ts
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { createChildLogger } from '@core/logging/logger';

const log = createChildLogger({ component: 'QueueManager' });

interface QueueConfig {
  name: string;
  concurrency?: number;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: { type: string; delay: number };
    removeOnComplete?: number | boolean;
    removeOnFail?: number | boolean;
  };
}

interface WorkerConfig {
  queueName: string;
  processor: (job: any) => Promise<unknown>;
  concurrency?: number;
}

class QueueManager {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  constructor(private redis: Redis) {}

  createQueue(config: QueueConfig): Queue {
    if (this.queues.has(config.name)) {
      return this.queues.get(config.name)!;
    }

    const queue = new Queue(config.name, {
      connection: this.redis.duplicate(),
      defaultJobOptions: {
        attempts: config.defaultJobOptions?.attempts ?? 3,
        backoff: config.defaultJobOptions?.backoff ?? { type: 'exponential', delay: 1000 },
        removeOnComplete: config.defaultJobOptions?.removeOnComplete ?? 100,
        removeOnFail: config.defaultJobOptions?.removeOnFail ?? 500,
      },
    });

    this.queues.set(config.name, queue);
    log.info({ queue: config.name }, 'Queue created');
    return queue;
  }

  createWorker(config: WorkerConfig): Worker {
    if (this.workers.has(config.queueName)) {
      return this.workers.get(config.queueName)!;
    }

    const worker = new Worker(
      config.queueName,
      config.processor,
      {
        connection: this.redis.duplicate(),
        concurrency: config.concurrency ?? 1,
      },
    );

    worker.on('failed', (job, err) => {
      log.error({ queue: config.queueName, jobId: job?.id, err }, 'Job failed');
    });

    worker.on('completed', (job) => {
      log.info({ queue: config.queueName, jobId: job.id }, 'Job completed');
    });

    this.workers.set(config.queueName, worker);
    log.info({ queue: config.queueName }, 'Worker created');
    return worker;
  }

  getQueue(name: string): Queue | undefined {
    return this.queues.get(name);
  }

  async pauseAll(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.pause();
      log.info({ queue: name }, 'Queue paused');
    }
  }

  async resumeAll(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.resume();
      log.info({ queue: name }, 'Queue resumed');
    }
  }

  async closeAll(): Promise<void> {
    for (const [name, worker] of this.workers) {
      await worker.close();
      log.info({ queue: name }, 'Worker closed');
    }
    for (const [name, queue] of this.queues) {
      await queue.close();
      log.info({ queue: name }, 'Queue closed');
    }
    this.workers.clear();
    this.queues.clear();
  }
}

export { QueueManager };
export type { QueueConfig, WorkerConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/jobs/queue-manager.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/jobs/queue-manager.ts backend/tests/core/jobs/queue-manager.test.ts
git commit -m "feat: add BullMQ QueueManager with pause/resume support

QueueManager wraps BullMQ Queue and Worker lifecycle. Supports
createQueue(), createWorker(), pauseAll(), resumeAll(), closeAll().
Uses Redis duplicate() for dedicated connections per queue/worker."
```

---

### Task 3: Implement Metrics Endpoint (Prometheus Format)

**Files:**
- Create: `backend/src/core/metrics/metrics-endpoint.ts`
- Create: `backend/tests/core/metrics/metrics-endpoint.test.ts`
- Modify: `backend/src/main.ts` — add GET /metrics route

- [ ] **Step 1: Write the failing test for metrics endpoint**

```typescript
// backend/tests/core/metrics/metrics-endpoint.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { metricsService } from '@core/metrics/metrics.service';
import { createMetricsHandler } from '@core/metrics/metrics-endpoint';

describe('Metrics Endpoint', () => {
  let handler: (req: any, res: any) => void;
  let mockRes: any;

  beforeEach(() => {
    metricsService.reset();
    handler = createMetricsHandler(metricsService);

    mockRes = {
      set: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should return Prometheus format with Content-Type header', () => {
    metricsService.recordCounter('http_requests_total', 5);

    handler({}, mockRes);

    expect(mockRes.set).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    expect(mockRes.send).toHaveBeenCalled();
  });

  it('should export counters correctly', () => {
    metricsService.recordCounter('test_counter', 3);

    handler({}, mockRes);

    const output = mockRes.send.mock.calls[0][0] as string;
    expect(output).toContain('# TYPE test_counter counter');
    expect(output).toContain('test_counter 3');
  });

  it('should export gauges correctly', () => {
    metricsService.recordGauge('test_gauge', 42);

    handler({}, mockRes);

    const output = mockRes.send.mock.calls[0][0] as string;
    expect(output).toContain('# TYPE test_gauge gauge');
    expect(output).toContain('test_gauge 42');
  });

  it('should export histograms correctly', () => {
    metricsService.recordHistogram('test_histogram', 0.5);

    handler({}, mockRes);

    const output = mockRes.send.mock.calls[0][0] as string;
    expect(output).toContain('# TYPE test_histogram histogram');
    expect(output).toContain('test_histogram 0.5');
  });

  it('should handle empty metrics', () => {
    handler({}, mockRes);

    const output = mockRes.send.mock.calls[0][0] as string;
    expect(output).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/metrics/metrics-endpoint.test.ts -v`
Expected: FAIL — "Cannot find module '@core/metrics/metrics-endpoint'"

- [ ] **Step 3: Create metrics endpoint implementation**

```typescript
// backend/src/core/metrics/metrics-endpoint.ts
import type { Request, Response } from 'express';
import { MetricsService, MetricType } from '@core/metrics/metrics.service';

function createMetricsHandler(service: MetricsService) {
  return function metricsHandler(_req: Request, res: Response): void {
    const snapshot = service.snapshot();
    let output = '';

    // Group by metric name
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/metrics/metrics-endpoint.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Wire /metrics endpoint in main.ts**

In `backend/src/main.ts`, add import and route:

```typescript
import { metricsService } from '@core/metrics/metrics.service';
import { createMetricsHandler } from '@core/metrics/metrics-endpoint';

// After health endpoints, before globalErrorHandler:
app.get('/metrics', createMetricsHandler(metricsService));
```

- [ ] **Step 6: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/core/metrics/metrics-endpoint.ts backend/tests/core/metrics/metrics-endpoint.test.ts backend/src/main.ts
git commit -m "feat: add Prometheus metrics endpoint (GET /metrics)

Exports existing MetricsService in Prometheus text format.
Supports counter, gauge, and histogram metric types.
Endpoint: GET /metrics with Content-Type: text/plain."
```

---

### Task 4: Wire QueueManager in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Add QueueManager to bootstrap**

In `backend/src/main.ts`, after Redis is created:

```typescript
import { QueueManager } from '@core/jobs/queue-manager';

// After Redis initialization:
const queueManager = new QueueManager(redis);
logger.info('QueueManager initialized');
```

- [ ] **Step 2: Add QueueManager to graceful shutdown**

In the `shutdown` function, before `redis.quit()`:

```typescript
try {
  await queueManager.closeAll();
  logger.info('BullMQ queues closed');
} catch (e) {
  logger.error({ err: e }, 'Error closing BullMQ queues');
}
```

- [ ] **Step 3: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire QueueManager in bootstrap and graceful shutdown

QueueManager initialized with Redis connection. Included in graceful
shutdown sequence to close all BullMQ queues and workers cleanly."
```

---

### Task 5: Full Phase 1 Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Manual verification checklist**

- [ ] `bullmq` in package.json dependencies
- [ ] `QueueManager` has `createQueue()`, `createWorker()`, `pauseAll()`, `resumeAll()`, `closeAll()`
- [ ] `GET /metrics` route registered in main.ts
- [ ] `QueueManager` closed in graceful shutdown
- [ ] Metrics endpoint returns Prometheus text format

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 validation — BullMQ + Metrics all checks pass"
```

---

## Self-Review

**Spec coverage:**
- ✅ BullMQ QueueManager with pause/resume → Task 2
- ✅ Metrics endpoint Prometheus format → Task 3
- ✅ Wiring in main.ts → Task 4
- ✅ Graceful shutdown integration → Task 4

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `QueueConfig`, `WorkerConfig` match spec design. `createMetricsHandler` takes `MetricsService` (existing singleton).
