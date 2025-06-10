/**
 * Complete Auth Flow Integration Tests
 * Tests the full authentication workflow from session creation to pairing completion
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initTestDatabase, createTestSession, testUtils } from '../setup';
import { whatsappSessions, user } from '../../db/schema';
import { AuthWorker } from '../../workers/auth-worker';
import type { WhatsAppSessionService, WhatsAppConnectionManager } from '../../services';
import { useDatabaseAuthState, hasValidAuth } from '../../services/whatsapp/auth-state';
import type {
  QRGenerationJobData,
  PairingJobData,
  AuthValidationJobData,
} from '../../queue/job-types';
import { createId } from '@paralleldrive/cuid2';

describe('Complete Auth Flow Integration', () => {
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;
  let authWorker: AuthWorker;
  let sessionService: WhatsAppSessionService;
  let connectionManager: WhatsAppConnectionManager;
  let testUserId: string;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;

    testUserId = 'test-user-' + createId();

    // Create test user
    await db.insert(user).values({
      id: testUserId,
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: false,
    });

    const { whatsappConnectionManager, whatsappSessionService } = testUtils.mockServices({ db });

    // Initialize services
    sessionService = whatsappSessionService;
    connectionManager = whatsappConnectionManager;

    // Create AuthWorker with real dependencies
    authWorker = new AuthWorker({
      connectionManager,
      sessionService,
      database: db,
    });
  });

  afterEach(async () => {
    await authWorker.stop();
    cleanupDb();
  });

  describe('Complete Authentication Workflow', () => {
    test('should complete full auth flow: create → QR → pair → validate', async () => {
      // Step 1: Create session
      const sessionData = await sessionService.createSession({
        userId: testUserId,
        description: 'Integration Test Session',
      });

      expect(sessionData.status).toBe('not_auth');
      expect(sessionData.userId).toBe(testUserId);
      expect(sessionData.status).toBe('not_auth');

      const d = await sessionService.getSessionById(sessionData.id);

      // Step 2: Generate QR code
      const qrJobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId: sessionData.id,
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockQRJob = {
        id: 'qr-job-1',
        data: qrJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      (connectionManager.getConnection as any) = mock(() => ({
        isConnected: () => true,
        getConnectionState: () => 'open',
      })); // Ensure there is an existing connection

      await sessionService.setQRCode(sessionData.id, 'test-qr-code', new Date(Date.now() + 300000));

      const qrResult = await authWorker.processJob(mockQRJob);

      expect(qrResult.success).toBe(true);
      expect(qrResult.authState).toBe('unauthenticated');
      expect(qrResult.qrCode).toBeDefined();

      // Verify session updated
      const sessionAfterQR = await sessionService.getSessionById(sessionData.id);
      expect(sessionAfterQR?.status).toBe('qr_pairing');
      expect(sessionAfterQR?.qrCode).toBeDefined();

      // Step 3: Simulate pairing
      const pairingJobData: PairingJobData = {
        type: 'pairing_verification',
        sessionId: sessionData.id,
        userId: testUserId,
        pairingCode: '123456',
        phoneNumber: '+1234567890',
        timestamp: Date.now(),
      };

      const mockPairingJob = {
        id: 'pairing-job-1',
        data: pairingJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock successful pairing by updating session status
      await sessionService.markAsPaired(sessionData.id, '+1234567890', 'Test User');

      const pairingResult = await authWorker.processJob(mockPairingJob);

      expect(pairingResult.success).toBe(true);
      expect(pairingResult.authState).toBe('authenticated');
      expect(pairingResult.phoneNumber).toBe('+1234567890');

      // Verify session paired
      const sessionAfterPairing = await sessionService.getSessionById(sessionData.id);
      expect(sessionAfterPairing?.status).toBe('paired');
      expect(sessionAfterPairing?.phone).toBe('+1234567890');
      expect(sessionAfterPairing?.name).toBe('Test User');

      // Step 4: Validate authentication
      const validationJobData: AuthValidationJobData = {
        type: 'auth_validation',
        sessionId: sessionData.id,
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockValidationJob = {
        id: 'validation-job-1',
        data: validationJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Create valid auth state
      const authState = await useDatabaseAuthState(sessionData.id, db);
      await authState.saveCreds();

      const validationResult = await authWorker.processJob(mockValidationJob);

      expect(validationResult.success).toBe(true);
      expect(validationResult.authState).toBe('authenticated');
      expect(validationResult.data?.isValid).toBe(true);
      expect(validationResult.data?.sessionStatus).toBe('paired');
      expect(validationResult.data?.connectionState).toBe('open');
    });

    test('should handle auth flow with existing paired session', async () => {
      // Create already paired session
      const existingSession = createTestSession({
        userId: testUserId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Existing User',
      });

      await db.insert(whatsappSessions).values(existingSession);

      // Try to generate QR for already paired session
      const qrJobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId: existingSession.id,
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockQRJob = {
        id: 'qr-job-2',
        data: qrJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const qrResult = await authWorker.processJob(mockQRJob);

      expect(qrResult.success).toBe(true);
      expect(qrResult.authState).toBe('authenticated');
      expect(qrResult.data?.message).toBe('Session already paired');
    });

    test('should handle auth flow errors gracefully', async () => {
      // Test with non-existent session
      const invalidJobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId: 'non-existent-session',
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'invalid-job-1',
        data: invalidJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const result = await authWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session non-existent-session not found');
    });
  });

  describe('Auth State Persistence Integration', () => {
    test('should persist auth state throughout workflow', async () => {
      const sessionData = await sessionService.createSession({
        userId: testUserId,
        description: 'Auth State Test',
      });

      // Initially no auth state
      const initialAuth = await hasValidAuth(sessionData.id, db);
      expect(initialAuth).toBe(false);

      // Create auth state during pairing simulation
      const authState = await useDatabaseAuthState(sessionData.id, db);
      await authState.saveCreds();

      // Save some keys
      await authState.state.keys.set({
        'pre-key': {
          '1': {
            public: testUtils.stringToUint8Array('public-key-1'),
            private: testUtils.stringToUint8Array('private-key-1'),
          },
        },
      });

      // Verify auth state persisted
      const persistedAuth = await hasValidAuth(sessionData.id, db);
      expect(persistedAuth).toBe(true);

      // Verify keys persisted
      const newAuthState = await useDatabaseAuthState(sessionData.id, db);
      const retrievedKeys = await newAuthState.state.keys.get('pre-key', ['1']);
      expect(retrievedKeys['1']).toBeDefined();
      expect(testUtils.uint8ArrayToString(retrievedKeys['1'].private)).toBe('private-key-1');
      expect(testUtils.uint8ArrayToString(retrievedKeys['1'].public)).toBe('public-key-1');

      // Test auth state after session marked as paired
      await sessionService.markAsPaired(sessionData.id, '+1234567890', 'Test User');

      const finalAuth = await hasValidAuth(sessionData.id, db);
      expect(finalAuth).toBe(true);
    });

    test('should clean up auth state when session deleted', async () => {
      const sessionData = await sessionService.createSession({
        userId: testUserId,
        description: 'Cleanup Test',
      });

      // Create auth state
      const authState = await useDatabaseAuthState(sessionData.id, db);
      await authState.saveCreds();

      // Verify auth state exists
      const authRecords = await db.query.authStates.findMany({
        where: (auth, { eq }) => eq(auth.sessionId, sessionData.id),
      });
      expect(authRecords.length).toBeGreaterThan(0);

      // Delete session (should clean up auth state)
      await sessionService.deleteSession(sessionData.id);

      // Verify auth state cleaned up
      const remainingAuthRecords = await db.query.authStates.findMany({
        where: (auth, { eq }) => eq(auth.sessionId, sessionData.id),
      });
      expect(remainingAuthRecords.length).toBe(0);
    });
  });

  describe('Connection Manager Integration', () => {
    test('should integrate connection manager with auth workflow', async () => {
      const sessionData = await sessionService.createSession({
        userId: testUserId,
        description: 'Connection Test',
      });

      // Initially no connection
      const initialConnection = connectionManager.getConnection(sessionData.id);
      expect(initialConnection).toBeUndefined();

      // Simulate QR generation creating connection
      const qrJobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId: sessionData.id,
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockQRJob = {
        id: 'connection-qr-job',
        data: qrJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock connection creation during QR generation
      (connectionManager.createConnection as any) = mock(async () => {
        (connectionManager.getConnection as any) = mock(() => ({}));
        await sessionService.setQRCode(
          sessionData.id,
          'test-qr-code',
          new Date(Date.now() + 300000),
        );
      });

      await authWorker.processJob(mockQRJob);

      // Should have created connection during QR generation
      const connectionAfterQR = connectionManager.getConnection(sessionData.id);
      expect(connectionAfterQR).toBeDefined();
    });

    test('should handle connection lifecycle during auth flow', async () => {
      const sessionData = await sessionService.createSession({
        userId: testUserId,
        description: 'Lifecycle Test',
      });

      // Test that connection can be created without actual connection attempt
      expect(sessionData.id).toBeDefined();
      expect(sessionData.userId).toBe(testUserId);
      expect(sessionData.status).toBe('not_auth');

      // Mock connection manager to simulate a disconnected connection
      (connectionManager.getConnection as any) = mock(() => ({
        isConnected: () => false,
        getConnectionState: () => 'disconnected',
      }));

      // Test connection state during validation (without creating actual connection)
      const validationJobData: AuthValidationJobData = {
        type: 'auth_validation',
        sessionId: sessionData.id,
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockValidationJob = {
        id: 'lifecycle-validation-job',
        data: validationJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const validationResult = await authWorker.processJob(mockValidationJob);

      expect(validationResult.success).toBe(true);
      expect(validationResult.data?.connectionState).toBe('disconnected');
    });
  });

  describe('Error Recovery Integration', () => {
    test('should recover from partial auth failures', async () => {
      const sessionData = await sessionService.createSession({
        userId: testUserId,
        description: 'Recovery Test',
      });

      // Simulate partial failure - QR generated but pairing fails
      await sessionService.setQRCode(sessionData.id, 'test-qr-code', new Date(Date.now() + 300000));

      const sessionAfterQR = await sessionService.getSessionById(sessionData.id);
      expect(sessionAfterQR?.status).toBe('qr_pairing');

      // Simulate pairing failure - reset to not_auth
      await sessionService.updateSession(sessionData.id, {
        status: 'not_auth',
        qrCode: null,
        qrExpiresAt: null,
      });

      // Verify recovery possible
      const recoveredSession = await sessionService.getSessionById(sessionData.id);
      expect(recoveredSession?.status).toBe('not_auth');
      expect(recoveredSession?.qrCode).toBeNull();

      // Should be able to restart auth flow
      const newQRJobData: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId: sessionData.id,
        userId: testUserId,
        timestamp: Date.now(),
      };

      const mockNewQRJob = {
        id: 'recovery-qr-job',
        data: newQRJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock connection creation again
      (connectionManager.createConnection as any) = mock(async () => {
        (connectionManager.getConnection as any) = mock(() => ({}));
        await sessionService.setQRCode(
          sessionData.id,
          'recovered-qr-code',
          new Date(Date.now() + 300000),
        );
      });

      const recoveryResult = await authWorker.processJob(mockNewQRJob);

      expect(recoveryResult.success).toBe(true);
      expect(recoveryResult.qrCode).toBeDefined();
    });
  });
});
