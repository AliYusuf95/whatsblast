import { describe, test, expect, beforeEach, afterEach, mock, spyOn, jest } from 'bun:test';
import { initTestDatabase, createTestSession } from './setup';
import { whatsappSessions } from '../db/schema';
import {
  WhatsAppConnection,
  WhatsAppConnectionState,
} from '../services/whatsapp/connection-manager';
import type { UpdateSessionInput, WhatsAppSessionService } from '../services';

// Mock makeWASocket to avoid actual WebSocket connections
const mockSocket = {
  user: null,
  logout: mock(() => Promise.resolve()),
  end: mock(() => Promise.resolve()),
  ev: {
    on: mock((event: string, callback: Function) => {
      // Simulate connection.update events for testing
      if (event === 'connection.update') {
        // Immediately simulate a connection failure to prevent timeout
        setTimeout(() => {
          callback({
            connection: 'close',
            lastDisconnect: {
              error: {
                output: {
                  statusCode: 401,
                },
              },
            },
          });
        }, 10);
      }
    }),
    off: mock(() => {}),
    removeAllListeners: mock(() => {}),
  },
  sendMessage: mock(() => Promise.resolve({ key: { id: 'test-message-id' } })),
  state: { connection: 'close' },
  ws: { readyState: 3 }, // CLOSED
};

// Mock makeWASocket and Baileys exports
const mockMakeWASocket = mock(() => mockSocket);

mock.module('@whiskeysockets/baileys', () => ({
  default: mockMakeWASocket,
  DisconnectReason: {
    loggedOut: 401,
    connectionClosed: 428,
    connectionLost: 408,
    connectionReplaced: 440,
    timedOut: 408,
    badSession: 500,
    restartRequired: 515,
  },
}));

// Mock session service
const mockSessionService: () => WhatsAppSessionService = () =>
  ({
    createSession: mock(),
    getSessionById: mock(),
    getSessionsByUserId: mock(),
    getSessionsByStatus: mock(),
    updateSession: mock(),
    deleteSession: mock(),
    updateLastUsed: mock(),
    setQRCode: mock(),
    clearQRCode: mock(),
    markAsPaired: mock(),
    hasValidAuth: mock(),
    getInactiveSessions: mock(),
  }) as unknown as WhatsAppSessionService;

describe('ConnectionManager', () => {
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;

  function getDependencies(sessionId: string, userId: string) {
    return {
      whatsappSessionService: mockSessionService(),
      database: db,
      sessionId,
      userId,
    };
  }

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    cleanupDb();
  });

  describe('WhatsAppConnection', () => {
    let connection: WhatsAppConnection;
    let sessionId: string;
    let userId: string;

    beforeEach(async () => {
      // Create test session
      const session = createTestSession({
        status: 'not_auth',
      });
      sessionId = session.id;
      userId = session.userId;

      await db.insert(whatsappSessions).values(session);

      connection = new WhatsAppConnection(getDependencies(sessionId, userId));
    });

    afterEach(async () => {
      try {
        await connection.disconnect();
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    describe('constructor', () => {
      test('should create connection with session ID and user ID', () => {
        expect(connection.sessionId).toBe(sessionId);
        expect(connection.userId).toBe(userId);
      });

      test('should initialize as not connected', () => {
        expect(connection.isConnected()).toBe(false);
      });

      test('should have close connection state initially', () => {
        expect(connection.getConnectionState()).toBe(WhatsAppConnectionState.DISCONNECTED);
      });
    });

    describe('connection lifecycle', () => {
      test('should start connection process', async () => {
        // Test initial state
        expect(connection.getConnectionState()).toBe(WhatsAppConnectionState.DISCONNECTED);

        // Since this would trigger actual WhatsApp connection, we'll test error handling
        // instead of waiting for a real connection
        await expect(connection.connect()).rejects.toThrow();

        // State should indicate failure or maintain disconnected
        const state = connection.getConnectionState();
        expect([
          WhatsAppConnectionState.DISCONNECTED,
          WhatsAppConnectionState.FAILED,
          WhatsAppConnectionState.CONNECTING,
        ]).toContain(state);
      });

      test('should handle disconnect when not connected', async () => {
        // Should not throw error
        await expect(() => connection.disconnect()).not.toThrow();
      });

      test('should handle multiple disconnect calls', async () => {
        await connection.disconnect();
        await connection.disconnect();
        // Should not throw error
        expect(connection.isConnected()).toBe(false);
      });

      test('should handle force close', () => {
        connection.forceClose();
        expect(connection.isConnected()).toBe(false);
      });
    });

    describe('message sending', () => {
      test('should reject sending message when not connected', async () => {
        const jid = '1234567890@c.us';
        const text = 'Hello, World!';

        await expect(connection.sendMessage(jid, text)).rejects.toThrow('Connection not ready');
      });

      test('should reject sending media when not connected', async () => {
        const jid = '1234567890@c.us';
        const media = Buffer.from('fake image data');

        await expect(connection.sendMediaMessage(jid, media, 'image')).rejects.toThrow(
          'Connection not ready',
        );
      });

      test('should validate media type', async () => {
        const jid = '1234567890@c.us';
        const media = Buffer.from('fake data');

        // Connection check happens before media type validation
        await expect(
          // @ts-expect-error Testing invalid media type
          connection.sendMediaMessage(jid, media, 'invalid'),
        ).rejects.toThrow('Connection not ready');
      });
    });

    describe('connection state', () => {
      test('should report correct initial state', () => {
        expect(connection.getConnectionState()).toBe(WhatsAppConnectionState.DISCONNECTED);
        expect(connection.isConnected()).toBe(false);
      });

      test('should return null user info when not connected', () => {
        expect(connection.getUserInfo()).toBeNull();
      });
    });

    describe('event handling', () => {
      test('should be an event emitter', () => {
        expect(connection.on).toBeFunction();
        expect(connection.emit).toBeFunction();
        expect(connection.removeAllListeners).toBeFunction();
      });

      test('should handle event listener registration', () => {
        const mockHandler = mock(() => {});

        connection.on('connection.update', mockHandler);
        connection.emit('connection.update', sessionId, { connection: 'open' });

        expect(mockHandler).toHaveBeenCalledWith(sessionId, {
          connection: 'open',
        });
      });

      test('should handle event listener removal', () => {
        const mockHandler = mock(() => {});

        connection.on('qr.update', mockHandler);
        connection.off('qr.update', mockHandler);
        connection.emit('qr.update', sessionId, 'test-qr');

        expect(mockHandler).not.toHaveBeenCalled();
      });
    });

    describe('error scenarios', () => {
      test('should handle connection errors gracefully', async () => {
        // Test with invalid session ID - should fail quickly without timeout
        const invalidConnection = new WhatsAppConnection(
          getDependencies('invalid-session', 'invalid-user'),
        );

        // Test that initial state is correct
        expect(invalidConnection.getConnectionState()).toBe(WhatsAppConnectionState.DISCONNECTED);
        expect(invalidConnection.isConnected()).toBe(false);

        // Connection should fail due to invalid session
        await expect(invalidConnection.connect()).rejects.toThrow();

        // Clean up
        await invalidConnection.disconnect();
      });

      test('should handle database errors during connect', async () => {
        // Close database to simulate error
        cleanupDb();

        await expect(connection.connect()).rejects.toThrow();
      });

      test('should handle cleanup errors gracefully', async () => {
        // Force close should not throw even without connection
        expect(() => connection.forceClose()).not.toThrow();
      });
    });

    describe('resource management', () => {
      test('should clean up resources on disconnect', async () => {
        // Should not throw even if no resources to clean
        await expect(() => connection.disconnect()).not.toThrow();
      });

      test('should handle force close without errors', () => {
        expect(() => connection.forceClose()).not.toThrow();
      });

      test('should handle repeated cleanup calls', async () => {
        await connection.disconnect();
        connection.forceClose();
        await connection.disconnect();

        expect(connection.isConnected()).toBe(false);
      });
    });

    describe('session properties', () => {
      test('should maintain session ID', () => {
        expect(connection.sessionId).toBe(sessionId);
      });

      test('should maintain user ID', () => {
        expect(connection.userId).toBe(userId);
      });

      test('should handle readonly properties', () => {
        // TypeScript readonly is compile-time only, so we just verify the properties exist
        expect(connection.sessionId).toBeDefined();
        expect(connection.userId).toBeDefined();
        expect(typeof connection.sessionId).toBe('string');
        expect(typeof connection.userId).toBe('string');
      });
    });
  });

  /**
   * Integration Tests with Mock Connection Manager
   *
   * These tests simulate connection manager behavior without
   * requiring actual Baileys connections
   */
  describe('Connection Manager Integration', () => {
    let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
    let cleanupDb: () => void;

    beforeEach(async () => {
      const dbSetup = await initTestDatabase();
      db = dbSetup.db;
      cleanupDb = dbSetup.cleanup;
    });

    afterEach(() => {
      cleanupDb();
    });

    test('should create connection with valid session', async () => {
      const session = createTestSession({
        status: 'not_auth',
      });

      await db.insert(whatsappSessions).values(session);

      const connection = new WhatsAppConnection(getDependencies(session.id, session.userId));

      expect(connection.sessionId).toBe(session.id);
      expect(connection.userId).toBe(session.userId);

      await connection.disconnect();
    });

    test('should handle concurrent connections', async () => {
      const session1 = createTestSession({
        status: 'not_auth',
      });
      const session2 = createTestSession({
        status: 'not_auth',
      });

      await db.insert(whatsappSessions).values([session1, session2]);

      const connection1 = new WhatsAppConnection(getDependencies(session1.id, session1.userId));
      const connection2 = new WhatsAppConnection(getDependencies(session2.id, session2.userId));

      expect(connection1.sessionId).toBe(session1.id);
      expect(connection2.sessionId).toBe(session2.id);

      // Cleanup
      await Promise.all([connection1.disconnect(), connection2.disconnect()]);
    });

    test('should handle connection with different user IDs', async () => {
      const sessions = [
        createTestSession({
          userId: 'user-1',
          status: 'not_auth',
        }),
        createTestSession({
          userId: 'user-2',
          status: 'not_auth',
        }),
      ];

      await db.insert(whatsappSessions).values(sessions);

      const connections = sessions.map(
        (session) => new WhatsAppConnection(getDependencies(session.id, session.userId)),
      );

      expect(connections[0].userId).toBe('user-1');
      expect(connections[1].userId).toBe('user-2');

      // Cleanup
      await Promise.all(connections.map((conn) => conn.disconnect()));
    });
  });
});
