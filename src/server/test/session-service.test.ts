/**
 * Unit Tests for WhatsApp Session Service
 *
 * Tests session CRUD operations, state management, and lifecycle
 * Covers session creation, status transitions, and data integrity
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { WhatsAppSessionService } from '../services/whatsapp/session-service';
import { initTestDatabase, createTestSession } from './setup';
import { whatsappSessions } from '../db/schema';

describe('WhatsAppSessionService', () => {
  let testDb: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;
  let sessionService: WhatsAppSessionService;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    testDb = dbSetup.db;
    cleanupDb = dbSetup.cleanup;
    sessionService = new WhatsAppSessionService(testDb);
  });

  afterEach(() => {
    cleanupDb();
  });

  describe('createSession', () => {
    test('should create a new session with default status', async () => {
      const sessionData = {
        userId: 'test-user-123',
        description: 'Test Session',
      };

      const session = await sessionService.createSession(sessionData);

      expect(session.id).toBeDefined();
      expect(session.userId).toBe(sessionData.userId);
      expect(session.description).toBe(sessionData.description);
      expect(session.status).toBe('not_auth');
      expect(session.phone).toBeNull();
      expect(session.qrCode).toBeNull();
      expect(session.lastUsedAt).toBeDefined();
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    test('should create session successfully', async () => {
      const sessionData = {
        userId: 'test-user-123',
        description: 'Test Session with description',
      };

      const session = await sessionService.createSession(sessionData);

      expect(session.description).toBe(sessionData.description);
      expect(session.status).toBe('not_auth');
    });
  });

  describe('getSessionById', () => {
    test('should retrieve existing session by ID', async () => {
      const testSession = createTestSession();
      await testDb.insert(whatsappSessions).values(testSession);

      const session = await sessionService.getSessionById(testSession.id);

      expect(session).toBeDefined();
      expect(session?.id).toBe(testSession.id);
      expect(session?.userId).toBe(testSession.userId);
      expect(session?.description).toBe(testSession.description);
    });

    test('should return null for non-existent session', async () => {
      const session = await sessionService.getSessionById('non-existent-id');
      expect(session).toBeNull();
    });
  });

  describe('getSessionsByUserId', () => {
    test('should retrieve all sessions for a user', async () => {
      const userId = 'test-user-123';
      const session1 = createTestSession({ userId, description: 'Session 1' });
      const session2 = createTestSession({ userId, description: 'Session 2' });
      const otherUserSession = createTestSession({
        userId: 'other-user',
        description: 'Other Session',
      });

      await testDb.insert(whatsappSessions).values([session1, session2, otherUserSession]);

      const sessions = await sessionService.getSessionsByUserId(userId);

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.description)).toContain('Session 1');
      expect(sessions.map((s) => s.description)).toContain('Session 2');
      expect(sessions.map((s) => s.description)).not.toContain('Other Session');
    });

    test('should return empty array for user with no sessions', async () => {
      const sessions = await sessionService.getSessionsByUserId('no-sessions-user');
      expect(sessions).toHaveLength(0);
    });
  });

  describe('getSessionsByStatus', () => {
    test('should retrieve sessions by status', async () => {
      const pairedSession = createTestSession({ status: 'paired' });
      const qrSession = createTestSession({ status: 'qr_pairing' });
      const notAuthSession = createTestSession({ status: 'not_auth' });

      await testDb.insert(whatsappSessions).values([pairedSession, qrSession, notAuthSession]);

      const pairedSessions = await sessionService.getSessionsByStatus('paired');
      const qrSessions = await sessionService.getSessionsByStatus('qr_pairing');

      expect(pairedSessions).toHaveLength(1);
      expect(pairedSessions[0].id).toBe(pairedSession.id);

      expect(qrSessions).toHaveLength(1);
      expect(qrSessions[0].id).toBe(qrSession.id);
    });

    test('should return empty array for status with no sessions', async () => {
      const sessions = await sessionService.getSessionsByStatus('paired');
      expect(sessions).toHaveLength(0);
    });
  });

  describe('updateSession', () => {
    test('should update session status', async () => {
      const testSession = createTestSession();
      await testDb.insert(whatsappSessions).values(testSession);

      const updatedSession = await sessionService.updateSession(testSession.id, {
        status: 'qr_pairing',
      });

      expect(updatedSession).toBeDefined();
      expect(updatedSession?.status).toBe('qr_pairing');
      expect(updatedSession?.updatedAt).toBeDefined();
    });

    test('should update session phone and name', async () => {
      const testSession = createTestSession();
      await testDb.insert(whatsappSessions).values(testSession);

      const phone = '+1234567890';
      const name = 'Test User';

      const updatedSession = await sessionService.updateSession(testSession.id, {
        phone,
        name,
        status: 'paired',
      });

      expect(updatedSession?.phone).toBe(phone);
      expect(updatedSession?.name).toBe(name);
      expect(updatedSession?.status).toBe('paired');
    });

    test('should return null for non-existent session', async () => {
      const result = await sessionService.updateSession('non-existent', {
        status: 'paired',
      });

      expect(result).toBeNull();
    });
  });

  describe('setQRCode', () => {
    test('should set QR code and update status', async () => {
      const testSession = await sessionService.createSession(createTestSession());

      const qrCode = 'test-qr-code';
      // Use a time rounded to seconds to avoid SQLite precision issues
      const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 30000);

      await sessionService.setQRCode(testSession.id, qrCode, expiresAt);

      const updatedSession = await sessionService.getSessionById(testSession.id);
      expect(updatedSession?.qrCode).toBe(qrCode);
      expect(updatedSession?.status).toBe('qr_pairing');
      expect(updatedSession?.qrExpiresAt?.getTime()).toBe(expiresAt.getTime());
    });

    test('should handle error for non-existent session', async () => {
      const qrCode = 'test-qr-code';
      const expiresAt = new Date();

      await expect(async () => {
        await sessionService.setQRCode('non-existent', qrCode, expiresAt);
      }).toThrow();
    });
  });

  describe('clearQRCode', () => {
    test('should clear QR code', async () => {
      const testSession = createTestSession({
        qrCode: 'existing-qr',
        qrExpiresAt: new Date(),
      });
      await testDb.insert(whatsappSessions).values(testSession);

      await sessionService.clearQRCode(testSession.id);

      const updatedSession = await sessionService.getSessionById(testSession.id);
      expect(updatedSession?.qrCode).toBeNull();
      expect(updatedSession?.qrExpiresAt).toBeNull();
    });
  });

  describe('markAsPaired', () => {
    test('should mark session as paired with phone and name', async () => {
      const testSession = createTestSession({ status: 'qr_pairing' });
      await testDb.insert(whatsappSessions).values(testSession);

      const phone = '+1234567890';
      const name = 'Test User';

      await sessionService.markAsPaired(testSession.id, phone, name);

      const updatedSession = await sessionService.getSessionById(testSession.id);
      expect(updatedSession?.status).toBe('paired');
      expect(updatedSession?.phone).toBe(phone);
      expect(updatedSession?.name).toBe(name);
      expect(updatedSession?.qrCode).toBeNull();
      expect(updatedSession?.qrExpiresAt).toBeNull();
    });
  });

  describe('updateLastUsed', () => {
    test('should update last used timestamp', async () => {
      const testSession = createTestSession();
      await testDb.insert(whatsappSessions).values(testSession);

      const originalLastUsed = testSession.lastUsedAt;

      // Wait a moment to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await sessionService.updateLastUsed(testSession.id);

      const updatedSession = await sessionService.getSessionById(testSession.id);
      expect(updatedSession?.lastUsedAt).toBeDefined();
      if (originalLastUsed && updatedSession?.lastUsedAt) {
        expect(updatedSession.lastUsedAt.getTime()).toBeGreaterThan(originalLastUsed.getTime());
      }
    });

    test('should handle error for non-existent session gracefully', async () => {
      // Should not throw error
      await expect(async () => {
        await sessionService.updateLastUsed('non-existent');
      }).not.toThrow();
    });
  });

  describe('deleteSession', () => {
    test('should delete session', async () => {
      const testSession = createTestSession();
      await testDb.insert(whatsappSessions).values(testSession);

      const result = await sessionService.deleteSession(testSession.id);

      expect(result).toBe(true);

      const deletedSession = await sessionService.getSessionById(testSession.id);
      expect(deletedSession).toBeNull();
    });

    test('should handle deletion of non-existent session', async () => {
      const result = await sessionService.deleteSession('non-existent');
      expect(result).toBe(true); // Service returns true even for non-existent
    });
  });

  describe('getInactiveSessions', () => {
    test('should return sessions inactive for specified hours', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

      const activeSession = createTestSession({
        name: 'Active Session',
        status: 'paired',
        lastUsedAt: now,
      });
      const inactiveSession = createTestSession({
        name: 'Inactive Session',
        status: 'paired',
        lastUsedAt: twoHoursAgo,
      });
      const recentSession = createTestSession({
        name: 'Recent Session',
        status: 'paired',
        lastUsedAt: oneHourAgo,
      });

      await testDb.insert(whatsappSessions).values([activeSession, inactiveSession, recentSession]);

      const inactiveSessions = await sessionService.getInactiveSessions(1.5); // 1.5 hours

      expect(inactiveSessions).toHaveLength(1);
      expect(inactiveSessions[0].id).toBe(inactiveSession.id);
    });

    test('should return empty array when no inactive sessions', async () => {
      const now = new Date();
      const session1 = createTestSession({ status: 'paired', lastUsedAt: now });
      const session2 = createTestSession({
        status: 'paired',
        lastUsedAt: new Date(now.getTime() - 30000),
      });

      await testDb.insert(whatsappSessions).values([session1, session2]);

      const inactiveSessions = await sessionService.getInactiveSessions(1); // 1 hour

      expect(inactiveSessions).toHaveLength(0);
    });
  });

  describe('hasValidAuth', () => {
    test('should return false for non-paired session', async () => {
      const testSession = createTestSession({ status: 'not_auth' });
      await testDb.insert(whatsappSessions).values(testSession);

      const hasAuth = await sessionService.hasValidAuth(testSession.id);

      expect(hasAuth).toBe(false);
    });

    test('should return false for non-existent session', async () => {
      const hasAuth = await sessionService.hasValidAuth('non-existent');

      expect(hasAuth).toBe(false);
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete session lifecycle', async () => {
      // Create session
      const sessionData = {
        userId: 'lifecycle-user',
        description: 'Lifecycle Test Session',
      };

      const session = await sessionService.createSession(sessionData);
      expect(session.description).toBe(sessionData.description);

      // Retrieve session
      const retrieved = await sessionService.getSessionById(session.id);
      expect(retrieved?.id).toBe(session.id);

      // Update status and set QR
      const qrCode = 'test-qr-code';
      const expiresAt = new Date(Date.now() + 30000);
      await sessionService.setQRCode(session.id, qrCode, expiresAt);

      // Mark as paired
      const phone = '+1234567890';
      const name = 'Test User';
      await sessionService.markAsPaired(session.id, phone, name);

      // Update last used
      await sessionService.updateLastUsed(session.id);

      // Verify final state
      const finalSession = await sessionService.getSessionById(session.id);
      expect(finalSession?.status).toBe('paired');
      expect(finalSession?.phone).toBe(phone);
      expect(finalSession?.name).toBe(name);
      expect(finalSession?.qrCode).toBeNull();

      // Delete session
      await sessionService.deleteSession(session.id);
      const deletedSession = await sessionService.getSessionById(session.id);
      expect(deletedSession).toBeNull();
    });

    test('should handle edge cases', async () => {
      const sessionData = {
        userId: 'edge-case-user',
        description: 'A'.repeat(1000), // Very long description
      };

      const session = await sessionService.createSession(sessionData);
      expect(session.description).toBe(sessionData.description);
    });

    test('should handle empty description', async () => {
      const sessionData = {
        userId: 'empty-desc-user',
        description: '',
      };

      const session = await sessionService.createSession(sessionData);
      expect(session.description).toBe('');
    });

    test('should handle concurrent operations', async () => {
      const sessionData1 = {
        userId: 'concurrent-user',
        description: 'Session 1',
      };
      const sessionData2 = {
        userId: 'concurrent-user',
        description: 'Session 2',
      };

      const [session1, session2] = await Promise.all([
        sessionService.createSession(sessionData1),
        sessionService.createSession(sessionData2),
      ]);

      expect(session1.description).toBe(sessionData1.description);
      expect(session2.description).toBe(sessionData2.description);
      expect(session1.id).not.toBe(session2.id);

      // Concurrent updates
      await Promise.all([
        sessionService.updateSession(session1.id, { status: 'qr_pairing' }),
        sessionService.updateLastUsed(session2.id),
      ]);

      const finalSession1 = await sessionService.getSessionById(session1.id);
      const finalSession2 = await sessionService.getSessionById(session2.id);

      expect(finalSession1?.status).toBe('qr_pairing');
      expect(finalSession2?.lastUsedAt).toBeDefined();
    });
  });
});
