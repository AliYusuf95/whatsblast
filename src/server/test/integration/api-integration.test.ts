/**
 * API Integration Tests
 * Tests tRPC API routes with actual database operations and worker integration
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { initTestDatabase, createTestSession, testUtils, createTestBulkJob } from '../setup';
import { whatsappSessions, user, bulkJobs } from '@/server/db/schema';
import { sessionRouter } from '@/server/api/session-routes';
import { bulkRouter } from '@/server/api/bulk-routes';
import { createCallerFactory, type TrpcContext } from '@/server/trpc';
import { createId } from '@paralleldrive/cuid2';
import type { User } from '@/server/auth';

const _createCallerFactory = (ctx: TrpcContext) => ({
  sessionRouter: createCallerFactory(sessionRouter)(ctx),
  bulkRouter: createCallerFactory(bulkRouter)(ctx),
});

describe('API Integration Tests', () => {
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;
  let createCaller = _createCallerFactory;
  let mockUser: User;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;

    // Create test user
    mockUser = {
      id: 'test-user-' + createId(),
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: false,
      image: null,
    };

    await db.insert(user).values({
      id: mockUser.id,
      email: mockUser.email,
      name: mockUser.name,
      createdAt: mockUser.createdAt,
      updatedAt: mockUser.updatedAt,
      emailVerified: mockUser.emailVerified,
    });
  });

  afterEach(async () => {
    cleanupDb();
  });

  describe('Session API Integration', () => {
    test('should create session through API with database persistence', async () => {
      const caller = createCaller(testUtils.createAuthContext({ db, userId: mockUser.id }));

      const sessionData = {
        description: 'Integration Test Session',
      };

      const result = await caller.sessionRouter.createSession(sessionData);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBeDefined();
      expect(result.data?.userId).toBe(mockUser.id);
      expect(result.data?.description).toBe(sessionData.description);
      expect(result.data?.status).toBe('not_auth');

      // Verify in database
      const dbSession = await db.query.whatsappSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, result.data!.id),
      });

      expect(dbSession).toBeDefined();
      expect(dbSession?.userId).toBe(mockUser.id);
      expect(dbSession?.description).toBe(sessionData.description);
    });

    test('should retrieve user sessions through API', async () => {
      // Create test sessions
      const session1 = createTestSession({
        userId: mockUser.id,
        description: 'Session 1',
        status: 'paired',
      });
      const session2 = createTestSession({
        userId: mockUser.id,
        description: 'Session 2',
        status: 'not_auth',
      });

      await db.insert(whatsappSessions).values([session1, session2]);

      const caller = createCaller(
        testUtils.createAuthContext({ db, sessionId: session1.id, userId: mockUser.id }),
      );

      const result = await caller.sessionRouter.getSessions();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.map((s) => s.description)).toContain('Session 1');
      expect(result.data?.map((s) => s.description)).toContain('Session 2');
      expect(result.data?.every((s) => s.userId === mockUser.id)).toBe(true);
    });

    test('should handle session authorization correctly', async () => {
      // Create session for different user
      const otherUserSession = createTestSession({
        userId: 'other-user-id',
        description: 'Other User Session',
      });

      await db.insert(whatsappSessions).values(otherUserSession);

      const caller = createCaller(testUtils.createAuthContext({ db }));

      // Should not be able to access other user's session
      await expect(
        caller.sessionRouter.getSession({ sessionId: otherUserSession.id }),
      ).rejects.toThrow('Access denied');
    });

    test('should update session with validation', async () => {
      const session = createTestSession({
        userId: mockUser.id,
        description: 'Original Description',
      });

      await db.insert(whatsappSessions).values(session);

      const caller = createCaller(
        testUtils.createAuthContext({ db, userId: mockUser.id, sessionId: session.id }),
      );

      const updateData = {
        sessionId: session.id,
        description: 'Updated Description',
        status: 'paired' as const,
      };

      const result = await caller.sessionRouter.updateSession(updateData);

      console.log('Update result:', result);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(session.id);
      expect(result.data?.description).toBe('Updated Description');
      expect(result.data?.status).toBe('not_auth'); // this route does not change status

      // Verify in database
      const dbSession = await db.query.whatsappSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, session.id),
      });

      expect(dbSession?.description).toBe('Updated Description');
      expect(dbSession?.status).toBe('not_auth');
    });

    test('should delete session with cleanup', async () => {
      const session = createTestSession({
        userId: mockUser.id,
        description: 'To Delete',
      });

      await db.insert(whatsappSessions).values(session);

      const caller = createCaller(
        testUtils.createAuthContext({ db, userId: mockUser.id, sessionId: session.id }),
      );

      const result = await caller.sessionRouter.deleteSession({
        sessionId: session.id,
      });

      expect(result.success).toBe(true);

      // Verify deletion
      const dbSession = await db.query.whatsappSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, session.id),
      });

      expect(dbSession).toBeUndefined();
    });
  });

  describe('Bulk Messaging API Integration', () => {
    test('should create bulk job through API with validation', async () => {
      const session = createTestSession({
        userId: mockUser.id,
        status: 'paired',
        phone: '+1234567890',
      });

      await db.insert(whatsappSessions).values(session);

      const caller = createCaller(
        testUtils.createAuthContext({ db, userId: mockUser.id, sessionId: session.id }),
      );

      const bulkData = {
        sessionId: session.id,
        name: 'Test Bulk Job',
        template: ['Hello ', 0, '!'],
        recipients: [
          { phone: '+1111111111', data: ['John'] },
          { phone: '+2222222222', data: ['Jane'] },
        ],
        batchSize: 5,
        delay: 1000,
      };

      const result = await caller.bulkRouter.sendBulk(bulkData);

      expect(result.success).toBe(true);
      expect(result.data?.jobId).toBeDefined();
      expect(result.data?.totalMessages).toBe(2);
      expect(result.data?.status).toBe('processing');

      // Verify in database
      const dbJob = await db.query.bulkJobs.findFirst({
        where: (jobs, { eq }) => eq(jobs.id, result.data!.jobId),
      });

      expect(dbJob).toBeDefined();
      expect(dbJob?.userId).toBe(mockUser.id);
      expect(dbJob?.sessionId).toBe(session.id);
      expect(dbJob?.name).toBe('Test Bulk Job');
    });

    test('should validate session ownership in bulk operations', async () => {
      const otherUserSession = createTestSession({
        userId: 'other-user-id',
        status: 'paired',
      });

      await db.insert(whatsappSessions).values(otherUserSession);

      const caller = createCaller(testUtils.createAuthContext({ db, userId: mockUser.id }));

      const bulkData = {
        sessionId: otherUserSession.id,
        name: 'Unauthorized Job',
        template: ['Hello!'],
        recipients: [{ phone: '+1111111111', data: [] }],
      };

      await expect(caller.bulkRouter.sendBulk(bulkData)).rejects.toThrow('Access denied');
    });

    test('should retrieve bulk job progress', async () => {
      const session = createTestSession({
        userId: mockUser.id,
        status: 'paired',
      });

      await db.insert(whatsappSessions).values(session);

      // Create bulk job
      const bulkJob = createTestBulkJob({
        id: createId(),
        userId: mockUser.id,
        sessionId: session.id,
        name: 'Progress Test Job',
        status: 'processing' as const,
        totalMessages: 5,
        processedMessages: 0,
        failedMessages: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(bulkJobs).values(bulkJob);

      const caller = createCaller(testUtils.createAuthContext({ db, userId: mockUser.id }));

      const result = await caller.bulkRouter.getBulkProgress({
        jobId: bulkJob.id,
      });

      expect(result.success).toBe(true);
      expect(result.data?.job.id).toBe(bulkJob.id);
      expect(result.data?.job.status).toBe('processing');
      expect(result.data?.job.totalMessages).toBe(5);
      expect(result.data?.job.successfulMessages).toBe(0);
      expect(result.data?.job.failedMessages).toBe(0);
      expect(result.data?.job.processedMessages).toBe(0);
      expect(result.data?.progress.progress).toBe(0);
    });

    test('should handle message count limits', async () => {
      const session = createTestSession({
        userId: mockUser.id,
        status: 'paired',
      });

      await db.insert(whatsappSessions).values(session);

      const caller = createCaller(
        testUtils.createAuthContext({ db, userId: mockUser.id, sessionId: session.id }),
      );

      // Test with many recipients (the system should handle this gracefully)
      const manyRecipients = Array.from({ length: 1001 }, (_, i) => ({
        phone: `+123456789${i.toString().padStart(3, '0')}`,
        data: [`User${i}`],
      }));

      const bulkData = {
        sessionId: session.id,
        name: 'Large Job',
        template: ['Hello ', 0, '!'],
        recipients: manyRecipients,
      };

      // The system should handle this (either succeed or fail gracefully)
      const result = await caller.bulkRouter.sendBulk(bulkData);
      expect(result.success).toBe(true);
      expect(result.data?.totalMessages).toBe(1001);
    });
  });

  describe('Authentication Integration', () => {
    test('should reject unauthenticated requests', async () => {
      const caller = createCaller(testUtils.createContext());

      await expect(caller.sessionRouter.getSessions()).rejects.toThrow('Authentication required');
    });

    test('should handle invalid session in context', async () => {
      const caller = createCaller(testUtils.createAuthContext({ db }));

      const result = await caller.sessionRouter.getSessions();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0); // No sessions for non-existent user
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle database errors gracefully', async () => {
      const caller = createCaller(testUtils.createAuthContext({ db }));

      // Close database to simulate error
      cleanupDb();

      await expect(caller.sessionRouter.getSessions()).rejects.toThrow();
    });

    test('should validate input parameters', async () => {
      const caller = createCaller(testUtils.createAuthContext({ db }));

      // Test invalid session ID format
      await expect(caller.sessionRouter.getSession({ sessionId: '' })).rejects.toThrow(
        'Invalid cuid2',
      );

      // Test invalid bulk job data
      await expect(
        caller.bulkRouter.sendBulk({
          sessionId: 'invalid-session',
          name: '', // Empty name
          template: [],
          recipients: [],
        }),
      ).rejects.toThrow(
        '[\n  {\n    \"origin\": \"string\",\n    \"code\": \"invalid_format\",\n    \"format\": \"cuid2\",\n    \"pattern\": \"/^[0-9a-z]+$/\",\n    \"path\": [\n      \"sessionId\"\n    ],\n    \"message\": \"Invalid cuid2\"\n  },\n  {\n    \"origin\": \"string\",\n    \"code\": \"too_small\",\n    \"minimum\": 1,\n    \"path\": [\n      \"name\"\n    ],\n    \"message\": \"Too small: expected string to have >1 characters\"\n  },\n  {\n    \"origin\": \"array\",\n    \"code\": \"too_small\",\n    \"minimum\": 1,\n    \"path\": [\n      \"recipients\"\n    ],\n    \"message\": \"Too small: expected array to have >1 items\"\n  }\n]',
      );
    });
  });
});
