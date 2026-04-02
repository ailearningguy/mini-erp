import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('QueueManager', () => {
  it('should export QueueManager class', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/jobs/queue-manager.ts'),
      'utf-8',
    );
    expect(content).toMatch(/class QueueManager/);
    expect(content).toMatch(/createQueue/);
    expect(content).toMatch(/createWorker/);
    expect(content).toMatch(/pauseAll/);
    expect(content).toMatch(/resumeAll/);
    expect(content).toMatch(/closeAll/);
  });

  it('should export QueueConfig and WorkerConfig types', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/jobs/queue-manager.ts'),
      'utf-8',
    );
    expect(content).toMatch(/interface QueueConfig/);
    expect(content).toMatch(/interface WorkerConfig/);
  });

  it('should use bullmq Queue and Worker', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/jobs/queue-manager.ts'),
      'utf-8',
    );
    expect(content).toMatch(/from ['"]bullmq['"]/);
  });

  it('should use ioredis Redis type', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/jobs/queue-manager.ts'),
      'utf-8',
    );
    expect(content).toMatch(/ioredis/);
  });

  it('should use createChildLogger', () => {
    const content = readFileSync(
      resolve(__dirname, '../../../src/core/jobs/queue-manager.ts'),
      'utf-8',
    );
    expect(content).toMatch(/createChildLogger/);
  });
});
