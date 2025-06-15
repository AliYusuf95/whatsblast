import { db } from '../../db';
import { whatsappSessions, type SessionStatus } from '../../db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { clearAuthState, hasValidAuth } from './auth-state';
import dayjs from 'dayjs';
import type { SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';

/**
 * WhatsApp Session Service
 *
 * Manages WhatsApp session lifecycle and state management
 * Handles session CRUD operations and state transitions
 */

export interface WhatsAppSession {
  id: string;
  userId: string;
  description: string;
  status: SessionStatus;
  phone?: string | null;
  name?: string | null;
  qrCode?: string | null;
  qrExpiresAt?: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  description: string;
}

export type UpdateSessionInput = SQLiteUpdateSetSource<typeof whatsappSessions>;

export class WhatsAppSessionService {
  private db: typeof db;

  constructor(database: typeof db) {
    this.db = database;
  }

  /**
   * Create a new WhatsApp session
   */
  async createSession(input: CreateSessionInput): Promise<WhatsAppSession> {
    try {
      const now = new Date();
      const sessionData = {
        id: createId(),
        userId: input.userId,
        description: input.description,
        status: 'not_auth' as SessionStatus,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const [session] = await this.db.insert(whatsappSessions).values(sessionData).returning();

      return session;
    } catch (error) {
      console.error('Failed to create WhatsApp session:', error);
      throw new Error('Failed to create session');
    }
  }

  /**
   * Get session by ID
   */
  async getSessionById(sessionId: string): Promise<WhatsAppSession | null> {
    try {
      const [session] = await this.db
        .select()
        .from(whatsappSessions)
        .where(eq(whatsappSessions.id, sessionId))
        .limit(1);

      return session || null;
    } catch (error) {
      console.error(`Failed to get session ${sessionId}:`, error);
      throw new Error('Failed to get session');
    }
  }

  /**
   * Get all sessions for a user
   */
  async getSessionsByUserId(userId: string): Promise<WhatsAppSession[]> {
    try {
      const sessions = await this.db
        .select()
        .from(whatsappSessions)
        .where(eq(whatsappSessions.userId, userId))
        .orderBy(whatsappSessions.createdAt);

      return sessions;
    } catch (error) {
      console.error(`Failed to get sessions for user ${userId}:`, error);
      throw new Error('Failed to get user sessions');
    }
  }

  /**
   * Get sessions by status
   */
  async getSessionsByStatus(status: SessionStatus): Promise<WhatsAppSession[]> {
    try {
      const sessions = await this.db
        .select()
        .from(whatsappSessions)
        .where(eq(whatsappSessions.status, status));

      return sessions;
    } catch (error) {
      console.error(`Failed to get sessions with status ${status}:`, error);
      return [];
    }
  }

  /**
   * Update session
   */
  async updateSession(
    sessionId: string,
    input: UpdateSessionInput,
  ): Promise<WhatsAppSession | null> {
    try {
      const updateData = {
        ...input,
        updatedAt: new Date(),
      };

      const [updatedSession] = await this.db
        .update(whatsappSessions)
        .set(updateData)
        .where(eq(whatsappSessions.id, sessionId))
        .returning();

      return updatedSession || null;
    } catch (error) {
      console.error(`Failed to update session ${sessionId}:`, error);
      throw new Error('Failed to update session');
    }
  }

  /**
   * Delete session and cleanup auth data
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      // Clear auth state first
      await clearAuthState(sessionId, this.db);

      // Delete session record
      const result = await this.db
        .delete(whatsappSessions)
        .where(eq(whatsappSessions.id, sessionId));

      return true;
    } catch (error) {
      console.error(`Failed to delete session ${sessionId}:`, error);
      throw new Error('Failed to delete session');
    }
  }

  /**
   * Update session's last used timestamp
   */
  async updateLastUsed(sessionId: string): Promise<void> {
    try {
      const now = new Date();
      await this.db
        .update(whatsappSessions)
        .set({
          lastUsedAt: now,
          updatedAt: now,
        })
        .where(eq(whatsappSessions.id, sessionId));
    } catch (error) {
      console.error(`Failed to update last used for session ${sessionId}:`, error);
      // Don't throw error for this operation
    }
  }

  /**
   * Set QR code for session
   */
  async setQRCode(sessionId: string, qrCode: string, expiresAt: Date): Promise<void> {
    try {
      const updatedSession = await this.updateSession(sessionId, {
        status: 'qr_pairing',
        qrCode,
        qrExpiresAt: expiresAt,
      });

      if (!updatedSession) {
        throw new Error(`Session ${sessionId} not found`);
      }
    } catch (error) {
      console.error(`Failed to set QR code for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Clear QR code from session
   */
  async clearQRCode(sessionId: string): Promise<void> {
    try {
      await this.updateSession(sessionId, {
        qrCode: null,
        qrExpiresAt: null,
      });
    } catch (error) {
      console.error(`Failed to clear QR code for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Mark session as paired with WhatsApp info
   */
  async markAsPaired(sessionId: string, phone: string, name: string): Promise<void> {
    try {
      await this.updateSession(sessionId, {
        status: 'paired',
        phone,
        name,
        qrCode: null,
        qrExpiresAt: null,
      });
    } catch (error) {
      console.error(`Failed to mark session ${sessionId} as paired:`, error);
      throw error;
    }
  }

  /**
   * Check if session has valid authentication
   */
  async hasValidAuth(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSessionById(sessionId);
      if (!session || session.status !== 'paired') {
        return false;
      }

      return await hasValidAuth(sessionId, this.db);
    } catch (error) {
      console.error(`Failed to check auth for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get sessions that haven't been used for more than 24 hours
   * Used for maintenance worker
   */
  async getInactiveSessions(hoursThreshold: number = 24): Promise<WhatsAppSession[]> {
    try {
      const thresholdDate = dayjs().subtract(hoursThreshold, 'hour').toDate();

      const sessions = await this.db
        .select()
        .from(whatsappSessions)
        .where(
          and(
            eq(whatsappSessions.status, 'paired'),
            lte(whatsappSessions.lastUsedAt, thresholdDate),
          ),
        );

      // Filter sessions older than threshold (SQLite doesn't have good date comparison)
      return sessions;
    } catch (error) {
      console.error('Failed to get inactive sessions:', error);
      return [];
    }
  }
}

// Export singleton instance
export const whatsappSessionService = new WhatsAppSessionService(db);
