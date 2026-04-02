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
