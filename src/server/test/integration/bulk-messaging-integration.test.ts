/**
 * End-to-End Bulk Messaging Integration Tests
 * Tests complete bulk messaging workflow from API to message delivery
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initTestDatabase, createTestSession, createTestBulkJob, testUtils } from '../setup';
import { whatsappSessions, bulkJobs, user } from '../../db';
import { MessageWorker } from '../../workers/message-worker';
import { WhatsAppSessionService } from '../../services/whatsapp/session-service';
import { WhatsAppConnectionManager } from '../../services/whatsapp/connection-manager';
import { whatsappBulkService } from '../../services/whatsapp/bulk-service';
import type { BulkMessageJobData, SingleMessageJobData } from '../../queue/job-types';
import { createId } from '@paralleldrive/cuid2';
import { constructMessage } from '@/lib/utils';

describe('End-to-End Bulk Messaging Integration', () => {
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;
  let messageWorker: MessageWorker;
  let sessionService: WhatsAppSessionService;
  let testUserId: string;
  let testSessionId: string;
  let whatsappConnectionManager: WhatsAppConnectionManager;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;

    testUserId = 'test-user-' + createId();
    testSessionId = 'test-session-' + createId();

    // Create test user
    await db.insert(user).values({
      id: testUserId,
      email: 'bulk@example.com',
      name: 'Bulk Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: false,
    });

    // Create paired session
    const sessionData = createTestSession({
      id: testSessionId,
      userId: testUserId,
      status: 'paired',
      phone: '+1234567890',
      name: 'Test Session',
    });

    await db.insert(whatsappSessions).values(sessionData);

    // Initialize services
    sessionService = new WhatsAppSessionService(db);

    whatsappConnectionManager = new WhatsAppConnectionManager({
      database: db,
      whatsappSessionService: sessionService,
    });

    // Create MessageWorker with real dependencies
    messageWorker = new MessageWorker({
      whatsappConnectionManager: whatsappConnectionManager,
      whatsappSessionService: sessionService,
      whatsappBulkService: whatsappBulkService, // Use real bulk service
    });
  });

  afterEach(async () => {
    await messageWorker.stop();
    cleanupDb();
  });

  describe('Complete Bulk Messaging Workflow', () => {
    test('should process bulk job from creation to completion', async () => {
      // Step 1: Create bulk job in database
      const bulkJobData = createTestBulkJob({
        userId: testUserId,
        sessionId: testSessionId,
        name: 'Integration Test Job',
        status: 'pending',
        totalMessages: 3,
        processedMessages: 0,
        failedMessages: 0,
      });
      const template = ['Hello ', 0, ', welcome to ', 1, '!'];
      const recipients = [
        { phone: '+1111111111', data: ['John', 'WhatsBlast'] },
        { phone: '+2222222222', data: ['Jane', 'Our Platform'] },
        { phone: '+3333333333', data: ['Bob', 'The System'] },
      ];

      await db.insert(bulkJobs).values(bulkJobData);

      // Step 2: Process bulk job through worker
      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId: testSessionId,
        userId: testUserId,
        bulkJobId: bulkJobData.id,
        template,
        recipients: recipients.map((r, i) => ({
          messageId: `integration-msg-${i + 1}`,
          phone: r.phone,
          data: r.data,
        })),
        batchSize: 5,
        delay: 100, // Small delay for testing
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'bulk-integration-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock successful connection
      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
        sendMessage: mock((jid: string, message: string) => {
          console.log(`Mock sending to ${jid}: ${message}`);
          return Promise.resolve({ key: { id: `msg-${Date.now()}` } });
        }),
      };

      // Set up connection mock
      (whatsappConnectionManager.getConnection as any) = mock(() => mockConnection);

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.data?.total).toBe(3);

      // Verify messages were constructed correctly
      expect(mockConnection.sendMessage).toHaveBeenCalledTimes(3);
      expect(mockConnection.sendMessage).toHaveBeenCalledWith(
        '+1111111111@c.us',
        'Hello John, welcome to WhatsBlast!',
      );
      expect(mockConnection.sendMessage).toHaveBeenCalledWith(
        '+2222222222@c.us',
        'Hello Jane, welcome to Our Platform!',
      );
      expect(mockConnection.sendMessage).toHaveBeenCalledWith(
        '+3333333333@c.us',
        'Hello Bob, welcome to The System!',
      );
    });

    test('should handle partial failures in bulk messaging', async () => {
      const bulkJobData = createTestBulkJob({
        userId: testUserId,
        sessionId: testSessionId,
        name: 'Partial Failure Test',
        status: 'pending',
        totalMessages: 3,
      });

      const template = ['Test message to ', 0];
      const recipients = [
        { phone: '+1111111111', data: ['Success User'] },
        { phone: '+2222222222', data: ['Failure User'] },
        { phone: '+3333333333', data: ['Another Success'] },
      ];

      await db.insert(bulkJobs).values(bulkJobData);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId: testSessionId,
        userId: testUserId,
        bulkJobId: bulkJobData.id,
        template,
        recipients: recipients.map((r, i) => ({
          messageId: `integration-msg-2-${i + 1}`,
          phone: r.phone,
          data: r.data,
        })),
        batchSize: 3,
        delay: 0,
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'partial-failure-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock connection that fails for specific number
      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
        sendMessage: mock((jid: string, message: string) => {
          if (jid.includes('+2222222222')) {
            throw new Error('Failed to send to this number');
          }
          return Promise.resolve({ key: { id: `msg-${Date.now()}` } });
        }),
      };
      (whatsappConnectionManager.getConnection as any) = mock(() => mockConnection);

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false); // Overall failure due to partial failures
      expect(result.sentCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.data?.total).toBe(3);
      expect(result.data?.sent).toBe(2);
      expect(result.data?.failed).toBe(1);
    });

    test('should handle template with complex variable replacement', async () => {
      const complexTemplate = [
        'Dear ',
        0,
        ',\n\n',
        'Your order #',
        1,
        ' has been shipped to ',
        2,
        '.\n',
        'Total amount: $',
        3,
        '\n\n',
        'Thanks for choosing ',
        4,
        '!',
      ];

      const recipients = [
        {
          phone: '+1111111111',
          data: ['John Doe', 'ORD-001', '123 Main St', '99.99', 'WhatsBlast'],
        },
        {
          phone: '+2222222222',
          data: ['Jane Smith', 'ORD-002', '456 Oak Ave', '149.50', 'Our Store'],
        },
      ];

      const bulkJobData = createTestBulkJob({
        userId: testUserId,
        sessionId: testSessionId,
        name: 'Complex Template Test',
        status: 'pending',
        totalMessages: 2,
      });

      await db.insert(bulkJobs).values(bulkJobData);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId: testSessionId,
        userId: testUserId,
        bulkJobId: bulkJobData.id,
        template: complexTemplate,
        recipients: recipients.map((r, i) => ({
          messageId: `integration-msg-3-${i + 1}`,
          phone: r.phone,
          data: r.data,
        })),
        batchSize: 2,
        delay: 0,
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'complex-template-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
        sendMessage: mock((jid: string, message: string) => {
          return Promise.resolve({ key: { id: `msg-${Date.now()}` } });
        }),
      };
      (whatsappConnectionManager.getConnection as any) = mock(() => mockConnection);

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(2);
      expect(result.failedCount).toBe(0);

      // Verify complex messages were constructed correctly
      const calls = mockConnection.sendMessage.mock.calls;
      expect(calls[0][1]).toBe(
        'Dear John Doe,\n\nYour order #ORD-001 has been shipped to 123 Main St.\nTotal amount: $99.99\n\nThanks for choosing WhatsBlast!',
      );
      expect(calls[1][1]).toBe(
        'Dear Jane Smith,\n\nYour order #ORD-002 has been shipped to 456 Oak Ave.\nTotal amount: $149.50\n\nThanks for choosing Our Store!',
      );
    });

    test('should respect batch processing and delays', async () => {
      const recipients = Array.from({ length: 10 }, (_, i) => ({
        phone: `+111111111${i}`,
        data: [`User ${i + 1}`],
      }));

      const template = ['Hello ', 0, '!'];

      const bulkJobData = createTestBulkJob({
        userId: testUserId,
        sessionId: testSessionId,
        name: 'Batch Processing Test',
        status: 'pending',
        totalMessages: 10,
      });

      await db.insert(bulkJobs).values(bulkJobData);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId: testSessionId,
        userId: testUserId,
        bulkJobId: bulkJobData.id,
        template,
        recipients: recipients.map((r, i) => ({
          messageId: `integration-msg-4-${i + 1}`,
          phone: r.phone,
          data: r.data,
        })),
        batchSize: 3, // Process in batches of 3
        delay: 50, // 50ms delay between batches
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'batch-processing-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const sendTimes: number[] = [];
      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
        sendMessage: mock(() => {
          sendTimes.push(Date.now());
          return Promise.resolve({ key: { id: `msg-${Date.now()}` } });
        }),
      };

      (whatsappConnectionManager.getConnection as any) = mock(() => mockConnection);

      const startTime = Date.now();
      const result = await messageWorker.processJob(mockJob);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(10);
      expect(result.failedCount).toBe(0);

      // Should take some time due to batching and delays
      const totalTime = endTime - startTime;
      expect(totalTime).toBeGreaterThan(100); // At least 3 batch delays of 50ms

      // Verify progress updates were called
      expect(mockJob.updateProgress).toHaveBeenCalled();
    });
  });

  describe('Single Message Integration', () => {
    test('should process single message through complete workflow', async () => {
      const singleJobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId: testSessionId,
        userId: testUserId,
        recipient: '+9876543210',
        message: 'Hello from integration test!',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'single-integration-job',
        data: singleJobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
        sendMessage: mock(() => {
          return Promise.resolve({ key: { id: 'single-msg-123' } });
        }),
      };

      (whatsappConnectionManager.getConnection as any) = mock(() => mockConnection);

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('single-msg-123');
      expect(result.recipient).toBe('+9876543210');
      expect(result.sentCount).toBe(1);
      expect(result.failedCount).toBe(0);

      expect(mockConnection.sendMessage).toHaveBeenCalledWith(
        '+9876543210@c.us',
        'Hello from integration test!',
      );
    });
  });

  describe('Session Validation Integration', () => {
    test('should validate session authentication before sending', async () => {
      // Create unauthenticated session
      const unauthSession = createTestSession({
        userId: testUserId,
        status: 'not_auth', // Not authenticated
        phone: null,
        name: null,
      });

      await db.insert(whatsappSessions).values(unauthSession);

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId: unauthSession.id,
        userId: testUserId,
        recipient: '+9876543210',
        message: 'This should fail',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'unauth-session-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain('is not authenticated');
      expect(result.sentCount).toBe(0);
      expect(result.failedCount).toBe(1);
    });
  });

  describe('Connection Management Integration', () => {
    test('should create connection when none exists', async () => {
      // Ensure no existing connection
      await whatsappConnectionManager.removeConnection(testSessionId);

      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId: testSessionId,
        userId: testUserId,
        recipient: '+9876543210',
        message: 'Test new connection',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'new-connection-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock createConnection
      (whatsappConnectionManager.createConnection as any) = mock(() => {
        return Promise.resolve({
          isConnected: () => true,
          getConnectionState: () => 'open',
          sendMessage: mock(() => Promise.resolve({ key: { id: 'new-conn-msg' } })),
        });
      });

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('new-conn-msg');
      expect(whatsappConnectionManager.createConnection).toHaveBeenCalledWith(
        testSessionId,
        testUserId,
      );
    });

    test('should handle connection errors gracefully', async () => {
      const jobData: SingleMessageJobData = {
        type: 'single_message',
        sessionId: testSessionId,
        userId: testUserId,
        recipient: '+9876543210',
        message: 'Connection error test',
        messageType: 'text',
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'connection-error-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      // Mock connection that throws error

      (whatsappConnectionManager.getConnection as any) = mock(() => {
        return {
          isConnected: () => true,
          getConnectionState: () => 'open',
          sendMessage: mock(() => {
            throw new Error('Connection send error');
          }),
        };
      });

      const result = await messageWorker.processJob(mockJob);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection send error');
      expect(result.sentCount).toBe(0);
      expect(result.failedCount).toBe(1);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large recipient lists efficiently', async () => {
      const largeRecipientList = Array.from({ length: 100 }, (_, i) => ({
        phone: `+${(1000000000 + i).toString()}`,
        data: [`User ${i + 1}`, `Company ${Math.floor(i / 10) + 1}`],
      }));

      const template = ['Hello ', 0, ' from ', 1, '!'];

      const bulkJobData = createTestBulkJob({
        userId: testUserId,
        sessionId: testSessionId,
        name: 'Large Scale Test',
        status: 'pending',
        totalMessages: 100,
      });

      await db.insert(bulkJobs).values(bulkJobData);

      const jobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId: testSessionId,
        userId: testUserId,
        bulkJobId: bulkJobData.id,
        template,
        recipients: largeRecipientList.map((r, i) => ({
          messageId: `integration-msg-5-${i + 1}`,
          phone: r.phone,
          data: r.data,
        })),
        batchSize: 20, // Process in larger batches
        delay: 10, // Minimal delay for testing
        timestamp: Date.now(),
      };

      const mockJob = {
        id: 'large-scale-job',
        data: jobData,
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const mockConnection = {
        isConnected: () => true,
        getConnectionState: () => 'open',
        sendMessage: mock(() => {
          return Promise.resolve({ key: { id: `msg-${Math.random()}` } });
        }),
      };

      (whatsappConnectionManager.getConnection as any) = mock(() => mockConnection);

      const startTime = Date.now();
      const result = await messageWorker.processJob(mockJob);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(100);
      expect(result.failedCount).toBe(0);

      // Should complete in reasonable time (less than 5 seconds)
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(5000);

      // Should have called sendMessage 100 times
      expect(mockConnection.sendMessage).toHaveBeenCalledTimes(100);
    });
  });
});
