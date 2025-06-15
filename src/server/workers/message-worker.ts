// Message Workers for WhatsApp
// Handles single messages, bulk messaging, and message status tracking

import { Job } from 'bullmq';
import { BaseWorker } from './base-worker';
import { QUEUE_NAMES } from '../queue/config';
import type {
  MessageJobData,
  SingleMessageJobData,
  BulkMessageJobData,
  MessageStatusJobData,
  MessageJobResult,
  JobResult,
} from '../queue/job-types';
import {
  whatsappConnectionManager,
  WhatsAppConnectionManager,
} from '../services/whatsapp/connection-manager';
import {
  whatsappSessionService,
  WhatsAppSessionService,
} from '../services/whatsapp/session-service';
import { whatsappBulkService, WhatsAppBulkService } from '../services/whatsapp/bulk-service';
import type { proto } from '@whiskeysockets/baileys';
import { constructMessage } from '@/lib/utils';

/**
 * Dependencies interface for MessageWorker
 */
interface MessageWorkerDependencies {
  whatsappConnectionManager: WhatsAppConnectionManager;
  whatsappSessionService: WhatsAppSessionService;
  whatsappBulkService: WhatsAppBulkService;
}

/**
 * Message Worker
 * Processes message-related jobs for WhatsApp sessions
 */
export class MessageWorker extends BaseWorker<MessageJobData> {
  // Services - injected via constructor
  protected whatsappConnectionManager: WhatsAppConnectionManager;
  protected whatsappSessionService: WhatsAppSessionService;
  protected whatsappBulkService: WhatsAppBulkService;

  constructor(dependencies: MessageWorkerDependencies) {
    super(
      QUEUE_NAMES.WHATSAPP_MESSAGE,
      5, // Higher concurrency for messaging operations
      20, // 20 messages per minute max
      60000, // 1 minute rate limit window
    );

    // Use provided dependencies or defaults
    this.whatsappConnectionManager = dependencies.whatsappConnectionManager;
    this.whatsappSessionService = dependencies.whatsappSessionService;
    this.whatsappBulkService = dependencies.whatsappBulkService;
  }

  async processJob(job: Job<MessageJobData, JobResult>): Promise<MessageJobResult> {
    this.validateJobData(job.data);

    const { type, sessionId } = job.data;

    switch (type) {
      case 'single_message':
        return await this.handleSingleMessage(job as Job<SingleMessageJobData>);

      case 'bulk_message':
        return await this.handleBulkMessage(job as Job<BulkMessageJobData>);

      case 'message_status':
        return await this.handleMessageStatus(job as Job<MessageStatusJobData>);

      default:
        throw new Error(`Unknown message job type: ${type}`);
    }
  }

  /**
   * Handle sending a single message
   */
  private async handleSingleMessage(job: Job<SingleMessageJobData>): Promise<MessageJobResult> {
    const {
      sessionId,
      recipient,
      message,
      messageType = 'text',
      mediaUrl,
      mediaCaption,
    } = job.data;

    try {
      await job.updateProgress(10);

      // Verify session exists and is authenticated
      const session = await this.whatsappSessionService.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.status !== 'paired') {
        throw new Error(`Session ${sessionId} is not authenticated`);
      }

      await job.updateProgress(30);

      // Get or create connection
      let connection = this.whatsappConnectionManager.getConnection(sessionId);
      if (!connection || !connection.isConnected()) {
        connection = await this.whatsappConnectionManager.createConnection(
          sessionId,
          session.userId,
        );

        // Wait for connection to be ready
        let attempts = 0;
        while (!connection.isConnected() && attempts < 30) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;
        }

        if (!connection.isConnected()) {
          throw new Error('Failed to establish WhatsApp connection');
        }
      }

      await job.updateProgress(60);

      // Format recipient phone number
      const recipientJid = recipient.includes('@') ? recipient : `${recipient}@c.us`;

      // Send message based on type
      let messageResult: proto.WebMessageInfo | undefined;
      let messageId: string | null | undefined;

      switch (messageType) {
        case 'text':
          messageResult = await connection.sendMessage(recipientJid, message);
          messageId = messageResult?.key?.id;
          break;

        case 'image':
        case 'document':
        case 'audio':
          throw new Error(`Message type '${messageType}' is not implemented yet`);

        default:
          throw new Error(`Unsupported message type: ${messageType}`);
      }

      await job.updateProgress(90);

      // Update session last used
      await this.whatsappSessionService.updateLastUsed(sessionId);

      await job.updateProgress(100);

      return {
        success: true,
        data: {
          messageId,
          recipient,
          messageType,
          sentAt: Date.now(),
        },
        messageId: messageId || undefined,
        status: 'sent',
        recipient,
        sentCount: 1,
        failedCount: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Single message failed for session ${sessionId}:`, error);
      return {
        ...this.createErrorResult(error),
        messageId: undefined,
        status: 'failed',
        recipient,
        sentCount: 0,
        failedCount: 1,
      } as MessageJobResult;
    }
  }

  /**
   * Handle bulk message sending
   */
  private async handleBulkMessage(job: Job<BulkMessageJobData>): Promise<MessageJobResult> {
    const { sessionId, bulkJobId, recipients, template, batchSize = 10, delay = 2000 } = job.data;

    try {
      await job.updateProgress(5);

      // Check if job was cancelled before starting
      const currentJob = await this.whatsappBulkService.getBulkJobById(bulkJobId);
      if (!currentJob) {
        throw new Error(`Bulk job ${bulkJobId} not found`);
      }

      if (currentJob.status === 'cancelled') {
        throw new Error('Job was cancelled before processing started');
      }

      // Update job status to processing in database
      await this.whatsappBulkService.updateBulkJob(bulkJobId, {
        status: 'processing',
        startedAt: new Date(),
      });

      // Verify session exists and is authenticated
      const session = await this.whatsappSessionService.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.status !== 'paired') {
        throw new Error(`Session ${sessionId} is not authenticated`);
      }

      await job.updateProgress(15);

      // Get or create connection
      let connection = this.whatsappConnectionManager.getConnection(sessionId);
      if (!connection || !connection.isConnected()) {
        connection = await this.whatsappConnectionManager.createConnection(
          sessionId,
          session.userId,
        );

        // Wait for connection to be ready
        let attempts = 0;
        while (!connection.isConnected() && attempts < 30) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;
        }

        if (!connection.isConnected()) {
          throw new Error('Failed to establish WhatsApp connection');
        }
      }

      await job.updateProgress(30);

      let sentCount = 0;
      let failedCount = 0;
      let processedCount = 0;
      const errors: Array<{ item: any; error: string }> = [];

      // Process recipients in batches
      for (let i = 0; i < recipients.length; i += batchSize) {
        // Check for cancellation before each batch
        const jobStatus = await this.whatsappBulkService.getBulkJobById(bulkJobId);
        if (jobStatus?.status === 'cancelled') {
          console.log(`Bulk job ${bulkJobId} was cancelled, stopping processing`);
          break;
        }

        const batch = recipients.slice(i, i + batchSize);

        // Process batch in parallel
        const batchPromises = batch.map(async (recipient) => {
          try {
            // Check for cancellation before processing each message
            const bulkJob = await this.whatsappBulkService.getBulkJobById(bulkJobId);
            if (bulkJob?.status === 'cancelled') {
              throw new Error('Job was cancelled');
            }

            // Construct message with variables
            let messageContent = constructMessage(template, recipient.data);

            // Format recipient phone number
            const recipientJid = recipient.phone.includes('@')
              ? recipient.phone
              : `${recipient.phone}@c.us`;

            // Send message
            const messageResult = await connection.sendMessage(recipientJid, messageContent);
            const messageId = messageResult?.key?.id;

            sentCount++;

            // Update individual message status in database using messageId from recipient
            if (recipient.messageId) {
              await this.whatsappBulkService.updateMessageStatus(recipient.messageId, 'sent');
            }

            return { success: true, messageId, recipient: recipient.phone };
          } catch (error) {
            failedCount++;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push({ item: recipient, error: errorMessage });

            // Update individual message status in database using messageId from recipient
            if (recipient.messageId) {
              await this.whatsappBulkService.updateMessageStatus(
                recipient.messageId,
                'failed',
                errorMessage,
              );
            }

            return {
              success: false,
              error: errorMessage,
              recipient: recipient.phone,
            };
          }
        });

        // Wait for batch completion
        await Promise.allSettled(batchPromises);

        processedCount += batch.length;

        // Update job progress in database after each batch
        await this.whatsappBulkService.updateBulkJob(bulkJobId, {
          processedMessages: processedCount,
          successfulMessages: sentCount,
          failedMessages: failedCount,
        });

        // Update progress
        const progress = 30 + ((i + batch.length) / recipients.length) * 60;
        await job.updateProgress(Math.min(progress, 90));

        // Add delay between batches (except for the last batch)
        if (i + batchSize < recipients.length) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Final job update
      const total = recipients.length;
      const isSuccess = failedCount === 0;
      const finalStatus = isSuccess ? 'completed' : sentCount > 0 ? 'completed' : 'failed';

      await this.whatsappBulkService.updateBulkJob(bulkJobId, {
        status: finalStatus,
        processedMessages: total,
        successfulMessages: sentCount,
        failedMessages: failedCount,
        completedAt: new Date(),
        errorMessage:
          !isSuccess && errors.length > 0 ? `${failedCount} messages failed` : undefined,
      });

      // Update session last used
      await this.whatsappSessionService.updateLastUsed(sessionId);

      await job.updateProgress(100);

      return {
        success: isSuccess,
        data: {
          bulkJobId,
          total,
          sent: sentCount,
          failed: failedCount,
          completedAt: Date.now(),
        },
        messageId: undefined,
        status: isSuccess ? 'sent' : 'failed',
        recipient: undefined,
        sentCount,
        failedCount,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Bulk message failed for session ${sessionId}:`, error);

      // Update job status to failed in database
      try {
        await this.whatsappBulkService.updateBulkJob(bulkJobId, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      } catch (updateError) {
        console.error(`Failed to update job status to failed:`, updateError);
      }

      return {
        ...this.createErrorResult(error),
        messageId: undefined,
        status: 'failed',
        recipient: undefined,
        sentCount: 0,
        failedCount: recipients.length,
      } as MessageJobResult;
    }
  }

  /**
   * Handle message status checking/updating
   */
  private async handleMessageStatus(job: Job<MessageStatusJobData>): Promise<MessageJobResult> {
    const { sessionId, messageId, action } = job.data;

    try {
      await job.updateProgress(25);

      // Verify session exists
      const session = await this.whatsappSessionService.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      await job.updateProgress(50);

      // Get connection
      const connection = this.whatsappConnectionManager.getConnection(sessionId);
      if (!connection || !connection.isConnected()) {
        throw new Error(`No active connection for session ${sessionId}`);
      }

      await job.updateProgress(75);

      let status: 'sent' | 'delivered' | 'read' | 'failed' = 'sent';

      if (action === 'check') {
        // In a real implementation, you would check the message status from WhatsApp
        // For now, we'll simulate checking the status
        status = 'delivered'; // This would be retrieved from actual WhatsApp API
      } else if (action === 'update') {
        // Update message status in database or external system
        // This is a placeholder for actual status update logic
        console.log(`Updating status for message ${messageId} in session ${sessionId}`);
      }

      await job.updateProgress(100);

      return {
        success: true,
        data: {
          messageId,
          status,
          checkedAt: Date.now(),
        },
        messageId,
        status,
        recipient: undefined,
        sentCount: 0,
        failedCount: 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Message status handling failed for session ${sessionId}:`, error);
      return {
        ...this.createErrorResult(error),
        messageId,
        status: 'failed',
        recipient: undefined,
        sentCount: 0,
        failedCount: 1,
      } as MessageJobResult;
    }
  }
}

// Export singleton instance
export const messageWorker = new MessageWorker({
  whatsappConnectionManager,
  whatsappSessionService,
  whatsappBulkService,
});
