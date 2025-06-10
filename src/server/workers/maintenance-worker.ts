// Maintenance Workers for WhatsApp
// Simplified to focus on connection health and automatic cleanup

import { Job } from 'bullmq';
import { BaseWorker } from './base-worker';
import { QUEUE_NAMES } from '../queue/config';
import type {
  MaintenanceJobData,
  ConnectionCheckJobData,
  MaintenanceJobResult,
  JobResult,
} from '../queue/job-types';
import { whatsappConnectionManager } from '../services/whatsapp/connection-manager';
import { whatsappSessionService } from '../services/whatsapp/session-service';
import { hasValidAuth, clearAuthState } from '../services/whatsapp/auth-state';
import { db } from '../db';
import dayjs from 'dayjs';

/**
 * Dependencies interface for MaintenanceWorker
 */
interface MaintenanceWorkerDependencies {
  whatsappConnectionManager: typeof whatsappConnectionManager;
  whatsappSessionService: typeof whatsappSessionService;
  database: typeof db;
}

/**
 * Simplified Maintenance Worker
 * Single operation: Check connection health and cleanup invalid sessions
 */
export class MaintenanceWorker extends BaseWorker<MaintenanceJobData> {
  // Services - injected via constructor
  protected whatsappConnectionManager: typeof whatsappConnectionManager;
  protected whatsappSessionService: typeof whatsappSessionService;
  protected database: typeof db;

  constructor(dependencies: MaintenanceWorkerDependencies) {
    super(
      QUEUE_NAMES.WHATSAPP_MAINTENANCE,
      1, // Low concurrency for maintenance operations
      10, // 10 maintenance jobs per minute max
      60000, // 1 minute rate limit window
    );

    // Use provided dependencies or defaults
    this.whatsappConnectionManager = dependencies.whatsappConnectionManager;
    this.whatsappSessionService = dependencies.whatsappSessionService;
    this.database = dependencies.database;
  }

  async processJob(job: Job<MaintenanceJobData, JobResult>): Promise<MaintenanceJobResult> {
    // Custom validation for maintenance jobs - sessionId is optional
    this.validateMaintenanceJobData(job.data);

    const { type } = job.data;

    switch (type) {
      case 'connection_health_check':
        return await this.handleConnectionHealthCheck(job as Job<ConnectionCheckJobData>);

      default:
        throw new Error(`Unknown maintenance job type: ${type}`);
    }
  }

  /**
   * Custom validation for maintenance jobs
   */
  private validateMaintenanceJobData(data: MaintenanceJobData): void {
    if (!data.type) {
      throw new Error('Job data must include type');
    }

    if (!data.timestamp) {
      throw new Error('Job data must include timestamp');
    }
  }

  /**
   * Main operation: Check connections and cleanup invalid ones
   * This replaces the 3 separate operations with one comprehensive check
   */
  private async handleConnectionHealthCheck(
    job: Job<ConnectionCheckJobData>,
  ): Promise<MaintenanceJobResult> {
    const { inactiveHoursThreshold = 24, checkAllSessions = false, sessionId } = job.data;

    try {
      await job.updateProgress(10);

      let sessionsToCheck: any[] = [];

      if (sessionId) {
        // Check specific session
        const session = await this.whatsappSessionService.getSessionById(sessionId);
        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }
        sessionsToCheck = [session];
      } else if (checkAllSessions) {
        // Check all paired sessions
        sessionsToCheck = await this.whatsappSessionService.getSessionsByStatus('paired');
      } else {
        // Check only inactive sessions (default behavior)
        sessionsToCheck =
          await this.whatsappSessionService.getInactiveSessions(inactiveHoursThreshold);
      }

      await job.updateProgress(30);

      let healthyCount = 0;
      let reconnectedCount = 0;
      let cleanedUpCount = 0;
      const results: Array<{ sessionId: string; status: string; action: string }> = [];

      for (const session of sessionsToCheck) {
        try {
          const result = await this.checkAndFixSession(session);
          results.push(result);

          switch (result.status) {
            case 'healthy':
              healthyCount++;
              break;
            case 'reconnected':
              reconnectedCount++;
              break;
            case 'cleaned_up':
              cleanedUpCount++;
              break;
          }
        } catch (error) {
          console.error(`Failed to check session ${session.id}:`, error);
          results.push({
            sessionId: session.id,
            status: 'error',
            action: `Error: ${error.message}`,
          });
        }
      }

      await job.updateProgress(90);

      // Clean up expired QR codes while we're at it
      await this.cleanupExpiredQRCodes();

      await job.updateProgress(100);

      return {
        success: true,
        data: {
          totalChecked: sessionsToCheck.length,
          healthyCount,
          reconnectedCount,
          cleanedUpCount,
          results,
          checkedAt: Date.now(),
        },
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Connection health check failed:', error);
      return this.createErrorResult(error) as MaintenanceJobResult;
    }
  }

  /**
   * Check a single session and take appropriate action
   */
  private async checkAndFixSession(
    session: any,
  ): Promise<{ sessionId: string; status: string; action: string }> {
    const sessionId = session.id;

    // 1. Check if auth is still valid
    const hasValidCredentials = await hasValidAuth(sessionId, this.database);

    if (!hasValidCredentials) {
      // Auth is invalid - clean up the session
      await clearAuthState(sessionId, this.database);
      await this.whatsappConnectionManager.removeConnection(sessionId);
      await this.whatsappSessionService.updateSession(sessionId, {
        status: 'not_auth',
        phone: undefined,
        name: undefined,
        qrCode: null,
      });

      return {
        sessionId,
        status: 'cleaned_up',
        action: 'Removed invalid auth credentials',
      };
    }

    // 2. Check connection status
    const connection = this.whatsappConnectionManager.getConnection(sessionId);

    if (!connection) {
      // No connection exists - try to create one
      try {
        await this.whatsappConnectionManager.createConnection(sessionId, session.userId);
        await this.whatsappSessionService.updateLastUsed(sessionId);

        return {
          sessionId,
          status: 'reconnected',
          action: 'Created new connection',
        };
      } catch (error) {
        // Failed to reconnect - mark as problematic but don't remove yet
        return {
          sessionId,
          status: 'unhealthy',
          action: `Failed to reconnect: ${error.message}`,
        };
      }
    } else if (!connection.isConnected()) {
      // Connection exists but not connected - try to reconnect
      try {
        await connection.connect();
        await this.whatsappSessionService.updateLastUsed(sessionId);

        return {
          sessionId,
          status: 'reconnected',
          action: 'Reconnected existing connection',
        };
      } catch (error) {
        return {
          sessionId,
          status: 'unhealthy',
          action: `Failed to reconnect: ${error.message}`,
        };
      }
    } else {
      // Connection is healthy
      await this.whatsappSessionService.updateLastUsed(sessionId);

      return {
        sessionId,
        status: 'healthy',
        action: 'Connection is active',
      };
    }
  }

  /**
   * Clean up expired QR codes (simple housekeeping)
   */
  private async cleanupExpiredQRCodes(): Promise<number> {
    try {
      const now = new Date();
      const expiredSessions = await this.whatsappSessionService.getSessionsByStatus('qr_pairing');

      let cleanedCount = 0;
      for (const session of expiredSessions) {
        if (session.qrExpiresAt && dayjs().isAfter(session.qrExpiresAt)) {
          await this.whatsappSessionService.updateSession(session.id, {
            qrCode: null,
            qrExpiresAt: null,
          });
          cleanedCount++;
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup expired QR codes:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const maintenanceWorker = new MaintenanceWorker({
  whatsappConnectionManager,
  whatsappSessionService,
  database: db,
});
