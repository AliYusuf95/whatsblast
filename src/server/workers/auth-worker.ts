// Authentication Workers for WhatsApp
// Handles QR generation, pairing verification, and auth state validation

import { Job } from 'bullmq';
import { BaseWorker } from './base-worker';
import { QUEUE_NAMES } from '../queue/config';
import type {
  AuthJobData,
  QRGenerationJobData,
  PairingJobData,
  AuthValidationJobData,
  LogoutJobData,
  AuthJobResult,
  JobResult,
} from '../queue/job-types';
import { whatsappConnectionManager } from '../services/whatsapp/connection-manager';
import { whatsappSessionService } from '../services/whatsapp/session-service';
import { db } from '../db';
import { hasValidAuth, clearAuthState } from '../services/whatsapp/auth-state';
import { th } from 'zod/v4/locales';

export interface AuthWorkerDependencies {
  connectionManager: typeof whatsappConnectionManager;
  sessionService: typeof whatsappSessionService;
  database: typeof db;
}

/**
 * Authentication Worker
 * Processes authentication-related jobs for WhatsApp sessions
 */
export class AuthWorker extends BaseWorker<AuthJobData> {
  private connectionManager: typeof whatsappConnectionManager;
  private sessionService: typeof whatsappSessionService;
  private db: typeof db;

  constructor(dependencies: AuthWorkerDependencies) {
    super(
      QUEUE_NAMES.WHATSAPP_AUTH,
      2, // Low concurrency for auth operations
      5, // 5 jobs per minute max
      60000, // 1 minute rate limit window
    );

    this.connectionManager = dependencies.connectionManager;
    this.sessionService = dependencies.sessionService;
    this.db = dependencies.database;
  }

  async processJob(job: Job<AuthJobData, JobResult>): Promise<AuthJobResult> {
    this.validateJobData(job.data);

    const { type } = job.data;

    switch (type) {
      case 'qr_generation':
        return await this.handleQRGeneration(job as Job<QRGenerationJobData>);

      case 'pairing_verification':
        return await this.handlePairingVerification(job as Job<PairingJobData>);

      case 'auth_validation':
        return await this.handleAuthValidation(job as Job<AuthValidationJobData>);

      case 'logout':
        return await this.handleLogout(job as Job<LogoutJobData>);

      default:
        throw new Error(`Unknown auth job type: ${type}`);
    }
  }

  /**
   * Handle QR code generation for session pairing with retry logic
   */
  private async handleQRGeneration(job: Job<QRGenerationJobData>): Promise<AuthJobResult> {
    const { sessionId } = job.data;

    try {
      await job.updateProgress(10);

      // Verify session exists and is in correct state
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.status === 'paired') {
        return {
          success: true,
          data: { message: 'Session already paired' },
          authState: 'authenticated',
          timestamp: Date.now(),
        };
      }

      await job.updateProgress(30);

      // Ensure session is in not_auth state for QR pairing
      await this.cleanupFailedQRSession(sessionId);

      await job.updateProgress(40);

      // Get or create connection for QR generation
      let connection = this.connectionManager.getConnection(sessionId);

      if (connection) {
        throw new Error(`Connection already exists for session ${sessionId}`);
      }

      console.log(`Creating new connection for QR session ${sessionId}`);
      connection = await this.connectionManager.createConnection(sessionId, session.userId);

      await job.updateProgress(60);

      // Check if QR was generated and saved to session
      const updatedSession = await this.sessionService.getSessionById(sessionId);

      await job.updateProgress(100);

      // Check if session became paired during wait (QR was scanned quickly)
      if (updatedSession?.status === 'paired') {
        console.log(`Session ${sessionId} paired during QR generation`);
        return {
          success: true,
          data: { message: 'Session paired during QR generation' },
          authState: 'authenticated',
          phoneNumber: updatedSession.phone || undefined,
          timestamp: Date.now(),
        };
      }

      throw new Error(`Session ${sessionId} did not become paired after QR generation`);
    } catch (error) {
      console.error(`QR generation failed for session ${sessionId}:`, error);

      // Clean up on any failure
      await this.cleanupFailedQRSession(sessionId);

      return this.createErrorResult(error);
    }
  }

  /**
   * Clean up failed QR session by clearing auth state and updating session status
   */
  private async cleanupFailedQRSession(sessionId: string): Promise<void> {
    try {
      // Clear auth state
      await clearAuthState(sessionId, this.db);

      // Update session status and clear QR data
      await this.sessionService.updateSession(sessionId, {
        status: 'not_auth',
        qrCode: null,
        qrExpiresAt: null,
      });

      // Close connection if exists
      const connection = this.connectionManager.getConnection(sessionId);
      if (connection) {
        await this.connectionManager.removeConnection(sessionId);
      }

      console.log(`Cleaned up failed QR session ${sessionId}`);
    } catch (error) {
      console.error(`Error cleaning up failed QR session ${sessionId}:`, error);
    }
  }

  /**
   * Handle pairing verification after QR scan with enhanced retry logic
   */
  private async handlePairingVerification(job: Job<PairingJobData>): Promise<AuthJobResult> {
    const { sessionId, pairingCode, phoneNumber } = job.data;

    try {
      await job.updateProgress(20);

      // Verify session exists
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      await job.updateProgress(40);

      // Check if session is already paired
      if (session.status === 'paired') {
        return {
          success: true,
          data: { message: 'Session already paired' },
          authState: 'authenticated',
          phoneNumber: session.phone || undefined,
          timestamp: Date.now(),
        };
      }

      await job.updateProgress(50);

      // Verify there's an active connection for this session
      const connection = this.connectionManager.getConnection(sessionId);
      if (!connection) {
        throw new Error(`No active connection found for session ${sessionId}`);
      }

      await job.updateProgress(60);

      // Wait for pairing completion with better error handling
      let isPaired = false;
      let attempts = 0;
      const maxAttempts = 60; // 60 seconds timeout for pairing
      const retryInterval = 1000; // Check every second

      console.log(
        `Starting pairing verification for session ${sessionId}, waiting up to ${maxAttempts} seconds...`,
      );

      while (!isPaired && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
        attempts++;

        // Check session status
        const updatedSession = await this.sessionService.getSessionById(sessionId);
        if (updatedSession?.status === 'paired') {
          isPaired = true;
          console.log(`Session ${sessionId} successfully paired after ${attempts} seconds`);
          break;
        }

        // Check if connection is still active
        const currentConnection = this.connectionManager.getConnection(sessionId);
        if (!currentConnection) {
          throw new Error(`Connection lost during pairing verification for session ${sessionId}`);
        }

        // Update progress
        await job.updateProgress(60 + attempts * 0.6); // Progress from 60% to 96%
      }

      if (!isPaired) {
        console.error(
          `Pairing verification timeout for session ${sessionId} after ${maxAttempts} seconds`,
        );

        // Clean up on timeout
        await this.cleanupFailedQRSession(sessionId);

        throw new Error(`Pairing verification timeout after ${maxAttempts} seconds`);
      }

      await job.updateProgress(100);

      // Get final session state
      const finalSession = await this.sessionService.getSessionById(sessionId);

      return {
        success: true,
        data: {
          message: 'Session paired successfully',
          phone: finalSession?.phone,
          name: finalSession?.name,
        },
        authState: 'authenticated',
        phoneNumber: finalSession?.phone || undefined,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Pairing verification failed for session ${sessionId}:`, error);

      // Clean up on any error
      await this.cleanupFailedQRSession(sessionId);

      return this.createErrorResult(error);
    }
  }

  /**
   * Handle auth state validation
   */
  private async handleAuthValidation(job: Job<AuthValidationJobData>): Promise<AuthJobResult> {
    const { sessionId, userId } = job.data;

    try {
      await job.updateProgress(10);

      // Check session exists
      const session = await this.sessionService.getSessionById(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.userId !== userId) {
        throw new Error(`Session ${sessionId} does not belong to user ${userId}`);
      }

      await job.updateProgress(25);

      // Validate auth state in database
      const isValid = await hasValidAuth(sessionId, this.db);

      await job.updateProgress(40);

      // Test actual connection - create if doesn't exist, or check existing one
      let connection = this.connectionManager.getConnection(sessionId);
      let isConnected = false;
      let connectionState = 'disconnected';
      let connectionError: string | undefined;

      try {
        if (!connection) {
          console.log(`Creating new connection for auth validation: ${sessionId}`);
          // Create new connection for testing
          connection = await this.connectionManager.createConnection(sessionId, userId);
          await job.updateProgress(70);
        } else {
          await job.updateProgress(60);
        }

        // Test if connection is working
        isConnected = connection.isConnected();
        connectionState = connection.getConnectionState();

        // If connection exists but isn't connected, it might be in a failed state
        if (!isConnected && connectionState === 'failed') {
          connectionError = 'Connection failed - authentication may be invalid';
        } else if (!isConnected && connectionState === 'disconnected') {
          connectionError = 'Connection disconnected - may need to reconnect';
        }

        await job.updateProgress(85);

        // Update session status based on connection test
        if (isConnected && session.status !== 'paired') {
          await this.sessionService.updateSession(sessionId, { status: 'paired' });
        } else if (!isConnected && session.status === 'paired') {
          // Don't automatically change status - connection might be temporarily down
          console.log(`Session ${sessionId} marked as paired but connection not working`);
        }
      } catch (error) {
        console.error(`Connection test failed for session ${sessionId}:`, error);
        connectionError = error instanceof Error ? error.message : 'Connection test failed';
        connectionState = 'failed';
      }

      await job.updateProgress(100);

      const authState = isValid && isConnected ? 'authenticated' : 'unauthenticated';

      return {
        success: true,
        data: {
          isValid,
          isConnected,
          sessionStatus: session.status,
          connectionState,
          connectionError,
          testPerformed: true,
        },
        authState,
        phoneNumber: session.phone || undefined,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Auth validation failed for session ${sessionId}:`, error);
      return this.createErrorResult(error);
    }
  }

  /**
   * Handle logout and session cleanup
   */
  private async handleLogout(job: Job<LogoutJobData>): Promise<AuthJobResult> {
    const { sessionId, reason } = job.data;

    try {
      await job.updateProgress(20);

      // Logout and remove connection if exists
      const connection = this.connectionManager.getConnection(sessionId);
      if (connection) {
        await this.connectionManager.logoutConnection(sessionId);
      }

      await job.updateProgress(50);

      // Update session status (auth state is already cleared by logoutConnection)
      await this.sessionService.updateSession(sessionId, {
        status: 'not_auth',
        phone: undefined,
        name: undefined,
        qrCode: null,
        qrExpiresAt: null,
      });

      await job.updateProgress(100);

      return {
        success: true,
        data: {
          message: 'Session logged out successfully',
          reason: reason || 'Manual logout',
        },
        authState: 'unauthenticated',
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`Logout failed for session ${sessionId}:`, error);
      return this.createErrorResult(error);
    }
  }
}

// Export singleton instance
export const authWorker = new AuthWorker({
  connectionManager: whatsappConnectionManager,
  sessionService: whatsappSessionService,
  database: db,
});
