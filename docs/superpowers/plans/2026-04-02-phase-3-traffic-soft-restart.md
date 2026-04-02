# Phase 3: Traffic Control + SoftRestartManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement traffic gating (503 during restart), request tracking (drain in-flight), AMQP consumer pause/resume, SystemState enum, và SoftRestartManager orchestration — enable soft restart without process restart.

**Architecture:** TrafficGate + RequestTracker as Express middleware. SoftRestartManager orchestrates: pause traffic → pause consumer → drain requests → refresh registry → rebuild container → resume. SystemState exposed via /health.

**Tech Stack:** TypeScript, Express.js, Jest, amqplib (existing)

**Spec Reference:** `docs/architecture/extended-architecture-implementation-spec.md` Part B.6, B.7, B.8, B.9

**Prerequisite:** Phase 0 + Phase 1 + Phase 2 complete

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/traffic/traffic-gate.ts` | Create | TrafficGate middleware (503 when paused) |
| `backend/src/core/traffic/request-tracker.ts` | Create | RequestTracker middleware (drain in-flight) |
| `backend/src/core/restart/system-state.ts` | Create | SystemState enum + manager |
| `backend/src/core/restart/soft-restart-manager.ts` | Create | Orchestrator for soft restart |
| `backend/tests/core/traffic/traffic-gate.test.ts` | Create | Unit tests |
| `backend/tests/core/traffic/request-tracker.test.ts` | Create | Unit tests |
| `backend/tests/core/restart/soft-restart-manager.test.ts` | Create | Unit tests |
| `backend/src/core/consumer/amqp-consumer.ts` | Modify | Add pause()/resume() |
| `backend/src/core/consumer/consumer.ts` | Modify | Add unregisterAll() |
| `backend/src/main.ts` | Modify | Wire TrafficGate + RequestTracker + SoftRestartManager |

---

### Task 1: Implement TrafficGate

**Files:**
- Create: `backend/src/core/traffic/traffic-gate.ts`
- Create: `backend/tests/core/traffic/traffic-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/traffic/traffic-gate.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TrafficGate } from '@core/traffic/traffic-gate';

describe('TrafficGate', () => {
  let gate: TrafficGate;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    gate = new TrafficGate();
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('should pass through when state is OPEN', () => {
    gate.middleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('should return 503 when state is PAUSED', () => {
    gate.pause();
    gate.middleware(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(503);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'MAINTENANCE',
        message: 'System is updating, please retry later',
      },
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should pass through again after resume', () => {
    gate.pause();
    gate.resume();
    gate.middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('isOpen() should reflect current state', () => {
    expect(gate.isOpen()).toBe(true);
    gate.pause();
    expect(gate.isOpen()).toBe(false);
    gate.resume();
    expect(gate.isOpen()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/traffic/traffic-gate.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create TrafficGate implementation**

```typescript
// backend/src/core/traffic/traffic-gate.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/traffic/traffic-gate.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/traffic/traffic-gate.ts backend/tests/core/traffic/traffic-gate.test.ts
git commit -m "feat: add TrafficGate middleware for soft restart

Returns 503 MAINTENANCE when paused. Used by SoftRestartManager to
block new requests during container rebuild."
```

---

### Task 2: Implement RequestTracker

**Files:**
- Create: `backend/src/core/traffic/request-tracker.ts`
- Create: `backend/tests/core/traffic/request-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/traffic/request-tracker.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RequestTracker } from '@core/traffic/request-tracker';

describe('RequestTracker', () => {
  let tracker: RequestTracker;
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    tracker = new RequestTracker();
    mockReq = {};
    mockRes = {
      on: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should track active requests via middleware', () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(mockRes.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(tracker.getActiveCount()).toBe(1);
  });

  it('should decrement on finish event', () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    // Simulate finish event
    const finishHandler = mockRes.on.mock.calls.find(
      (call: any[]) => call[0] === 'finish'
    )[1];
    finishHandler();

    expect(tracker.getActiveCount()).toBe(0);
  });

  it('drain() should resolve when no active requests', async () => {
    const result = await tracker.drain(1000);
    expect(result).toBe(true);
  });

  it('drain() should timeout when requests are still active', async () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    const result = await tracker.drain(50);
    expect(result).toBe(false);
    expect(tracker.getActiveCount()).toBe(1);
  });

  it('drain() should resolve when all requests complete during drain', async () => {
    tracker.middleware(mockReq, mockRes, mockNext);

    // Simulate finish after 10ms
    const finishHandler = mockRes.on.mock.calls.find(
      (call: any[]) => call[0] === 'finish'
    )[1];
    setTimeout(() => finishHandler(), 10);

    const result = await tracker.drain(1000);
    expect(result).toBe(true);
    expect(tracker.getActiveCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/traffic/request-tracker.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create RequestTracker implementation**

```typescript
// backend/src/core/traffic/request-tracker.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/traffic/request-tracker.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/traffic/request-tracker.ts backend/tests/core/traffic/request-tracker.test.ts
git commit -m "feat: add RequestTracker for in-flight request drain

Tracks active requests via finish/close events. drain(timeout) waits
for all requests to complete or returns false on timeout."
```

---

### Task 3: Add AMQP Consumer Pause/Resume

**Files:**
- Modify: `backend/src/core/consumer/amqp-consumer.ts`

- [ ] **Step 1: Write the failing test for pause/resume**

```typescript
// Add to backend/tests/core/consumer/amqp-consumer.test.ts

describe('AmqpConsumer pause/resume', () => {
  it('should have pause() method', () => {
    const consumer = new AmqpConsumer(mockEventConsumer, mockConfig);
    expect(typeof consumer.pause).toBe('function');
  });

  it('should have resume() method', () => {
    const consumer = new AmqpConsumer(mockEventConsumer, mockConfig);
    expect(typeof consumer.resume).toBe('function');
  });

  it('pause() should be safe to call when not connected', async () => {
    const consumer = new AmqpConsumer(mockEventConsumer, mockConfig);
    await expect(consumer.pause()).resolves.not.toThrow();
  });

  it('resume() should be safe to call when not connected', async () => {
    const consumer = new AmqpConsumer(mockEventConsumer, mockConfig);
    await expect(consumer.resume()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/consumer/amqp-consumer.test.ts -t "pause" -v`
Expected: FAIL — pause/resume not defined

- [ ] **Step 3: Add pause/resume to AmqpConsumer**

Add these fields and methods to the `AmqpConsumer` class in `backend/src/core/consumer/amqp-consumer.ts`:

```typescript
class AmqpConsumer {
  // ... existing fields ...
  private paused = false;
  private consumerTag: string | null = null;

  // Modify the existing start() method to capture consumerTag:
  async start(): Promise<void> {
    if (!this.channel) {
      throw new Error('AmqpConsumer not connected. Call connect() first.');
    }

    const result = this.channel.consume(this.config.queue, async (msg: AmqpMessage | null) => {
      if (!msg) return;
      if (this.paused) {
        // Re-queue if paused
        this.channel!.nack(msg, false, true);
        return;
      }
      try {
        const rawEvent = JSON.parse(msg.content.toString());
        await this.eventConsumer.consume(rawEvent);
        this.channel!.ack(msg);
      } catch (error) {
        logger.error({ err: error, deliveryTag: msg.fields.deliveryTag }, 'Failed to process message');
        this.channel!.nack(msg, false, true);
      }
    });

    this.consumerTag = result.consumerTag;
    logger.info('AMQP consumer started, waiting for messages');
  }

  async pause(): Promise<void> {
    if (!this.channel || !this.consumerTag) {
      this.paused = true;
      return;
    }
    this.paused = true;
    await this.channel.cancel(this.consumerTag);
    this.consumerTag = null;
    logger.info('AMQP consumer paused');
  }

  async resume(): Promise<void> {
    if (!this.channel) {
      this.paused = false;
      return;
    }
    if (!this.paused) return;

    this.paused = false;
    const result = this.channel.consume(this.config.queue, async (msg: AmqpMessage | null) => {
      if (!msg) return;
      try {
        const rawEvent = JSON.parse(msg.content.toString());
        await this.eventConsumer.consume(rawEvent);
        this.channel!.ack(msg);
      } catch (error) {
        logger.error({ err: error }, 'Failed to process message');
        this.channel!.nack(msg, false, true);
      }
    });
    this.consumerTag = result.consumerTag;
    logger.info('AMQP consumer resumed');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/consumer/amqp-consumer.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/consumer/amqp-consumer.ts backend/tests/core/consumer/amqp-consumer.test.ts
git commit -m "feat: add pause/resume to AMQP consumer

Uses channel.cancel(consumerTag) to stop consumption.
Messages received while paused are nacked with requeue=true.
Safe to call when not connected."
```

---

### Task 4: Add EventConsumer.unregisterAll()

**Files:**
- Modify: `backend/src/core/consumer/consumer.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// Add to backend/tests/core/consumer/consumer.test.ts

describe('EventConsumer unregisterAll', () => {
  it('should clear all registered handlers', () => {
    const consumer = new EventConsumer(mockStore, mockRegistry, mockLimiter, mockTx);
    consumer.registerHandler('event.a', async () => {});
    consumer.registerHandler('event.b', async () => {});

    expect(consumer.getRegisteredHandlerTypes()).toHaveLength(2);

    consumer.unregisterAll();

    expect(consumer.getRegisteredHandlerTypes()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/consumer/consumer.test.ts -t "unregisterAll" -v`
Expected: FAIL — unregisterAll not defined

- [ ] **Step 3: Add unregisterAll to EventConsumer**

Add to `EventConsumer` class in `backend/src/core/consumer/consumer.ts`:

```typescript
unregisterAll(): void {
  this.handlers.clear();
  this.aggregateQueues.clear();
}

unregisterHandler(eventType: string): boolean {
  return this.handlers.delete(eventType);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/consumer/consumer.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/consumer/consumer.ts backend/tests/core/consumer/consumer.test.ts
git commit -m "feat: add unregisterAll() and unregisterHandler() to EventConsumer

Needed for soft restart — clear module event handlers before rebuild."
```

---

### Task 5: Implement SystemState

**Files:**
- Create: `backend/src/core/restart/system-state.ts`

- [ ] **Step 1: Create SystemState enum and manager**

```typescript
// backend/src/core/restart/system-state.ts
import { metricsService } from '@core/metrics/metrics.service';

enum SystemState {
  RUNNING = 'RUNNING',
  RESTARTING = 'RESTARTING',
  MAINTENANCE = 'MAINTENANCE',
}

class SystemStateManager {
  private state: SystemState = SystemState.RUNNING;

  getState(): SystemState {
    return this.state;
  }

  async transitionTo(newState: SystemState): Promise<void> {
    this.state = newState;
    metricsService.recordGauge('system_state', this.state === SystemState.RUNNING ? 1 : 0);
  }

  isRunning(): boolean {
    return this.state === SystemState.RUNNING;
  }
}

export { SystemState, SystemStateManager };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/core/restart/system-state.ts
git commit -m "feat: add SystemState enum and SystemStateManager

States: RUNNING, RESTARTING, MAINTENANCE.
Exposed via /health endpoint. Metrics gauge tracks state."
```

---

### Task 6: Implement SoftRestartManager

**Files:**
- Create: `backend/src/core/restart/soft-restart-manager.ts`
- Create: `backend/tests/core/restart/soft-restart-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend/tests/core/restart/soft-restart-manager.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SoftRestartManager } from '@core/restart/soft-restart-manager';

function createMocks() {
  return {
    gate: { pause: jest.fn(), resume: jest.fn(), isOpen: jest.fn().mockReturnValue(true) },
    tracker: { drain: jest.fn<() => Promise<boolean>>().mockResolvedValue(true), getActiveCount: jest.fn().mockReturnValue(0) },
    registry: { refresh: jest.fn().mockResolvedValue([]), getActive: jest.fn().mockReturnValue([]) },
    container: { rebuild: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    amqpConsumer: { pause: jest.fn<() => Promise<void>>().mockResolvedValue(undefined), resume: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    queueManager: { pauseAll: jest.fn<() => Promise<void>>().mockResolvedValue(undefined), resumeAll: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('SoftRestartManager', () => {
  let manager: SoftRestartManager;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    manager = new SoftRestartManager(
      mocks.gate as any,
      mocks.tracker as any,
      mocks.registry as any,
      mocks.container as any,
      mocks.amqpConsumer as any,
      mocks.queueManager as any,
      mocks.logger as any,
    );
  });

  it('should execute full restart flow in order', async () => {
    await manager.restart('test-restart');

    // Verify order of operations
    expect(mocks.gate.pause).toHaveBeenCalledBefore(mocks.amqpConsumer.pause);
    expect(mocks.amqpConsumer.pause).toHaveBeenCalledBefore(mocks.queueManager.pauseAll);
    expect(mocks.queueManager.pauseAll).toHaveBeenCalledBefore(mocks.tracker.drain);
    expect(mocks.registry.refresh).toHaveBeenCalledAfter(mocks.tracker.drain);
    expect(mocks.container.rebuild).toHaveBeenCalledAfter(mocks.registry.refresh);
    expect(mocks.gate.resume).toHaveBeenCalledAfter(mocks.container.rebuild);
  });

  it('should pause traffic before rebuilding', async () => {
    await manager.restart('test');

    expect(mocks.gate.pause).toHaveBeenCalled();
    expect(mocks.container.rebuild).toHaveBeenCalled();
    expect(mocks.gate.resume).toHaveBeenCalled();
  });

  it('should rollback on rebuild failure', async () => {
    mocks.container.rebuild
      .mockRejectedValueOnce(new Error('build failed'))
      .mockResolvedValueOnce(undefined); // rollback succeeds

    mocks.registry.getActive.mockReturnValue([{ name: 'old-module' }]);

    await expect(manager.restart('test')).rejects.toThrow('build failed');

    // Rollback should have been called
    expect(mocks.container.rebuild).toHaveBeenCalledTimes(2);
    // Resume should still be called in finally
    expect(mocks.gate.resume).toHaveBeenCalled();
    expect(mocks.amqpConsumer.resume).toHaveBeenCalled();
  });

  it('should proceed on drain timeout', async () => {
    mocks.tracker.drain.mockResolvedValue(false); // timeout

    await manager.restart('test');

    // Should still complete restart
    expect(mocks.container.rebuild).toHaveBeenCalled();
    expect(mocks.gate.resume).toHaveBeenCalled();
  });

  it('should resume everything even on error', async () => {
    mocks.container.rebuild.mockRejectedValue(new Error('fail'));

    try {
      await manager.restart('test');
    } catch {
      // expected
    }

    expect(mocks.gate.resume).toHaveBeenCalled();
    expect(mocks.amqpConsumer.resume).toHaveBeenCalled();
    expect(mocks.queueManager.resumeAll).toHaveBeenCalled();
  });

  it('should log restart lifecycle', async () => {
    await manager.restart('install:product');

    expect(mocks.logger.info).toHaveBeenCalledWith(
      { reason: 'install:product' },
      'soft-restart:start',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({}),
      'soft-restart:success',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/restart/soft-restart-manager.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create SoftRestartManager implementation**

```typescript
// backend/src/core/restart/soft-restart-manager.ts
import type { TrafficGate } from '@core/traffic/traffic-gate';
import type { RequestTracker } from '@core/traffic/request-tracker';
import type { ModuleRegistry } from '@core/module-registry/registry';
import type { DIContainer } from '@core/di/container';
import type { AmqpConsumer } from '@core/consumer/amqp-consumer';
import type { QueueManager } from '@core/jobs/queue-manager';
import { metricsService } from '@core/metrics/metrics.service';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class SoftRestartManager {
  constructor(
    private gate: TrafficGate,
    private tracker: RequestTracker,
    private registry: ModuleRegistry,
    private container: DIContainer,
    private amqpConsumer: AmqpConsumer,
    private queueManager: QueueManager,
    private logger: Logger,
  ) {}

  async restart(reason: string): Promise<void> {
    const startTime = Date.now();
    metricsService.recordCounter('system_restart_total');
    this.logger.info({ reason }, 'soft-restart:start');

    // Step 1: Pause traffic (block new requests)
    this.gate.pause();

    // Step 2: Pause AMQP consumer (stop event processing)
    await this.amqpConsumer.pause();

    // Step 3: Pause BullMQ queues (stop background jobs)
    await this.queueManager.pauseAll();

    // Step 4: Drain in-flight requests (best-effort with timeout)
    const drained = await this.tracker.drain(5000);
    if (!drained) {
      this.logger.warn(
        { remaining: this.tracker.getActiveCount() },
        'soft-restart: drain timeout, proceeding with active requests',
      );
    }

    // Step 5: Snapshot + rebuild
    const snapshotBefore = this.registry.getActive();

    try {
      const mods = await this.registry.refresh();
      await this.container.rebuild(mods);

      const durationMs = Date.now() - startTime;
      metricsService.recordHistogram('system_restart_duration_seconds', durationMs / 1000);
      this.logger.info(
        { mods: mods.map(m => m.name), durationMs },
        'soft-restart:success',
      );
    } catch (err) {
      metricsService.recordCounter('system_restart_failed_total');
      this.logger.error({ err }, 'soft-restart:failed');

      // Rollback: rebuild from snapshot
      try {
        await this.container.rebuild(snapshotBefore);
        this.logger.info('soft-restart:rollback-success');
      } catch (rollbackErr) {
        this.logger.error({ err: rollbackErr }, 'soft-restart:rollback-failed');
      }
      throw err;
    } finally {
      // Always resume — even on failure
      await this.queueManager.resumeAll();
      await this.amqpConsumer.resume();
      this.gate.resume();
    }
  }
}

export { SoftRestartManager };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/restart/soft-restart-manager.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/restart/soft-restart-manager.ts backend/tests/core/restart/soft-restart-manager.test.ts
git commit -m "feat: add SoftRestartManager — full soft restart orchestration

Flow: pause traffic → pause AMQP → pause BullMQ → drain requests →
refresh registry → rebuild container → resume all.

Rollback on failure: rebuild from snapshot, always resume in finally.
Metrics: system_restart_total, duration, failed."
```

---

### Task 7: Wire Everything in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Add TrafficGate + RequestTracker to middleware chain**

In `main.ts`, after `snakeCaseResponseMiddleware` and before `createRateLimiter`:

```typescript
import { TrafficGate } from '@core/traffic/traffic-gate';
import { RequestTracker } from '@core/traffic/request-tracker';
import { SystemStateManager } from '@core/restart/system-state';
import { SoftRestartManager } from '@core/restart/soft-restart-manager';

// Create instances
const trafficGate = new TrafficGate();
const requestTracker = new RequestTracker();
const systemStateManager = new SystemStateManager();

// Middleware chain — TrafficGate + RequestTracker BEFORE rate limiter
app.use(trafficGate.middleware);
app.use(requestTracker.middleware);
// ... existing rate limiter, idempotency, auth ...
```

- [ ] **Step 2: Wire SoftRestartManager**

After container.build() and amqpConsumer initialization:

```typescript
const softRestartManager = new SoftRestartManager(
  trafficGate,
  requestTracker,
  registry,
  container,
  amqpConsumer,
  queueManager,
  logger,
);

logger.info('SoftRestartManager initialized');
```

- [ ] **Step 3: Update /health/readiness to include system state**

```typescript
app.get('/health/readiness', async (_req, res) => {
  const systemState = systemStateManager.getState();

  if (systemState === 'RESTARTING') {
    return res.status(503).json({
      status: 'restarting',
      system_state: systemState,
    });
  }

  // ... existing DB + Redis checks ...
});
```

- [ ] **Step 4: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire TrafficGate, RequestTracker, SoftRestartManager in main.ts

Middleware chain: TrafficGate → RequestTracker → rate limiter → auth.
SoftRestartManager created with all dependencies.
Health endpoint exposes SystemState during restart."
```

---

### Task 8: Full Phase 3 Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Manual verification**

- [ ] TrafficGate returns 503 when paused
- [ ] RequestTracker tracks active requests
- [ ] AMQP consumer has pause() and resume()
- [ ] EventConsumer has unregisterAll()
- [ ] SoftRestartManager imported and instantiated in main.ts
- [ ] /health/readiness returns 503 when system is RESTARTING

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 3 validation — traffic control + soft restart all checks pass"
```

---

## Self-Review

**Spec coverage:**
- ✅ TrafficGate (503 middleware) → Task 1
- ✅ RequestTracker (drain) → Task 2
- ✅ AMQP consumer pause/resume → Task 3
- ✅ EventConsumer.unregisterAll() → Task 4
- ✅ SystemState enum → Task 5
- ✅ SoftRestartManager orchestration → Task 6
- ✅ main.ts wiring → Task 7

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** All mock types match real interfaces. `SoftRestartManager` constructor matches spec design.
