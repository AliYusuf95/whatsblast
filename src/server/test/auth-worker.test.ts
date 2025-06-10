// Auth Worker Unit Tests
// Tests authentication workflow processing, QR generation, pairing verification, and session management

import { test, expect, describe, beforeEach, afterEach, mock } from 'bun:test';
import { QUEUE_NAMES } from '../queue/config';
import type {
  QRGenerationJobData,
  PairingJobData,
  AuthValidationJobData,
  LogoutJobData,
} from '../queue/job-types';
import { createTestSession, createMockJob, initTestDatabase, testUtils } from './setup';
import { AuthWorker, type AuthWorkerDependencies } from '../workers/auth-worker';
import { useDatabaseAuthState } from '../services';

describe('AuthWorker', () => {
  let authWorker: AuthWorker;
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;
  let schema: Awaited<ReturnType<typeof initTestDatabase>>['schema'];
  let mockDeps = {
    connectionManager: {
      getConnection: mock(),
      createConnection: mock(() =>
        Promise.resolve({
          isConnected: () => true,
          getConnectionState: () => 'open',
        }),
      ),
      removeConnection: mock(() => Promise.resolve()),
    },
    sessionService: {
      getSessionById: mock(() => Promise.resolve(null)),
      updateSession: mock(() => Promise.resolve()),
    },
    database: {} as any, // Placeholder for database mock
  };

  beforeEach(async () => {
    // Setup isolated test database
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;
    schema = dbSetup.schema;

    // Create fresh mock dependencies for each test
    mockDeps = {
      connectionManager: {
        getConnection: mock(() => null),
        createConnection: mock(() =>
          Promise.resolve({
            isConnected: () => true,
            getConnectionState: () => 'open',
          }),
        ),
        removeConnection: mock(() => Promise.resolve()),
      } as any,
      sessionService: {
        getSessionById: mock(() => Promise.resolve(null)),
        updateSession: mock(() => Promise.resolve()),
      } as any,
      database: db,
    };

    // Create AuthWorker with mock dependencies
    authWorker = new AuthWorker(mockDeps as unknown as AuthWorkerDependencies);
  });

  afterEach(async () => {
    cleanupDb();
  });

  describe('QR Generation', () => {
    test('should handle QR generation for new session', async () => {
      const sessionId = 'test-session-1';
      const userId = 'test-user-1';

      const jobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId,
        userId,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const testSession = createTestSession({
        id: sessionId,
        userId,
        status: 'not_auth',
      });

      // Mock session retrieval
      mockDeps.sessionService.getSessionById
        .mockResolvedValueOnce(testSession as any)
        .mockResolvedValueOnce({
          ...testSession,
          qrCode: 'mock-qr-code',
        } as any);

      // Mock connection creation
      mockDeps.connectionManager.getConnection.mockReturnValue(null);
      mockDeps.connectionManager.createConnection.mockResolvedValue({
        isConnected: () => true,
        getConnectionState: () => 'open',
      });

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ qrCode: 'mock-qr-code' });
      expect(result.qrCode).toBe('mock-qr-code');
      expect(result.authState).toBe('unauthenticated');
      expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
    });

    test('should return success if session already paired', async () => {
      const sessionId = 'test-session-2';
      const userId = 'test-user-2';

      const jobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId,
        userId,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const testSession = createTestSession({
        id: sessionId,
        userId,
        status: 'paired',
      });

      mockDeps.sessionService.getSessionById.mockResolvedValue(testSession as any);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'Session already paired' });
      expect(result.authState).toBe('authenticated');
    });

    test('should handle session not found error', async () => {
      const sessionId = 'non-existent-session';
      const userId = 'test-user-4';

      const jobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId,
        userId,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      mockDeps.sessionService.getSessionById.mockResolvedValue(null);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Session ${sessionId} not found`);
    });
  });

  describe('Pairing Verification', () => {
    test('should handle successful pairing verification', async () => {
      const sessionId = 'test-session-6';
      const userId = 'test-user-6';

      const jobData: PairingJobData = {
        type: 'pairing_verification',
        sessionId,
        userId,
        pairingCode: '123456',
        phoneNumber: '+1234567890',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const testSession = createTestSession({
        id: sessionId,
        userId,
        status: 'not_auth',
      });

      const pairedSession = {
        ...testSession,
        status: 'paired' as const,
        phone: '+1234567890',
        name: 'Test User',
      };

      mockDeps.sessionService.getSessionById
        .mockResolvedValueOnce(testSession as any)
        .mockResolvedValueOnce(pairedSession as any)
        .mockResolvedValueOnce(pairedSession as any);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        message: 'Session paired successfully',
        phone: '+1234567890',
        name: 'Test User',
      });
      expect(result.authState).toBe('authenticated');
      expect(result.phoneNumber).toBe('+1234567890');
    });

    test('should return success if session already paired', async () => {
      const sessionId = 'test-session-7';
      const userId = 'test-user-7';

      const jobData: PairingJobData = {
        type: 'pairing_verification',
        sessionId,
        userId,
        pairingCode: '123456',
        phoneNumber: '+1234567890',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const testSession = createTestSession({
        id: sessionId,
        userId,
        status: 'paired',
        phone: '+1234567890',
      });

      mockDeps.sessionService.getSessionById.mockResolvedValue(testSession as any);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'Session already paired' });
      expect(result.authState).toBe('authenticated');
      expect(result.phoneNumber).toBe('+1234567890');
    });
  });

  describe('Auth Validation', () => {
    test('should validate authenticated session', async () => {
      const sessionId = 'test-session-10';
      const userId = 'test-user-10';

      const jobData: AuthValidationJobData = {
        type: 'auth_validation',
        sessionId,
        userId,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const testSession = createTestSession({
        id: sessionId,
        userId,
        status: 'paired',
        phone: '+1234567890',
      });

      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
      };

      await (await useDatabaseAuthState(sessionId, db)).saveCreds();

      mockDeps.sessionService.getSessionById.mockResolvedValue(testSession as any);
      mockDeps.connectionManager.getConnection.mockReturnValue(mockConnection);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        isValid: true,
        isConnected: true,
        sessionStatus: 'paired',
        connectionState: 'open',
      });
      expect(result.authState).toBe('authenticated');
      expect(result.phoneNumber).toBe('+1234567890');
    });

    test('should validate unauthenticated session', async () => {
      const sessionId = 'test-session-11';
      const userId = 'test-user-11';

      const jobData: AuthValidationJobData = {
        type: 'auth_validation',
        sessionId,
        userId,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const testSession = createTestSession({
        id: sessionId,
        userId,
        status: 'not_auth',
      });

      mockDeps.sessionService.getSessionById.mockResolvedValue(testSession as any);
      mockDeps.connectionManager.getConnection.mockReturnValue(null);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        isValid: false,
        isConnected: false,
        sessionStatus: 'not_auth',
        connectionState: undefined,
      });
      expect(result.authState).toBe('unauthenticated');
    });
  });

  describe('Logout', () => {
    test('should handle successful logout with connection', async () => {
      const sessionId = 'test-session-13';
      const userId = 'test-user-13';

      const jobData: LogoutJobData = {
        type: 'logout',
        sessionId,
        userId,
        reason: 'User requested logout',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
      };

      mockDeps.connectionManager.getConnection.mockReturnValue(mockConnection);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        message: 'Session logged out successfully',
        reason: 'User requested logout',
      });
      expect(result.authState).toBe('unauthenticated');
      expect(mockDeps.connectionManager.removeConnection).toHaveBeenCalledWith(sessionId);
      expect(mockDeps.sessionService.updateSession).toHaveBeenCalledWith(sessionId, {
        status: 'not_auth',
        phone: undefined,
        name: undefined,
        qrCode: null,
        qrExpiresAt: null,
      });
    });

    test('should handle logout without connection', async () => {
      const sessionId = 'test-session-14';
      const userId = 'test-user-14';

      const jobData: LogoutJobData = {
        type: 'logout',
        sessionId,
        userId,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      mockDeps.connectionManager.getConnection.mockReturnValue(null);

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        message: 'Session logged out successfully',
        reason: 'Manual logout',
      });
      expect(result.authState).toBe('unauthenticated');
      expect(mockDeps.connectionManager.removeConnection).not.toHaveBeenCalled();
    });
  });

  describe('Job Validation and Error Handling', () => {
    test('should handle unknown job type', async () => {
      const jobData = {
        type: 'unknown_type',
        sessionId: 'test-session-16',
        userId: 'test-user-16',
        timestamp: Date.now(),
      } as any;

      const mockJob = createMockJob(jobData);

      try {
        await authWorker.processJob(mockJob);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Unknown auth job type: unknown_type');
      }
    });

    test('should create proper error results', async () => {
      const error = new Error('Test error message');
      const result = authWorker.createErrorResult(error);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error message');
      expect(typeof result.timestamp).toBe('number');
    });
  });
});
