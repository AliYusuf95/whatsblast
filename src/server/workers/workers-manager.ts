import { authWorker } from './auth-worker';
import { messageWorker } from './message-worker';
import { maintenanceWorker } from './maintenance-worker';
import { redisConnection } from '../queue';

class WorkersManager {
  private workers = [authWorker, messageWorker, maintenanceWorker];

  constructor() {}
  /**
   * Initialize all workers
   */
  async initialize(): Promise<void> {
    try {
      // Test Redis connection
      await redisConnection.ping();
      console.log('✅ Redis connection established');

      // Start all workers
      this.startWorkers();

      console.log('✅ Queue system initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize queue system:', error);
      throw error;
    }
  }

  /**
   * Start all workers
   */
  private startWorkers(): void {
    for (const worker of this.workers) {
      worker.start();
    }
  }
  /**
   * Stop all workers
   */
  async stopWorkers(): Promise<void> {
    for (const worker of this.workers) {
      try {
        await worker.stop();
        console.log(`✅ [${worker.queueName}] Worker stopped successfully`);
      } catch (error) {
        console.error(`❌ Failed to stop [${worker.queueName}] Worker:`, error);
      }
    }
  }
  /**
   * Restart all workers
   */
  async restartWorkers(): Promise<void> {
    await this.stopWorkers();
    await this.initialize();
    console.log('✅ All workers restarted successfully');
  }
  /**
   * Get the status of all workers
   */
  async getWorkersStatus(): Promise<Record<string, any>> {
    const status: Record<string, any> = {};
    for (const worker of this.workers) {
      const workerStatus = await worker.getStatus();
      status[`${worker.queueName}-worker`] = workerStatus;
    }
    return status;
  }
}

export const workersManager = new WorkersManager();
