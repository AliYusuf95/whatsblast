// BullMQ Queue Setup and Management

import { Queue, QueueEvents } from 'bullmq';
import { redisConnection, QUEUE_NAMES, QUEUE_OPTIONS } from './config';
import type {
  AuthJobData,
  MessageJobData,
  MaintenanceJobData,
  BulkOperationJobData,
  JobResult,
} from './job-types';

/**
 * WhatsApp Authentication Queue
 * Handles QR generation, pairing, and auth validation
 */
export const whatsappAuthQueue = new Queue<AuthJobData, JobResult>(QUEUE_NAMES.WHATSAPP_AUTH, {
  connection: redisConnection,
  defaultJobOptions: QUEUE_OPTIONS[QUEUE_NAMES.WHATSAPP_AUTH],
});

/**
 * WhatsApp Message Queue
 * Handles single messages and message status updates
 */
export const whatsappMessageQueue = new Queue<MessageJobData, JobResult>(
  QUEUE_NAMES.WHATSAPP_MESSAGE,
  {
    connection: redisConnection,
    defaultJobOptions: QUEUE_OPTIONS[QUEUE_NAMES.WHATSAPP_MESSAGE],
  },
);

/**
 * WhatsApp Maintenance Queue
 * Handles health checks, cleanup, and session validation
 */
export const whatsappMaintenanceQueue = new Queue<MaintenanceJobData, JobResult>(
  QUEUE_NAMES.WHATSAPP_MAINTENANCE,
  {
    connection: redisConnection,
    defaultJobOptions: QUEUE_OPTIONS[QUEUE_NAMES.WHATSAPP_MAINTENANCE],
  },
);

/**
 * WhatsApp Bulk Operations Queue
 * Handles bulk messaging and large operations
 */
export const whatsappBulkQueue = new Queue<BulkOperationJobData, JobResult>(
  QUEUE_NAMES.WHATSAPP_BULK,
  {
    connection: redisConnection,
    defaultJobOptions: QUEUE_OPTIONS[QUEUE_NAMES.WHATSAPP_BULK],
  },
);

// Queue Events for monitoring
export const authQueueEvents = new QueueEvents(QUEUE_NAMES.WHATSAPP_AUTH, {
  connection: redisConnection,
});

export const messageQueueEvents = new QueueEvents(QUEUE_NAMES.WHATSAPP_MESSAGE, {
  connection: redisConnection,
});

export const maintenanceQueueEvents = new QueueEvents(QUEUE_NAMES.WHATSAPP_MAINTENANCE, {
  connection: redisConnection,
});

export const bulkQueueEvents = new QueueEvents(QUEUE_NAMES.WHATSAPP_BULK, {
  connection: redisConnection,
});

/**
 * Queue Manager Class
 * Centralized queue management and monitoring
 */
export class QueueManager {
  private queues = [
    whatsappAuthQueue,
    whatsappMessageQueue,
    whatsappMaintenanceQueue,
    whatsappBulkQueue,
  ];

  private queueEvents = [
    authQueueEvents,
    messageQueueEvents,
    maintenanceQueueEvents,
    bulkQueueEvents,
  ];

  /**
   * Initialize all queues and event listeners
   */
  async initialize(): Promise<void> {
    try {
      // Test Redis connection
      await redisConnection.ping();
      console.log('✅ Redis connection established');

      // Setup queue event listeners
      this.setupEventListeners();

      console.log('✅ Queue system initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize queue system:', error);
      throw error;
    }
  }

  /**
   * Setup global queue event listeners for monitoring
   */
  private setupEventListeners(): void {
    // Auth queue events
    authQueueEvents.on('added', ({ jobId }) => {
      console.log(`Auth job ${jobId} is waiting`);
    });

    authQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Auth job ${jobId} completed:`, returnvalue);
    });

    authQueueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Auth job ${jobId} failed:`, failedReason);
    });

    // Message queue events
    messageQueueEvents.on('added', ({ jobId }) => {
      console.log(`Message job ${jobId} is waiting`);
    });

    messageQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Message job ${jobId} completed:`, returnvalue);
    });

    messageQueueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Message job ${jobId} failed:`, failedReason);
    });

    // Maintenance queue events
    maintenanceQueueEvents.on('added', ({ jobId }) => {
      console.log(`Maintenance job ${jobId} is waiting`);
    });

    maintenanceQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Maintenance job ${jobId} completed:`, returnvalue);
    });

    maintenanceQueueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Maintenance job ${jobId} failed:`, failedReason);
    });

    // Bulk queue events
    bulkQueueEvents.on('added', ({ jobId }) => {
      console.log(`Bulk job ${jobId} is waiting`);
    });

    bulkQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`Bulk job ${jobId} completed:`, returnvalue);
    });

    bulkQueueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`Bulk job ${jobId} failed:`, failedReason);
    });

    // Global error handling
    this.queueEvents.forEach((events) => {
      events.on('error', (error) => {
        console.error('Queue event error:', error);
      });
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const queue of this.queues) {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      stats[queue.name] = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        total: waiting.length + active.length + completed.length + failed.length,
      };
    }

    return stats;
  }

  /**
   * Clean old jobs from all queues
   */
  async cleanOldJobs(): Promise<void> {
    const promises = this.queues.map(async (queue) => {
      try {
        await queue.clean(24 * 60 * 60 * 1000, 100, 'completed'); // Clean completed jobs older than 24h
        await queue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed'); // Clean failed jobs older than 7 days
        console.log(`Cleaned old jobs from queue: ${queue.name}`);
      } catch (error) {
        console.error(`Failed to clean queue ${queue.name}:`, error);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Pause all queues
   */
  async pauseAll(): Promise<void> {
    const promises = this.queues.map((queue) => queue.pause());
    await Promise.allSettled(promises);
    console.log('All queues paused');
  }

  /**
   * Resume all queues
   */
  async resumeAll(): Promise<void> {
    const promises = this.queues.map((queue) => queue.resume());
    await Promise.allSettled(promises);
    console.log('All queues resumed');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down queue manager...');

    // Close queue events
    const eventPromises = this.queueEvents.map((events) => events.close());
    await Promise.allSettled(eventPromises);

    // Close queues
    const queuePromises = this.queues.map((queue) => queue.close());
    await Promise.allSettled(queuePromises);

    // Close Redis connection
    await redisConnection.quit();

    console.log('✅ Queue manager shutdown complete');
  }
}

// Export singleton instance
export const queueManager = new QueueManager();
