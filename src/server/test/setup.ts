/**
 * Test Setup and Configuration
 *
 * Provides test database, mocks, and utilities for unit testing
 * Uses in-memory SQLite database for isolated test environments
 */

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import { createId } from '@paralleldrive/cuid2';
import { mock } from 'bun:test';
import { runMigrationsOnDb } from '../db/utils';
import type { Job } from 'bullmq';
import type { JobResult } from '../queue';
import type { AuthenticationCreds } from '@whiskeysockets/baileys';
import { type Session, type User } from '../auth';
import type { TrpcContext } from '../trpc';
import type { db } from '../db';
import {
  WhatsAppConnectionManager,
  WhatsAppSessionService,
  WhatsAppBulkService,
} from '../services';

/**
 * Initialize test database
 * Creates a fresh in-memory database with migrations for each test suite
 * Each call creates a completely isolated database instance
 */
export async function initTestDatabase() {
  // Create new in-memory database with unique name to ensure isolation
  const testSqlite = new Database(':memory:');
  const testDb = drizzle(testSqlite, { schema });

  // Run migrations
  await runMigrationsOnDb(testDb);

  // Return both db and cleanup function
  return {
    db: testDb,
    cleanup: () => {
      testSqlite.close();
    },
    schema,
  };
}

/**
 * Create test session data
 */
export function createTestSession(
  overrides?: Partial<typeof schema.whatsappSessions.$inferInsert>,
) {
  return {
    id: createId(),
    userId: 'test-user-' + createId(),
    description: 'Test session description',
    status: 'not_auth' as const,
    ...overrides,
  };
}

/**
 * Create test auth state data
 */
export function createTestAuthState(sessionId: string, key: string, value: any) {
  return {
    id: createId(),
    sessionId,
    key,
    value: Buffer.from(JSON.stringify(value)),
  };
}

/**
 * Create test bulk job data
 */
export function createTestBulkJob(overrides?: Partial<typeof schema.bulkJobs.$inferInsert>) {
  return {
    id: createId(),
    userId: 'test-user-' + createId(),
    sessionId: 'test-session-' + createId(),
    name: 'Test Job',
    status: 'pending' as const,
    totalMessages: 1,
    processedMessages: 0,
    successfulMessages: 0,
    failedMessages: 0,
    ...overrides,
  };
}

/**
 * Create mock BullMQ job for testing workers
 */
export function createMockJob<T>(data: T): Job<T, JobResult> {
  return {
    id: createId(),
    data: {
      timestamp: Date.now(),
      ...data,
    },
    updateProgress: mock(() => Promise.resolve()),
    log: mock(() => Promise.resolve(0)),
    moveToCompleted: mock(() => Promise.resolve()),
    moveToFailed: mock(() => Promise.resolve()),
  } as unknown as Job<T, JobResult>;
}

/**
 * Clear all test data and reset mocks
 * @deprecated Pass the database instance directly instead
 */
export async function clearTestData(testDb?: ReturnType<typeof drizzle<typeof schema>>) {
  if (testDb) {
    // Clear all tables - order matters due to foreign keys
    await testDb.delete(schema.bulkMessages);
    await testDb.delete(schema.bulkJobs);
    await testDb.delete(schema.authStates);
    await testDb.delete(schema.whatsappSessions);
  }
}

/**
 * Mock Redis client for testing
 */
export const mockRedis = {
  connect: () => Promise.resolve(),
  disconnect: () => Promise.resolve(),
  ping: () => Promise.resolve('PONG'),
  get: () => Promise.resolve(null),
  set: () => Promise.resolve('OK'),
  del: () => Promise.resolve(1),
  exists: () => Promise.resolve(0),
  expire: () => Promise.resolve(1),
  ttl: () => Promise.resolve(-1),
  flushall: () => Promise.resolve('OK'),
};

/**
 * Mock Baileys connection
 */
export const mockBaileysConnection = {
  user: null,
  connectionState: { connection: 'close', lastDisconnect: undefined },
  ev: {
    on: () => {},
    off: () => {},
    emit: () => {},
    removeAllListeners: () => {},
  },
  end: () => Promise.resolve(),
  logout: () => Promise.resolve(),
  ws: {
    readyState: 3, // CLOSED
    close: () => {},
  },
};

/**
 * Test utilities
 */
export const testUtils = {
  /**
   * Wait for a specified amount of time
   */
  wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),

  /**
   * Generate a test phone number
   */
  generateTestPhone: () => `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,

  /**
   * Generate test credentials
   */
  generateTestCreds: (): AuthenticationCreds => ({
    noiseKey: {
      private: Buffer.from('test-noise-key-private'),
      public: Buffer.from('test-noise-key-public'),
    },
    pairingEphemeralKeyPair: {
      private: Buffer.from('test-pairing-ephemeral-private'),
      public: Buffer.from('test-pairing-ephemeral-public'),
    },
    signedIdentityKey: {
      private: Buffer.from('test-identity-private'),
      public: Buffer.from('test-identity-public'),
    },
    registrationId: 12345,
    signedPreKey: {
      keyId: 1,
      keyPair: {
        private: Buffer.from('test-signed-pre-key-private'),
        public: Buffer.from('test-signed-pre-key-public'),
      },
      signature: Buffer.from('test-signed-pre-key-signature'),
    },
    advSecretKey: 'test-adv-secret-key',
    myAppStateKeyId: 'test-app-state-key-id',
    firstUnuploadedPreKeyId: 1,
    nextPreKeyId: 2,
    lastAccountSyncTimestamp: Date.now(),
    platform: 'android',
    processedHistoryMessages: [],
    accountSyncCounter: 0,
    accountSettings: {
      unarchiveChats: true,
    },
    registered: true,
    pairingCode: 'test-pairing-code',
    lastPropHash: 'test-last-prop-hash',
    routingInfo: undefined,
  }),

  stringToUint8Array: (str: string): Uint8Array => {
    return new TextEncoder().encode(str);
  },
  uint8ArrayToString: (arr: Uint8Array): string => {
    return new TextDecoder().decode(arr);
  },
  mockServices: (opts?: { db?: typeof db }) => {
    const db = opts?.db ?? (mock() as unknown as typeof db);
    const whatsappSessionService = new WhatsAppSessionService(db);
    const whatsappBulkService = new WhatsAppBulkService(db);
    const whatsappConnectionManager = new WhatsAppConnectionManager({
      whatsappSessionService,
      database: db,
    });
    return {
      whatsappSessionService,
      whatsappBulkService,
      whatsappConnectionManager,
    };
  },
  createContext: (opts?: {
    db?: typeof db;
    whatsappSessionService?: WhatsAppSessionService;
    whatsappBulkService?: WhatsAppBulkService;
    whatsappConnectionManager?: WhatsAppConnectionManager;
  }): TrpcContext => {
    return {
      session: null,
      user: null,
      db: opts?.db ?? (mock() as unknown as typeof db),
      services: testUtils.mockServices(opts),
      req: mock() as unknown as Request,
    };
  },
  createAuthContext: (opts?: {
    sessionId?: string;
    userId?: string;
    db?: typeof db;
    whatsappSessionService?: WhatsAppSessionService;
    whatsappBulkService?: WhatsAppBulkService;
    whatsappConnectionManager?: WhatsAppConnectionManager;
  }): TrpcContext => {
    const _sessionId = opts?.sessionId ?? 'test-session-' + createId();
    const _userId = opts?.userId ?? 'test-user-' + createId();
    const now = new Date();
    const session: Session = {
      id: _sessionId,
      userId: _userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour expiry
      token: createId(),
    };
    const user: User = {
      id: _userId,
      email: 'test@example.com',
      createdAt: now,
      updatedAt: now,
      name: 'Test User',
      emailVerified: true,
      image: 'https://example.com/test-user-image.png',
    };
    return {
      ...testUtils.createContext(opts),
      session,
      user,
    };
  },
};

/**
 * Mock environment variables for testing
 */
export function setupTestEnv() {
  const originalEnv = { ...process.env };

  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.DATABASE_URL = ':memory:';

  return () => {
    process.env = originalEnv;
  };
}

/**
 * Assert helper for type-safe testing
 */
export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}
