import { db } from '../../db';
import { bulkJobs, bulkMessages, type BulkJobStatus } from '../../db/schema';
import { eq, and, desc, count, gt, or } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { constructMessage } from '@/lib/utils';

/**
 * WhatsApp Bulk Service
 *
 * Manages bulk messaging jobs and individual message tracking
 * Handles bulk job CRUD operations and status management
 */

export interface BulkJob {
  id: string;
  userId: string;
  sessionId: string;
  name: string;
  status: BulkJobStatus;
  totalMessages: number;
  processedMessages: number;
  successfulMessages: number;
  failedMessages: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface BulkMessage {
  id: string;
  jobId: string;
  phoneNumber: string;
  message: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt: Date | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateBulkJobInput {
  userId: string;
  sessionId: string;
  name: string;
  template: Array<string | number>;
  recipients: Array<{
    phone: string;
    data: string[];
  }>;
}

export interface CreateBulkJobResult {
  job: BulkJob;
  recipients: Array<{
    messageId: string;
    phone: string;
    data: string[];
  }>;
}

export interface UpdateBulkJobInput {
  status?: BulkJobStatus;
  processedMessages?: number;
  successfulMessages?: number;
  failedMessages?: number;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export class WhatsAppBulkService {
  private db: typeof db;

  constructor(database: typeof db) {
    this.db = database;
  }

  /**
   * Create a new bulk messaging job
   */
  async createBulkJob(input: CreateBulkJobInput): Promise<CreateBulkJobResult> {
    try {
      const now = new Date();
      const jobId = createId();

      // Create the bulk job record
      const bulkJobData: typeof bulkJobs.$inferInsert = {
        id: jobId,
        userId: input.userId,
        sessionId: input.sessionId,
        name: input.name,
        status: 'pending' as BulkJobStatus,
        totalMessages: input.recipients.length,
        processedMessages: 0,
        successfulMessages: 0,
        failedMessages: 0,
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };

      const [job] = await this.db.insert(bulkJobs).values(bulkJobData).returning();

      // Create individual message records and collect their IDs
      const messageDataWithIds = input.recipients.map((msg) => {
        const messageId = createId();
        return {
          insertData: {
            id: messageId,
            jobId: jobId,
            phoneNumber: msg.phone,
            message: constructMessage(input.template, msg.data),
            status: 'pending' as const,
            sentAt: null,
            errorMessage: null,
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
          } as typeof bulkMessages.$inferInsert,
          recipientWithId: {
            messageId,
            phone: msg.phone,
            data: msg.data,
          },
        };
      });

      const messageData = messageDataWithIds.map((item) => item.insertData);
      const recipientsWithIds = messageDataWithIds.map((item) => item.recipientWithId);

      await this.db.insert(bulkMessages).values(messageData);

      return {
        job,
        recipients: recipientsWithIds,
      };
    } catch (error) {
      console.error('Failed to create bulk job:', error);
      throw new Error('Failed to create bulk job');
    }
  }

  /**
   * Get bulk job by ID
   */
  async getBulkJobById(jobId: string): Promise<BulkJob | null> {
    try {
      const [job] = await this.db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId)).limit(1);

      return job || null;
    } catch (error) {
      console.error(`Failed to get bulk job ${jobId}:`, error);
      throw new Error('Failed to get bulk job');
    }
  }

  /**
   * Get all bulk jobs for a user
   */
  async getBulkJobsByUserId(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<BulkJob[]> {
    try {
      const jobs = await this.db
        .select()
        .from(bulkJobs)
        .where(eq(bulkJobs.userId, userId))
        .orderBy(desc(bulkJobs.createdAt))
        .limit(limit)
        .offset(offset);

      return jobs;
    } catch (error) {
      console.error(`Failed to get bulk jobs for user ${userId}:`, error);
      throw new Error('Failed to get user bulk jobs');
    }
  }

  /**
   * Get bulk jobs by session ID
   */
  async getBulkJobsBySessionId(sessionId: string): Promise<BulkJob[]> {
    try {
      const jobs = await this.db
        .select()
        .from(bulkJobs)
        .where(eq(bulkJobs.sessionId, sessionId))
        .orderBy(desc(bulkJobs.createdAt));

      return jobs;
    } catch (error) {
      console.error(`Failed to get bulk jobs for session ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Update bulk job
   */
  async updateBulkJob(jobId: string, input: UpdateBulkJobInput): Promise<BulkJob | null> {
    try {
      const updateData = {
        ...input,
        updatedAt: new Date(),
      };

      const [updatedJob] = await this.db
        .update(bulkJobs)
        .set(updateData)
        .where(eq(bulkJobs.id, jobId))
        .returning();

      return updatedJob || null;
    } catch (error) {
      console.error(`Failed to update bulk job ${jobId}:`, error);
      throw new Error('Failed to update bulk job');
    }
  }

  /**
   * Delete bulk job and all associated messages
   */
  async deleteBulkJob(jobId: string): Promise<boolean> {
    try {
      // Delete messages first (cascade should handle this, but explicit is better)
      await this.db.delete(bulkMessages).where(eq(bulkMessages.jobId, jobId));

      // Delete job record
      await this.db.delete(bulkJobs).where(eq(bulkJobs.id, jobId));

      return true;
    } catch (error) {
      console.error(`Failed to delete bulk job ${jobId}:`, error);
      throw new Error('Failed to delete bulk job');
    }
  }

  /**
   * Get messages for a bulk job
   */
  async getBulkJobMessages(
    jobId: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<BulkMessage[]> {
    try {
      const messages = await this.db
        .select()
        .from(bulkMessages)
        .where(eq(bulkMessages.jobId, jobId))
        .orderBy(bulkMessages.createdAt)
        .limit(limit)
        .offset(offset);

      return messages;
    } catch (error) {
      console.error(`Failed to get messages for bulk job ${jobId}:`, error);
      throw new Error('Failed to get bulk job messages');
    }
  }

  /**
   * Get messages for a bulk job with cursor-based pagination
   */
  async getBulkJobMessagesWithCursor(
    jobId: string,
    limit: number = 100,
    cursor?: { createdAt: string; messageId: string },
  ): Promise<{ messages: BulkMessage[]; nextCursor?: { createdAt: string; messageId: string } }> {
    try {
      let whereConditions = [eq(bulkMessages.jobId, jobId)];

      if (cursor) {
        // Apply cursor-based pagination using createdAt and messageId
        whereConditions.push(
          or(
            gt(bulkMessages.createdAt, new Date(cursor.createdAt)),
            and(
              eq(bulkMessages.createdAt, new Date(cursor.createdAt)),
              gt(bulkMessages.id, cursor.messageId),
            ),
          )!,
        );
      }

      const results = await this.db
        .select()
        .from(bulkMessages)
        .where(and(...whereConditions))
        .orderBy(bulkMessages.createdAt, bulkMessages.id)
        .limit(limit + 1); // Fetch one extra to determine if there's a next page

      // Check if there are more messages
      const hasMore = results.length > limit;
      const messages = hasMore ? results.slice(0, limit) : results;

      // Calculate next cursor
      let nextCursor: { createdAt: string; messageId: string } | undefined;
      if (hasMore && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        nextCursor = {
          createdAt: lastMessage.createdAt?.toISOString() || new Date().toISOString(),
          messageId: lastMessage.id,
        };
      }

      return {
        messages,
        nextCursor,
      };
    } catch (error) {
      console.error(`Failed to get messages for bulk job ${jobId}:`, error);
      throw new Error('Failed to get bulk job messages');
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    messageId: string,
    status: 'pending' | 'sent' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'sent') {
        updateData.sentAt = new Date();
      }

      if (errorMessage) {
        updateData.errorMessage = errorMessage;
      }

      await this.db.update(bulkMessages).set(updateData).where(eq(bulkMessages.id, messageId));
    } catch (error) {
      console.error(`Failed to update message status ${messageId}:`, error);
      // Don't throw error for message status updates to avoid breaking bulk jobs
    }
  }

  /**
   * Get bulk job progress statistics
   */
  async getBulkJobProgress(jobId: string): Promise<{
    total: number;
    pending: number;
    sent: number;
    failed: number;
    progress: number;
  }> {
    try {
      const job = await this.getBulkJobById(jobId);
      if (!job) {
        throw new Error('Bulk job not found');
      }

      // Get message counts from the job record (more efficient than counting messages)
      const total = job.totalMessages;
      const sent = job.successfulMessages;
      const failed = job.failedMessages;
      const processed = job.processedMessages;
      const pending = total - processed;

      const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

      return {
        total,
        pending,
        sent,
        failed,
        progress,
      };
    } catch (error) {
      console.error(`Failed to get bulk job progress ${jobId}:`, error);
      throw new Error('Failed to get bulk job progress');
    }
  }

  /**
   * Cancel/stop a bulk job
   */
  async cancelBulkJob(jobId: string): Promise<BulkJob | null> {
    try {
      const job = await this.getBulkJobById(jobId);
      if (!job) {
        throw new Error('Bulk job not found');
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        throw new Error('Cannot cancel job that is already finished');
      }

      return await this.updateBulkJob(jobId, {
        status: 'cancelled',
        completedAt: new Date(),
      });
    } catch (error) {
      console.error(`Failed to cancel bulk job ${jobId}:`, error);
      throw new Error('Failed to cancel bulk job');
    }
  }

  /**
   * Get bulk jobs by status
   */
  async getBulkJobsByStatus(status: BulkJobStatus): Promise<BulkJob[]> {
    try {
      const jobs = await this.db
        .select()
        .from(bulkJobs)
        .where(eq(bulkJobs.status, status))
        .orderBy(desc(bulkJobs.createdAt));

      return jobs;
    } catch (error) {
      console.error(`Failed to get bulk jobs with status ${status}:`, error);
      return [];
    }
  }
}

// Export singleton instance
export const whatsappBulkService = new WhatsAppBulkService(db);
