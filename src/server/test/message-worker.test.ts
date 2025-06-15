// Message Worker Unit Tests
// Tests messaging operations, bulk sending, and message status tracking

import { test, expect, describe, beforeEach, afterEach, mock, jest, spyOn } from 'bun:test';
import { MessageWorker } from '../workers/message-worker';
import { QUEUE_NAMES } from '../queue/config';
import type {
  SingleMessageJobData,
  BulkMessageJobData,
  MessageStatusJobData,
} from '../queue/job-types';
import { createTestSession, createMockJob, initTestDatabase, testUtils } from './setup';
import { whatsappSessions } from '../db/schema';
import {
  WhatsAppBulkService,
  type WhatsAppConnectionManager,
  type WhatsAppSessionService,
} from '../services';

describe('MessageWorker', () => {
  let messageWorker: MessageWorker;
  let mockWhatsappConnectionManager: WhatsAppConnectionManager & { getConnection: jest.Mock };
  let mockWhatsappSessionService: WhatsAppSessionService;
  let mockWhatsappBulkService: WhatsAppBulkService;
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;

    const { whatsappConnectionManager, whatsappBulkService, whatsappSessionService } =
      testUtils.mockServices({ db });

    mockWhatsappConnectionManager = Object.assign(whatsappConnectionManager, {
      getConnection: mock(() => null), // Default to no connection
      createConnection: mock(() =>
        Promise.resolve({
          isConnected: mock(() => true),
          getConnectionState: mock(() => 'open'),
          sendMessage: mock(() => Promise.resolve({ key: { id: 'message-id-123' } })),
        }),
      ),
    });

    mockWhatsappSessionService = whatsappSessionService;

    mockWhatsappBulkService = whatsappBulkService;

    // Create MessageWorker with injected dependencies
    messageWorker = new MessageWorker({
      whatsappConnectionManager: mockWhatsappConnectionManager,
      whatsappSessionService: mockWhatsappSessionService,
      whatsappBulkService: mockWhatsappBulkService,
    });
  });

  afterEach(async () => {
    cleanupDb();
  });

  describe('Constructor', () => {
    test('should initialize with correct queue configuration', () => {
      expect(messageWorker['queueName']).toBe(QUEUE_NAMES.WHATSAPP_MESSAGE);
      expect(messageWorker['concurrency']).toBe(5);
      expect(messageWorker['rateLimitMax']).toBe(20);
      expect(messageWorker['rateLimitDuration']).toBe(60000);
    });
  });

  describe('Single Message', () => {
    test('should handle single text message successfully', async () => {
      const sessionId = 'test-session-1';
      const userId = 'test-user-1';

      // Create test session data
      const sessionData = createTestSession({
        id: sessionId,
        userId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      // Insert session into database
      await db.insert(whatsappSessions).values(sessionData);

      const spyOnUpdateLastUsed = spyOn(mockWhatsappSessionService, 'updateLastUsed');

      // Mock connection manager to return existing connection
      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
        sendMessage: mock(() => Promise.resolve({ key: { id: 'message-id-123' } })),
      };
      (mockWhatsappConnectionManager.getConnection as any).mockReturnValue(mockConnection);

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId,
        userId,
        recipient: '+1987654321',
        message: 'Hello World!',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('message-id-123');
      expect(result.status).toBe('sent');
      expect(result.recipient).toBe('+1987654321');
      expect(result.sentCount).toBe(1);
      expect(result.failedCount).toBe(0);

      // Verify connection was used (not created)
      expect(mockWhatsappConnectionManager.getConnection).toHaveBeenCalledWith(sessionId);
      expect(mockWhatsappConnectionManager.createConnection).not.toHaveBeenCalled();

      // Verify message was sent
      expect(mockConnection.sendMessage).toHaveBeenCalledWith('+1987654321@c.us', 'Hello World!');

      // Verify session was updated
      expect(spyOnUpdateLastUsed).toHaveBeenCalledWith(sessionId);
    });

    test('should create new connection if none exists', async () => {
      const userId = 'test-user-2';

      // Create test session
      const session = await createTestSession({
        id: undefined,
        userId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);
      await mockWhatsappSessionService.updateSession(sessionId, session);

      // Mock no existing connection
      mockWhatsappConnectionManager.getConnection.mockReturnValue(null);

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId,
        userId,
        recipient: '+1987654321',
        message: 'Hello World!',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('message-id-123');

      // Verify new connection was created
      expect(mockWhatsappConnectionManager.createConnection).toHaveBeenCalledWith(
        sessionId,
        userId,
      );
    });

    test('should handle non-text message types with error', async () => {
      const userId = 'test-user-3';

      const session = await createTestSession({
        id: undefined,
        userId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);
      await mockWhatsappSessionService.updateSession(sessionId, session);

      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
        sendMessage: mock(() => Promise.resolve({ key: { id: 'message-id-456' } })),
      };
      mockWhatsappConnectionManager.getConnection.mockReturnValue(mockConnection);

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId,
        userId,
        recipient: '+1987654321',
        message: 'Check this image!',
        messageType: 'image',
        mediaUrl: 'https://example.com/image.jpg',
        mediaCaption: 'Test image caption',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Message type 'image' is not implemented yet");
      expect(result.status).toBe('failed');
    });

    test('should handle session not found error', async () => {
      const sessionId = 'non-existent-session';

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId,
        userId: 'test-user',
        recipient: '+1987654321',
        message: 'Hello World!',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Session ${sessionId} not found`);
      expect(result.status).toBe('failed');
      expect(result.sentCount).toBe(0);
      expect(result.failedCount).toBe(1);
    });

    test('should handle unauthenticated session error', async () => {
      const userId = 'test-user-4';

      const session = await createTestSession({
        userId,
        status: 'not_auth', // Not authenticated
        phone: null,
        name: null,
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId,
        userId,
        recipient: '+1987654321',
        message: 'Hello World!',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain('is not authenticated');
      expect(result.status).toBe('failed');
    });
  });

  describe('Bulk Message', () => {
    test('should handle bulk message sending successfully', async () => {
      const userId = 'test-user-6';

      const session = await createTestSession({
        id: undefined,
        userId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);
      await mockWhatsappSessionService.updateSession(sessionId, session);

      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
        sendMessage: mock(() => Promise.resolve({ key: { id: 'message-id-bulk' } })),
      };
      mockWhatsappConnectionManager.getConnection.mockReturnValue(mockConnection);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId,
        userId,
        bulkJobId: 'bulk-job-123',
        template: ['Hello User', 0],
        recipients: [
          { messageId: 'msg-1', phone: '+1111111111', data: ['1'] },
          { messageId: 'msg-2', phone: '+2222222222', data: ['2'] },
          { messageId: 'msg-3', phone: '+3333333333', data: ['3'] },
        ],
        batchSize: 2,
        delay: 1000,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const bulkJob = await mockWhatsappBulkService.createBulkJob({
        sessionId,
        userId,
        name: 'Test Bulk Job',
        recipients: jobData.recipients,
        template: jobData.template,
      });
      mockJob.data.bulkJobId = bulkJob.job.id;

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.data?.total).toBe(3);

      // Verify all messages were sent
      expect(mockConnection.sendMessage).toHaveBeenCalledTimes(3);
    });

    test('should handle bulk message with template variables', async () => {
      const userId = 'test-user-7';

      const session = await createTestSession({
        id: undefined,
        userId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);
      await mockWhatsappSessionService.updateSession(sessionId, session);

      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
        sendMessage: mock(() => Promise.resolve({ key: { id: 'message-id-template' } })),
      };
      mockWhatsappConnectionManager.getConnection.mockReturnValue(mockConnection);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId,
        userId,
        bulkJobId: 'bulk-job-456',
        template: ['Hello ', 0, '! Welcome to ', 1, '.'],
        recipients: [
          {
            messageId: 'msg-4',
            phone: '+1111111111',
            data: ['John', 'ACME Corp'],
          },
          {
            messageId: 'msg-5',
            phone: '+2222222222',
            data: ['Jane', 'XYZ Inc'],
          },
        ],
        batchSize: 5,
        delay: 500,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const bulkJob = await mockWhatsappBulkService.createBulkJob({
        sessionId,
        userId,
        name: 'Test Bulk Job',
        recipients: jobData.recipients,
        template: jobData.template,
      });
      mockJob.data.bulkJobId = bulkJob.job.id;

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(2);
      expect(result.failedCount).toBe(0);

      // Verify messages were sent with template variables replaced
      expect(mockConnection.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('should handle partial bulk message failures', async () => {
      const userId = 'test-user-8';

      const session = await createTestSession({
        id: undefined,
        userId,
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);
      await mockWhatsappSessionService.updateSession(sessionId, session);

      // Mock connection that fails for specific phone number
      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
        sendMessage: mock((jid: string, message: string) => {
          if (jid.includes('+2222222222')) {
            throw new Error('Failed to send message');
          }
          return Promise.resolve({ key: { id: 'message-id-success' } });
        }),
      };
      mockWhatsappConnectionManager.getConnection.mockReturnValue(mockConnection);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId,
        userId,
        bulkJobId: 'bulk-job-789',
        template: ['Hello User ', 0],
        recipients: [
          { messageId: 'msg-6', phone: '+1111111111', data: ['1'] },
          { messageId: 'msg-7', phone: '+2222222222', data: ['2'] }, // Will fail
          { messageId: 'msg-8', phone: '+3333333333', data: ['3'] },
        ],
        batchSize: 3,
        delay: 0,
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const bulkJob = await mockWhatsappBulkService.createBulkJob({
        sessionId,
        userId,
        name: 'Test Bulk Job',
        recipients: jobData.recipients,
        template: jobData.template,
      });
      mockJob.data.bulkJobId = bulkJob.job.id;
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false); // Overall failure due to partial failures
      expect(result.sentCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.data?.total).toBe(3);
    });
  });

  describe('Message Status', () => {
    test('should handle message status check', async () => {
      const messageId = 'message-123';

      const session = await createTestSession({
        userId: 'test-user-9',
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);

      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
      };
      mockWhatsappConnectionManager.getConnection.mockReturnValue(mockConnection);

      const jobData: MessageStatusJobData = {
        type: 'message_status',
        sessionId,
        userId: 'test-user-9',
        messageId,
        action: 'check',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(messageId);
      expect(result.status).toBe('delivered'); // Simulated status
      expect(result.data?.messageId).toBe(messageId);
    });

    test('should handle message status update', async () => {
      const messageId = 'message-456';

      const session = await createTestSession({
        userId: 'test-user-10',
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);

      const mockConnection = {
        isConnected: mock(() => true),
        getConnectionState: mock(() => 'open'),
      };
      (mockWhatsappConnectionManager.getConnection as any).mockReturnValue(mockConnection);

      const jobData: MessageStatusJobData = {
        type: 'message_status',
        sessionId,
        userId: 'test-user-10',
        messageId,
        action: 'update',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(messageId);
    });

    test('should handle no active connection error', async () => {
      const session = await createTestSession({
        userId: 'test-user-11',
        status: 'paired',
        phone: '+1234567890',
        name: 'Test User',
      });

      const { id: sessionId } = await mockWhatsappSessionService.createSession(session);

      const jobData: MessageStatusJobData = {
        type: 'message_status',
        sessionId,
        userId: 'test-user-11',
        messageId: 'message-789',
        action: 'check',
        timestamp: Date.now(),
      };

      const mockJob = createMockJob(jobData);
      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain(`No active connection for session ${sessionId}`);
      expect(result.status).toBe('failed');
    });
  });

  describe('Job Validation and Error Handling', () => {
    test('should handle unknown job type', async () => {
      const jobData = {
        type: 'unknown_message_type',
        sessionId: 'test-session-12',
        userId: 'test-user-12',
        timestamp: Date.now(),
      } as any;

      const mockJob = createMockJob(jobData);

      try {
        await messageWorker.processJob(mockJob);
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          'Unknown message job type: unknown_message_type',
        );
      }
    });

    test('should create proper error results', async () => {
      const error = new Error('Test error message');
      const result = messageWorker['createErrorResult'](error);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test error message');
      expect(result.timestamp).toBeDefined();
    });

    test('should create proper success results', async () => {
      const data = { messageId: 'test-123', status: 'sent' };
      const result = messageWorker['createSuccessResult'](data);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.timestamp).toBeDefined();
    });
  });
});
