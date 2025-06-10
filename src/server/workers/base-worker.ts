// Base Worker Classes for BullMQ

import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queue/config';
import type { AllJobData, JobResult } from '../queue/job-types';

/**
 * Base Worker Class
 * Provides common functionality for all WhatsApp workers
 */
export abstract class BaseWorker<T extends AllJobData> {
  protected worker: Worker<T, JobResult>;
  protected isRunning = false;

  constructor(
    public queueName: string,
    protected concurrency: number = 1,
    protected rateLimitMax: number = 10,
    protected rateLimitDuration: number = 60000, // 1 minute
  ) {
    this.worker = new Worker<T, JobResult>(queueName, this.processJobWrapper.bind(this), {
      connection: redisConnection,
      concurrency: this.concurrency,
      limiter: {
        max: this.rateLimitMax,
        duration: this.rateLimitDuration,
      },
    });

    this.setupEventHandlers();
  }

  /**
   * Abstract method to be implemented by each worker
   */
  protected abstract processJob(job: Job<T, JobResult>): Promise<JobResult>;

  /**
   * Process job wrapper with error handling and logging
   */
  private async processJobWrapper(job: Job<T, JobResult>): Promise<JobResult> {
    const startTime = Date.now();
    const { id, name, data } = job;

    console.log(`[${this.queueName}] Processing job ${id} (${name}):`, {
      sessionId: data.sessionId,
      type: data.type,
      timestamp: data.timestamp,
    });

    try {
      // Update job progress
      await job.updateProgress(0);

      // Process the job
      const result = await this.processJob(job);

      // Update final progress
      await job.updateProgress(100);

      const duration = Date.now() - startTime;
      console.log(`[${this.queueName}] Job ${id} completed in ${duration}ms:`);

      return {
        ...result,
        timestamp: Date.now(),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`[${this.queueName}] Job ${id} failed after ${duration}ms:`, errorMessage);

      if (error! instanceof Error) {
        throw new Error(errorMessage);
      }
      throw error;
      // return {
      //   success: false,
      //   error: errorMessage,
      //   timestamp: Date.now(),
      //   duration,
      // };
    }
  }

  /**
   * Setup worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      console.log(`[${this.queueName}] Worker ready`);
    });

    this.worker.on('error', (error) => {
      console.error(`[${this.queueName}] Worker error:`, error);
    });

    this.worker.on('failed', (job, error) => {
      if (job) {
        console.error(`[${this.queueName}] Job ${job.id} failed:`, error.message);
      }
    });

    this.worker.on('completed', (job, result) => {
      if (job && result.success) {
        console.log(`[${this.queueName}] Job ${job.id} completed successfully`);
      }
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`[${this.queueName}] Job ${jobId} stalled`);
    });
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn(`[${this.queueName}] Worker already running`);
      return;
    }

    try {
      // The worker starts automatically when created
      this.isRunning = true;
      console.log(`[${this.queueName}] Worker started with concurrency ${this.concurrency}`);
    } catch (error) {
      console.error(`[${this.queueName}] Failed to start worker:`, error);
      throw error;
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.warn(`[${this.queueName}] Worker not running`);
      return;
    }

    try {
      await this.worker.close(true);
      this.isRunning = false;
      console.log(`[${this.queueName}] Worker stopped`);
    } catch (error) {
      console.error(`[${this.queueName}] Failed to stop worker:`, error);
      throw error;
    }
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    if (!this.isRunning) {
      console.warn(`[${this.queueName}] Worker not running, cannot pause`);
      return;
    }

    await this.worker.pause();
    console.log(`[${this.queueName}] Worker paused`);
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    if (!this.isRunning) {
      console.warn(`[${this.queueName}] Worker not running, cannot resume`);
      return;
    }

    await this.worker.resume();
    console.log(`[${this.queueName}] Worker resumed`);
  }

  /**
   * Get worker status
   */
  getStatus(): {
    isRunning: boolean;
    isPaused: boolean;
    concurrency: number;
    queueName: string;
  } {
    return {
      isRunning: this.isRunning,
      isPaused: this.worker.isPaused(),
      concurrency: this.concurrency,
      queueName: this.queueName,
    };
  }

  /**
   * Update worker concurrency
   */
  updateConcurrency(newConcurrency: number): void {
    if (newConcurrency <= 0) {
      throw new Error('Concurrency must be a positive number');
    }
    this.concurrency = newConcurrency;
  }

  /**
   * Utility method to validate job data
   */
  protected validateJobData(data: T): void {
    if (!data.sessionId) {
      throw new Error('Job data must include sessionId');
    }

    if (!data.type) {
      throw new Error('Job data must include type');
    }

    if (!data.timestamp) {
      throw new Error('Job data must include timestamp');
    }
  }

  /**
   * Utility method to create success result
   */
  createSuccessResult(data?: any): JobResult {
    return {
      success: true,
      data,
      timestamp: Date.now(),
    };
  }

  /**
   * Utility method to create error result
   */
  createErrorResult(error: string | Error, data?: any): JobResult {
    const errorMessage = error instanceof Error ? error.message : error;
    return {
      success: false,
      error: errorMessage,
      data,
      timestamp: Date.now(),
    };
  }
}

/**
 * Worker Manager Class
 * Manages multiple workers and provides centralized control
 */
export class WorkerManager {
  private workers: BaseWorker<any>[] = [];

  /**
   * Register a worker
   */
  registerWorker(worker: BaseWorker<any>): void {
    this.workers.push(worker);
  }

  /**
   * Start all workers
   */
  async startAll(): Promise<void> {
    console.log('Starting all workers...');

    const promises = this.workers.map((worker) => worker.start());
    await Promise.allSettled(promises);

    console.log(`✅ Started ${this.workers.length} workers`);
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    console.log('Stopping all workers...');

    const promises = this.workers.map((worker) => worker.stop());
    await Promise.allSettled(promises);

    console.log('✅ All workers stopped');
  }

  /**
   * Pause all workers
   */
  async pauseAll(): Promise<void> {
    const promises = this.workers.map((worker) => worker.pause());
    await Promise.allSettled(promises);
    console.log('All workers paused');
  }

  /**
   * Resume all workers
   */
  async resumeAll(): Promise<void> {
    const promises = this.workers.map((worker) => worker.resume());
    await Promise.allSettled(promises);
    console.log('All workers resumed');
  }

  /**
   * Get status of all workers
   */
  getWorkersStatus(): Array<{
    isRunning: boolean;
    isPaused: boolean;
    concurrency: number;
    queueName: string;
  }> {
    return this.workers.map((worker) => worker.getStatus());
  }

  /**
   * Get worker count
   */
  getWorkerCount(): number {
    return this.workers.length;
  }
}

// Export singleton instance
export const workerManager = new WorkerManager();
