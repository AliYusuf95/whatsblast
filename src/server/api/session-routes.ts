// Session Management API Routes
// Handles WhatsApp session CRUD operations and QR code generation

import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { whatsappAuthQueue } from '../queue/queues';
import type { QRGenerationJobData, AuthValidationJobData } from '../queue/job-types';

// Input validation schemas
const createSessionSchema = z.object({
  description: z.string().min(1).max(255),
});

const sessionIdSchema = z.object({
  sessionId: z.cuid2(),
});

const updateSessionSchema = z.object({
  sessionId: z.cuid2(),
  description: z.string().min(1).max(255).optional(),
});

const requestQRSchema = z.object({
  sessionId: z.cuid2(),
});

// Session router with WhatsApp session management
export const sessionRouter = router({
  // Create a new WhatsApp session
  createSession: protectedProcedure.input(createSessionSchema).mutation(async ({ input, ctx }) => {
    try {
      const session = await ctx.services.whatsappSessionService.createSession({
        userId: ctx.user.id,
        description: input.description,
      });

      return {
        success: true,
        data: session,
      };
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create session',
      });
    }
  }),

  // Get all sessions for the current user
  getSessions: protectedProcedure.query(async ({ ctx }) => {
    try {
      const sessions = await ctx.services.whatsappSessionService.getSessionsByUserId(ctx.user.id);

      return {
        success: true,
        data: sessions,
      };
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get sessions',
      });
    }
  }),

  // Get a specific session by ID
  getSession: protectedProcedure.input(sessionIdSchema).query(async ({ input, ctx }) => {
    try {
      const session = await ctx.services.whatsappSessionService.getSessionById(input.sessionId);

      if (!session) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      // Verify the session belongs to the user
      if (session.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      return {
        success: true,
        data: session,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get session',
      });
    }
  }),

  // Update session description
  updateSession: protectedProcedure.input(updateSessionSchema).mutation(async ({ input, ctx }) => {
    try {
      // First verify the session exists and belongs to the user
      const existingSession = await ctx.services.whatsappSessionService.getSessionById(
        input.sessionId,
      );

      if (!existingSession) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      if (existingSession.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Update only the description for now
      const updateData: { description?: string } = {};
      if (input.description) {
        updateData.description = input.description;
      }

      const updatedSession = await ctx.services.whatsappSessionService.updateSession(
        input.sessionId,
        updateData,
      );

      return {
        success: true,
        data: updatedSession,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to update session',
      });
    }
  }),

  // Delete a session
  deleteSession: protectedProcedure.input(sessionIdSchema).mutation(async ({ input, ctx }) => {
    try {
      // First verify the session exists and belongs to the user
      const existingSession = await ctx.services.whatsappSessionService.getSessionById(
        input.sessionId,
      );

      if (!existingSession) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      if (existingSession.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Logout and close the connection if it exists
      const connection = ctx.services.whatsappConnectionManager.getConnection(input.sessionId);
      if (connection) {
        await ctx.services.whatsappConnectionManager
          .logoutConnection(input.sessionId)
          .catch((error) => {
            // ingore errors here
          });
      }

      // Delete the session and all associated data
      await ctx.services.whatsappSessionService.deleteSession(input.sessionId);

      return {
        success: true,
        message: 'Session deleted successfully',
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to delete session',
      });
    }
  }),

  // Request QR code for session pairing
  requestQR: protectedProcedure.input(requestQRSchema).mutation(async ({ input, ctx }) => {
    try {
      // First verify the session exists and belongs to the user
      const existingSession = await ctx.services.whatsappSessionService.getSessionById(
        input.sessionId,
      );

      if (!existingSession) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      if (existingSession.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Create QR generation job
      const qrJob: QRGenerationJobData = {
        type: 'qr_generation',
        sessionId: input.sessionId,
        userId: ctx.user.id,
        timestamp: Date.now(),
      };

      const job = await whatsappAuthQueue.add('qr_generation', qrJob, {
        priority: 10, // High priority for QR generation
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      await ctx.services.whatsappSessionService.updateSession(input.sessionId, {
        status: 'qr_pairing',
        qrCode: null,
        qrExpiresAt: null,
      });

      return {
        success: true,
        data: {
          jobId: job.id,
          sessionId: input.sessionId,
          status: 'qr_requested',
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to request QR code',
      });
    }
  }),

  // Get session status and connection info
  getSessionStatus: protectedProcedure.input(sessionIdSchema).query(async ({ input, ctx }) => {
    try {
      // First verify the session exists and belongs to the user
      const existingSession = await ctx.services.whatsappSessionService.getSessionById(
        input.sessionId,
      );

      if (!existingSession) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      if (existingSession.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Get connection status
      const connection = ctx.services.whatsappConnectionManager.getConnection(input.sessionId);
      const connectionState = connection?.getConnectionState() || 'disconnected';
      const isConnected = connection?.isConnected() || false;

      // Check if QR code is expired
      const qrExpired = existingSession.qrExpiresAt
        ? new Date() > existingSession.qrExpiresAt
        : false;

      return {
        success: true,
        data: {
          session: existingSession,
          connection: {
            state: connectionState,
            isConnected,
          },
          qr: {
            code: qrExpired ? null : existingSession.qrCode,
            expired: qrExpired,
            expiresAt: existingSession.qrExpiresAt,
          },
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get session status',
      });
    }
  }),

  // Validate session authentication
  validateSession: protectedProcedure.input(sessionIdSchema).mutation(async ({ input, ctx }) => {
    try {
      // First verify the session exists and belongs to the user
      const existingSession = await ctx.services.whatsappSessionService.getSessionById(
        input.sessionId,
      );

      if (!existingSession) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      if (existingSession.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Create auth validation job
      const validationJob: AuthValidationJobData = {
        type: 'auth_validation',
        sessionId: input.sessionId,
        userId: ctx.user.id,
        timestamp: Date.now(),
      };

      const job = await whatsappAuthQueue.add('auth_validation', validationJob, {
        priority: 5,
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      return {
        success: true,
        data: {
          jobId: job.id,
          sessionId: input.sessionId,
          status: 'validation_requested',
        },
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to validate session',
      });
    }
  }),
});
