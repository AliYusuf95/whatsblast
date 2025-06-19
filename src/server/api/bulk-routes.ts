// Bulk Messaging API Routes
// Handles bulk messaging operations and job management

import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { type BulkJob } from '../services';
import { whatsappMessageQueue } from '../queue/queues';
import type { BulkMessageJobData } from '../queue/job-types';

// Input validation schemas
const bulkJobIdSchema = z.object({
  jobId: z.cuid2(),
});

const getBulkJobsSchema = z.object({
  sessionId: z.cuid2().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

const getBulkMessagesSchema = z.object({
  jobId: z.cuid2(),
  limit: z.number().int().min(1).default(50),
  offset: z.number().int().min(0).default(0),
});

const getBulkMessagesInfiniteSchema = z.object({
  jobId: z.cuid2(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z
    .object({
      createdAt: z.iso.datetime(), // ISO string for createdAt
      messageId: z.cuid2(), // message ID for tie-breaking
    })
    .optional(), // cursor for infinite query
});

const sendBulkSchema = z.object({
  sessionId: z.cuid2(),
  name: z.string().min(1).max(255),
  recipients: z
    .array(
      z.object({
        phone: z.string().min(5).max(20),
        data: z.array(z.string()),
      }),
    )
    .min(1),
  template: z.array(z.union([z.string(), z.number()])),
  batchSize: z.number().int().min(1).max(500).default(10),
  delay: z.number().int().min(500).max(10000).default(2000), // 0.5-10 seconds
});

// Bulk messaging router
export const bulkRouter = router({
  // Send bulk messages (creates job and queues for processing)
  sendBulk: protectedProcedure.input(sendBulkSchema).mutation(async ({ input, ctx }) => {
    try {
      // Verify session exists and belongs to the user
      const session = await ctx.services.whatsappSessionService.getSessionById(input.sessionId);

      if (!session) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      if (session.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      if (session.status !== 'paired') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Session is not authenticated',
        });
      }

      // Create bulk job record in database
      const bulkJobResult = await ctx.services.whatsappBulkService.createBulkJob({
        userId: ctx.user.id,
        sessionId: input.sessionId,
        name: input.name,
        template: input.template,
        recipients: input.recipients,
      });

      // Create message queue job for processing
      const messageJobData: BulkMessageJobData = {
        type: 'bulk_message',
        sessionId: input.sessionId,
        userId: ctx.user.id,
        bulkJobId: bulkJobResult.job.id,
        recipients: bulkJobResult.recipients, // Now includes messageId for each recipient
        template: input.template,
        batchSize: input.batchSize,
        delay: input.delay,
        timestamp: Date.now(),
      };

      const queueJob = await whatsappMessageQueue.add('bulk_message', messageJobData, {
        priority: 5,
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      // Update job status to processing
      await ctx.services.whatsappBulkService.updateBulkJob(bulkJobResult.job.id, {
        status: 'processing',
        startedAt: new Date(),
      });

      return {
        success: true,
        data: {
          jobId: bulkJobResult.job.id,
          queueJobId: queueJob.id,
          totalMessages: input.recipients.length,
          status: 'processing',
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to send bulk messages',
      });
    }
  }),

  // Get bulk job progress
  getBulkProgress: protectedProcedure.input(bulkJobIdSchema).query(async ({ input, ctx }) => {
    try {
      const job = await ctx.services.whatsappBulkService.getBulkJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bulk job not found',
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      const progress = await ctx.services.whatsappBulkService.getBulkJobProgress(input.jobId);

      return {
        success: true,
        data: {
          job,
          progress,
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get bulk progress',
      });
    }
  }),

  // Get all Messages jobs for the user
  getBulkJobs: protectedProcedure.input(getBulkJobsSchema).query(async ({ input, ctx }) => {
    try {
      let jobs: BulkJob[];

      if (input.sessionId) {
        // Verify session belongs to user
        const session = await ctx.services.whatsappSessionService.getSessionById(input.sessionId);
        if (!session) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Session not found',
          });
        }

        if (session.userId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Access denied',
          });
        }

        jobs = await ctx.services.whatsappBulkService.getBulkJobsBySessionId(input.sessionId);
      } else {
        jobs = await ctx.services.whatsappBulkService.getBulkJobsByUserId(
          ctx.user.id,
          input.limit,
          input.offset,
        );
      }

      return {
        success: true,
        data: jobs,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get messages jobs',
      });
    }
  }),

  // Get a specific bulk job
  getBulkJob: protectedProcedure.input(bulkJobIdSchema).query(async ({ input, ctx }) => {
    try {
      const job = await ctx.services.whatsappBulkService.getBulkJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bulk job not found',
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      return {
        success: true,
        data: job,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get bulk job',
      });
    }
  }),

  // Get messages for a bulk job
  getBulkMessages: protectedProcedure.input(getBulkMessagesSchema).query(async ({ input, ctx }) => {
    try {
      // First verify the job exists and belongs to the user
      const job = await ctx.services.whatsappBulkService.getBulkJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bulk job not found',
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      const messages = await ctx.services.whatsappBulkService.getBulkJobMessages(
        input.jobId,
        input.limit,
        input.offset,
      );

      return {
        success: true,
        data: messages,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get bulk messages',
      });
    }
  }),

  // Get messages for a bulk job (infinite query with cursor)
  getBulkMessagesInfinite: protectedProcedure
    .input(getBulkMessagesInfiniteSchema)
    .query(async ({ input, ctx }) => {
      try {
        // First verify the job exists and belongs to the user
        const job = await ctx.services.whatsappBulkService.getBulkJobById(input.jobId);

        if (!job) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Bulk job not found',
          });
        }

        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Access denied',
          });
        }

        const result = await ctx.services.whatsappBulkService.getBulkJobMessagesWithCursor(
          input.jobId,
          input.limit,
          input.cursor,
        );

        return {
          success: true,
          data: result.messages,
          nextCursor: result.nextCursor,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get bulk messages',
        });
      }
    }),

  // Stop/cancel a bulk job
  stopBulkJob: protectedProcedure.input(bulkJobIdSchema).mutation(async ({ input, ctx }) => {
    try {
      const job = await ctx.services.whatsappBulkService.getBulkJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bulk job not found',
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      const updatedJob = await ctx.services.whatsappBulkService.cancelBulkJob(input.jobId);

      return {
        success: true,
        data: updatedJob,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to stop bulk job',
      });
    }
  }),

  // Delete a bulk job
  deleteBulkJob: protectedProcedure.input(bulkJobIdSchema).mutation(async ({ input, ctx }) => {
    try {
      const job = await ctx.services.whatsappBulkService.getBulkJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bulk job not found',
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Only allow deletion of completed, failed, or cancelled jobs
      if (job.status === 'processing' || job.status === 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete active job. Stop it first.',
        });
      }

      await ctx.services.whatsappBulkService.deleteBulkJob(input.jobId);

      return {
        success: true,
        message: 'Bulk job deleted successfully',
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete bulk job',
      });
    }
  }),
});
