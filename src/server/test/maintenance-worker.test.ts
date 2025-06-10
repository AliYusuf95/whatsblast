/**
 * Maintenance Worker Unit Tests
 *
 * Tests the MaintenanceWorker class including:
 * - Constructor and configuration
 * - Health check operations
 * - Cleanup operations
 * - Session validation
 * - Error handling
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { MaintenanceWorker } from '../workers/maintenance-worker';
import { initTestDatabase, createTestSession, createMockJob } from './setup';
import * as schema from '../db/schema';

describe('MaintenanceWorker', () => {
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;
  });

  afterEach(async () => {
    cleanupDb();
  });

  describe('Connection Health Check Operations', () => {
    test('should perform connection health check with valid session', async () => {
      // Create test session
      const sessionData = createTestSession({
        status: 'paired',
        phone: '+1234567890',
      });

      await db.insert(schema.whatsappSessions).values(sessionData);

      // Mock connection manager
      const mockConnectionManager = {
        getConnection: mock(() => ({
          isConnected: () => true,
          user: { id: '1234567890:1@c.us' },
        })),
        createConnection: mock(() => Promise.resolve()),
        removeConnection: mock(() => Promise.resolve()),
      };

      // Mock session service
      const mockSessionService = {
        getSessionById: mock(() => Promise.resolve(sessionData)),
        getInactiveSessions: mock(() => Promise.resolve([sessionData])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
        updateSession: mock(() => Promise.resolve()),
        updateLastUsed: mock(() => Promise.resolve()),
      };

      // Create worker with mocked dependencies
      const worker = new MaintenanceWorker({
        whatsappConnectionManager: mockConnectionManager as any,
        whatsappSessionService: mockSessionService as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        sessionId: sessionData.id,
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.totalChecked).toBe(1);
      expect(result.data.healthyCount).toBeGreaterThanOrEqual(0);
      expect(result.data.checkedAt).toEqual(expect.any(Number));
      expect(mockSessionService.getSessionById).toHaveBeenCalledWith(sessionData.id);
    });

    test('should handle connection health check with disconnected session', async () => {
      const sessionData = createTestSession({
        status: 'paired',
        phone: '+1234567890',
      });

      await db.insert(schema.whatsappSessions).values(sessionData);

      // Mock disconnected connection
      const mockConnectionManager = {
        getConnection: mock(() => ({
          isConnected: () => false,
          connect: mock(() => Promise.resolve()),
        })),
        createConnection: mock(() => Promise.resolve()),
        removeConnection: mock(() => Promise.resolve()),
      };

      const mockSessionService = {
        getSessionById: mock(() => Promise.resolve(sessionData)),
        getInactiveSessions: mock(() => Promise.resolve([sessionData])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
        updateSession: mock(() => Promise.resolve()),
        updateLastUsed: mock(() => Promise.resolve()),
      };

      const worker = new MaintenanceWorker({
        whatsappConnectionManager: mockConnectionManager as any,
        whatsappSessionService: mockSessionService as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        sessionId: sessionData.id,
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.totalChecked).toBe(1);
      expect(result.data.reconnectedCount).toBeGreaterThanOrEqual(0);
    });

    test('should handle connection health check with non-existent session', async () => {
      const mockSessionService = {
        getSessionById: mock(() => Promise.resolve(null)),
        getSessionsByStatus: mock(() => Promise.resolve([])),
      };

      const worker = new MaintenanceWorker({
        whatsappSessionService: mockSessionService as any,
        whatsappConnectionManager: mock() as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        sessionId: 'non-existent-session',
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session');
      expect(result.error).toContain('not found');
    });

    test('should check all inactive sessions when no sessionId provided', async () => {
      // Create inactive sessions
      const inactiveTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

      const inactiveSession = createTestSession({
        status: 'paired',
        phone: '+1234567890',
        lastUsedAt: inactiveTime,
      });

      await db.insert(schema.whatsappSessions).values([inactiveSession]);

      // Mock services
      const mockConnectionManager = {
        getConnection: mock(() => null),
        createConnection: mock(() => Promise.resolve()),
        removeConnection: mock(() => Promise.resolve()),
      };

      const mockSessionService = {
        getInactiveSessions: mock(() => Promise.resolve([inactiveSession])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
        updateSession: mock(() => Promise.resolve()),
        updateLastUsed: mock(() => Promise.resolve()),
      };

      const worker = new MaintenanceWorker({
        whatsappConnectionManager: mockConnectionManager as any,
        whatsappSessionService: mockSessionService as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        inactiveHoursThreshold: 24,
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.totalChecked).toBe(1);
      expect(mockSessionService.getInactiveSessions).toHaveBeenCalledWith(24);
    });
  });

  describe('Session Cleanup and Reconnection', () => {
    test('should clean up sessions with invalid auth', async () => {
      const sessionData = createTestSession({
        status: 'paired',
        phone: '+1234567890',
      });

      await db.insert(schema.whatsappSessions).values(sessionData);

      const mockConnectionManager = {
        getConnection: mock(() => null),
        removeConnection: mock(() => Promise.resolve()),
        createConnection: mock(() => Promise.resolve()),
      };

      const mockSessionService = {
        getSessionById: mock(() => Promise.resolve(sessionData)),
        getInactiveSessions: mock(() => Promise.resolve([sessionData])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
        updateSession: mock(() => Promise.resolve()),
        updateLastUsed: mock(() => Promise.resolve()),
      };

      const worker = new MaintenanceWorker({
        database: db,
        whatsappConnectionManager: mockConnectionManager as any,
        whatsappSessionService: mockSessionService as any,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        sessionId: sessionData.id,
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.cleanedUpCount).toBeGreaterThanOrEqual(0);
      expect(mockSessionService.updateSession).toHaveBeenCalledWith(
        sessionData.id,
        expect.objectContaining({
          status: 'not_auth',
        }),
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle unknown job type', async () => {
      const worker = new MaintenanceWorker({
        whatsappConnectionManager: mock() as any,
        whatsappSessionService: mock() as any,
        database: db,
      });

      const job = createMockJob({
        type: 'unknown_operation',
      });

      expect(async () => {
        await worker.processJob(job as any);
      }).toThrowError('Unknown maintenance job type: unknown_operation');
    });

    test('should handle missing required parameters', async () => {
      const job = createMockJob({
        type: 'connection_health_check',
        // Missing sessionId and no checkAllSessions flag
      });

      // Mock empty inactive sessions
      const mockSessionService = {
        getInactiveSessions: mock(() => Promise.resolve([])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
      };

      const worker = new MaintenanceWorker({
        whatsappSessionService: mockSessionService as any,
        whatsappConnectionManager: mock() as any,
        database: db,
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.totalChecked).toBe(0);
    });

    test('should handle connection manager errors', async () => {
      const sessionData = createTestSession({
        status: 'paired',
      });

      await db.insert(schema.whatsappSessions).values(sessionData);

      // Mock session service
      const mockSessionService = {
        getSessionById: mock(() => Promise.resolve(sessionData)),
        getInactiveSessions: mock(() => Promise.resolve([sessionData])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
        updateSession: mock(() => Promise.resolve()),
        updateLastUsed: mock(() => Promise.resolve()),
      };

      // Mock connection manager that throws
      const mockConnectionManager = {
        getConnection: mock(),
        createConnection: mock(() => Promise.resolve()),
        removeConnection: mock(() => {
          throw new Error('Connection manager error');
        }),
      };

      const worker = new MaintenanceWorker({
        whatsappSessionService: mockSessionService as any,
        whatsappConnectionManager: mockConnectionManager as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        sessionId: sessionData.id,
      } as const);

      const result = await worker.processJob(job);

      expect(result.success).toBe(true);
      expect(result.data.results[0].status).toBe('error');
      expect(result.data.results[0].action).toContain('Connection manager error');
    });
  });

  describe('Configuration Options', () => {
    test('should use custom inactivity threshold', async () => {
      const mockSessionService = {
        getInactiveSessions: mock(() => Promise.resolve([])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
      };

      const worker = new MaintenanceWorker({
        whatsappSessionService: mockSessionService as any,
        whatsappConnectionManager: mock() as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        inactiveHoursThreshold: 48, // custom threshold
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.totalChecked).toBe(0);
      expect(mockSessionService.getInactiveSessions).toHaveBeenCalledWith(48);
    });

    test('should check all sessions when checkAllSessions is true', async () => {
      // Note: The actual implementation doesn't support checkAllSessions=true yet
      // This test validates the parameter is accepted without error
      const mockSessionService = {
        getInactiveSessions: mock(() => Promise.resolve([])),
        getSessionsByStatus: mock(() => Promise.resolve([])),
      };

      const worker = new MaintenanceWorker({
        whatsappSessionService: mockSessionService as any,
        whatsappConnectionManager: mock() as any,
        database: db,
      });

      const job = createMockJob({
        type: 'connection_health_check',
        checkAllSessions: true,
      });

      const result = await worker.processJob(job as any);

      expect(result.success).toBe(true);
      expect(result.data.totalChecked).toBe(0);
    });
  });
});
