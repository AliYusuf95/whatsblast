import Redis from 'ioredis';

// Redis connection configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0');

// Redis connection
export const redisConnection = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  db: REDIS_DB,
  lazyConnect: false, // Connect immediately
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: true,
  enableOfflineQueue: true,
});

// Queue names
export const QUEUE_NAMES = {
  WHATSAPP_AUTH: 'whatsapp-auth',
  WHATSAPP_MESSAGE: 'whatsapp-message',
  WHATSAPP_MAINTENANCE: 'whatsapp-maintenance',
  WHATSAPP_BULK: 'whatsapp-bulk',
} as const;

// Default job options
export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 100, // Keep last 100 completed jobs
  removeOnFail: 50, // Keep last 50 failed jobs
  attempts: 3, // Retry up to 3 times
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // Start with 2 second delay
  },
} as const;

// Queue-specific options
export const QUEUE_OPTIONS = {
  [QUEUE_NAMES.WHATSAPP_AUTH]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 1, // Auth operations should not retry automatically
    removeOnComplete: 50,
    delay: 0,
  },
  [QUEUE_NAMES.WHATSAPP_MESSAGE]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 5, // Messages can be retried more aggressively
    backoff: {
      type: 'exponential' as const,
      delay: 1000,
    },
  },
  [QUEUE_NAMES.WHATSAPP_MAINTENANCE]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 2,
    removeOnComplete: 20,
  },
  [QUEUE_NAMES.WHATSAPP_BULK]: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 3,
    removeOnComplete: 200, // Keep more bulk job history
  },
} as const;

// Redis event handlers
redisConnection.on('connect', () => {
  console.log('Redis connected');
});

redisConnection.on('ready', () => {
  console.log('Redis ready');
});

redisConnection.on('error', (error) => {
  console.error('Redis error:', error);
});

redisConnection.on('close', () => {
  console.log('Redis connection closed');
});

redisConnection.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down Redis connection...');
  await redisConnection.quit();
});

process.on('SIGINT', async () => {
  console.log('Shutting down Redis connection...');
  await redisConnection.quit();
});
