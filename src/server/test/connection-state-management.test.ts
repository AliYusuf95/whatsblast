// Connection State Management Test
// Tests the new separate connection state management

import { test, expect, describe, beforeEach, afterEach, mock } from 'bun:test';
import {
  WhatsAppConnection,
  WhatsAppConnectionState,
} from '../services/whatsapp/connection-manager';
import { initTestDatabase } from './setup';
import { WhatsAppSessionService } from '../services/whatsapp/session-service';

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

describe('Connection State Management', () => {
  let db: Awaited<ReturnType<typeof initTestDatabase>>['db'];
  let cleanupDb: () => void;
  let sessionService: WhatsAppSessionService;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    db = dbSetup.db;
    cleanupDb = dbSetup.cleanup;
    sessionService = new WhatsAppSessionService(db);
  });

  afterEach(async () => {
    cleanupDb();
  });

  test('should initialize with DISCONNECTED state', () => {
    const connection = new WhatsAppConnection({
      sessionId: 'test-session',
      userId: 'test-user',
      whatsappSessionService: sessionService,
      database: db,
    });

    expect(connection.getConnectionState()).toBe(WhatsAppConnectionState.DISCONNECTED);
    expect(connection.isConnected()).toBe(false);
  });

  test('should emit state change events', async () => {
    const connection = new WhatsAppConnection({
      sessionId: 'test-session',
      userId: 'test-user',
      whatsappSessionService: sessionService,
      database: db,
    });

    let stateChanges: any[] = [];
    connection.on('state.changed', (sessionId, newState, oldState, reason) => {
      stateChanges.push({ sessionId, newState, oldState, reason });
    });

    // Test state change by using forceClose which should emit an event
    connection.forceClose();

    expect(stateChanges.length).toBeGreaterThan(0);
    expect(stateChanges[0].oldState).toBe(WhatsAppConnectionState.DISCONNECTED);
    expect(stateChanges[0].newState).toBe(WhatsAppConnectionState.DESTROYED);
    expect(stateChanges[0].sessionId).toBe('test-session');
  });

  test('should track state independently of socket', () => {
    const connection = new WhatsAppConnection({
      sessionId: 'test-session',
      userId: 'test-user',
      whatsappSessionService: sessionService,
      database: db,
    });

    // State should be DISCONNECTED even though socket is null
    expect(connection.getConnectionState()).toBe(WhatsAppConnectionState.DISCONNECTED);
    expect(connection.isConnected()).toBe(false);

    // Force close should change state to DESTROYED
    connection.forceClose();
    expect(connection.getConnectionState()).toBe(WhatsAppConnectionState.DESTROYED);
  });

  test('should prevent message sending when not authenticated', async () => {
    const connection = new WhatsAppConnection({
      sessionId: 'test-session',
      userId: 'test-user',
      whatsappSessionService: sessionService,
      database: db,
    });

    // Should throw error when trying to send message in DISCONNECTED state
    await expect(connection.sendMessage('test@c.us', 'test message')).rejects.toThrow(
      'Connection not ready. Current state: disconnected',
    );
  });
});
