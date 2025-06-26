import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  Browsers,
} from '@whiskeysockets/baileys';
import type {
  WASocket,
  ConnectionState,
  BaileysEventMap,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { clearAuthState, useDatabaseAuthState } from './auth-state';
import { whatsappSessionService } from './session-service';
import { EventEmitter } from 'events';
import { db } from '@/server/db';
import dayjs from 'dayjs';
import qrcode from 'qrcode';
import NodeCache from 'node-cache';
import type { ILogger } from '@whiskeysockets/baileys/lib/Utils/logger';

function logger(level: string, ctx?: unknown): ILogger {
  const message = (msg?: string, obj?: unknown): string => {
    const formattedObj = obj || ctx ? Object.assign({}, ctx, obj) : undefined;
    return msg
      ? `${msg} ${JSON.stringify(formattedObj)}`
      : formattedObj
        ? JSON.stringify(formattedObj)
        : '';
  };
  const levels = ['trace', 'debug', 'info', 'warn', 'error'] as const;
  const log = (_level: (typeof levels)[number]) => (obj: unknown, msg?: string) => {
    if (levels.indexOf(_level) >= levels.indexOf(level as any)) {
      console.log(levels.indexOf(_level), levels.indexOf(level as any));

      if (
        typeof msg === 'string' &&
        (msg.includes('failed to decrypt message') || msg.includes('stream errored out'))
      ) {
        return; // Skip logging decryption errors
      }

      const logMessage = message(msg, obj);
      if (logMessage) {
        console[_level](`${_level}:`, logMessage);
      }
    }
  };
  return {
    level,
    child: (obj: unknown) => logger(level, obj),
    trace: log('trace'),
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
}

/**
 * WhatsApp Connection Manager
 *
 * Manages individual WhatsApp connections using Baileys
 * Handles connection lifecycle, event management, and state synchronization
 */

export enum WhatsAppConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  WAITING_QR = 'waiting_qr',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  FAILED = 'failed',
  DESTROYED = 'destroyed',
}

export interface ConnectionEventData {
  sessionId: string;
  event: string;
  data?: any;
}

export interface WhatsAppConnectionEvents {
  'connection.update': (sessionId: string, state: Partial<ConnectionState>) => void;
  'qr.update': (sessionId: string, qr: string) => void;
  'session.paired': (sessionId: string, phone: string, name: string) => void;
  'session.disconnected': (sessionId: string, reason: string) => void;
  'connection.cleaned_up': (sessionId: string, reason: string) => void;
  'message.received': (sessionId: string, message: proto.IWebMessageInfo) => void;
  'message.sent': (sessionId: string, message: proto.IWebMessageInfo) => void;
}

interface WhatsAppConnectionDependencies {
  sessionId: string;
  userId: string;
  whatsappSessionService: typeof whatsappSessionService;
  database: typeof db;
}

export class WhatsAppConnection extends EventEmitter {
  private socket: WASocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 1 second
  private isDestroyed = false;
  private _connectionState: WhatsAppConnectionState = WhatsAppConnectionState.DISCONNECTED;
  public readonly sessionId: string;
  public readonly userId: string;
  private readonly whatsappSessionService: typeof whatsappSessionService;
  private readonly database: typeof db;
  private readonly PAIRING_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly CONNECTION_TIMEOUT = 60 * 1000; // 1 minute

  // Properties for unified connection waiting
  private connectionWaitResolve: (() => void) | null = null;
  private connectionWaitReject: ((error: Error) => void) | null = null;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private isQRSession = false;

  constructor(dependencies: WhatsAppConnectionDependencies) {
    super();
    this.sessionId = dependencies.sessionId;
    this.userId = dependencies.userId;
    this.whatsappSessionService = dependencies.whatsappSessionService;
    this.database = dependencies.database;
  }

  /**
   * Update connection state and emit events
   */
  private updateConnectionState(newState: WhatsAppConnectionState, reason?: string) {
    const oldState = this._connectionState;
    this._connectionState = newState;

    console.log(
      `Session ${this.sessionId} state changed: ${oldState} -> ${newState}${reason ? ` (${reason})` : ''}`,
    );

    this.emit('state.changed', this.sessionId, newState, oldState, reason);
  }

  /**
   * Initialize and start the WhatsApp connection
   */
  async connect(): Promise<void> {
    if (this.socket || this.isDestroyed) {
      throw new Error('Connection already exists or is destroyed');
    }

    try {
      this.updateConnectionState(WhatsAppConnectionState.CONNECTING, 'Starting connection');

      // Check if this is a QR session (not yet authenticated)
      const session = await this.whatsappSessionService.getSessionById(this.sessionId);
      this.isQRSession = session?.status === 'not_auth';

      // Get database-backed auth state
      const { state, saveCreds } = await useDatabaseAuthState(this.sessionId, this.database);

      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

      const groupCache = new NodeCache();
      // external map to store retry counts of messages when decryption/encryption fails
      // keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
      const msgRetryCounterCache = new NodeCache();

      // Create WhatsApp socket
      this.socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We'll handle QR codes via events
        browser: Browsers.windows('Desktop'),
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        msgRetryCounterCache,
        getMessage: async (key: WAMessageKey) => {
          // TODO: Implement message retrieval from database if needed
          return undefined;
        },
        cachedGroupMetadata: async (jid) => groupCache.get(jid),
        logger: logger('warn', { sessionId: this.sessionId }),
      });

      // Set up event handlers
      this.setupEventHandlers(saveCreds);

      console.log(
        `WhatsApp connection initialized for session ${this.sessionId} (QR session: ${this.isQRSession})`,
      );

      // Wait for connection to be established or fail
      console.log(`Waiting for session ${this.sessionId} to connect...`);

      if (this.isQRSession) {
        // For QR sessions, wait up to 5 minutes and don't fail on timeout
        await this.waitForConnection(this.PAIRING_TIMEOUT);
        console.log(`QR session ${this.sessionId} setup completed`);
      } else {
        // For authenticated sessions, use shorter timeout and fail on timeout
        await this.waitForConnection(this.CONNECTION_TIMEOUT);
        console.log(`Session ${this.sessionId} connected successfully`);
      }
    } catch (error) {
      console.error(`Failed to connect session ${this.sessionId}:`, error);
      this.updateConnectionState(
        WhatsAppConnectionState.FAILED,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw error;
    }
  }

  /**
   * Wait for connection to be established or timeout
   * Uses the unified event handler instead of registering a separate listener
   */
  private async waitForConnection(timeoutMs: number): Promise<void> {
    if (!this.socket) {
      throw new Error('Socket not initialized');
    }

    return new Promise<void>(async (resolve, reject) => {
      console.log(
        `Waiting for connection for session ${this.sessionId}`,
        JSON.stringify({
          isQRSession: this.isQRSession,
          currentState: this._connectionState,
          timeoutMs,
        }),
      );

      // Set appropriate waiting state
      if (this.isQRSession) {
        this.updateConnectionState(WhatsAppConnectionState.WAITING_QR, 'Waiting for QR scan');
      }

      // Set up connection wait promise resolvers
      if (!this.connectionWaitResolve || !this.connectionWaitReject) {
        this.connectionWaitResolve = resolve;
        this.connectionWaitReject = reject;
      }

      // Store timeout reference for cleanup
      this.connectionTimeout = setTimeout(async () => {
        // Clear wait resolvers to prevent race conditions
        this.connectionWaitResolve = null;
        this.connectionWaitReject = null;

        if (this.isQRSession) {
          // For QR sessions, timeout is not an error - clean up gracefully
          console.log(
            `QR session ${this.sessionId} timed out after ${timeoutMs}ms, cleaning up...`,
          );

          // Clear QR code and close connection
          try {
            await whatsappSessionService.clearQRCode(this.sessionId);
            this.forceClose();
          } catch (error) {
            console.error(`Error cleaning up QR session ${this.sessionId}:`, error);
          }

          // Resolve instead of reject for QR timeout
          resolve();
        } else {
          reject(
            new Error(`Connection timeout for session ${this.sessionId} after ${timeoutMs}ms`),
          );
        }
      }, timeoutMs);

      // Check if already connected (edge case)
      if (this.socket?.user) {
        console.log(
          `Session ${this.sessionId} already has user data, checking connection state...`,
        );
        // Don't resolve immediately, wait for proper 'open' event
      }
    });
  }

  /**
   * Setup all Baileys event handlers with unified logic for both normal and QR sessions
   */
  private setupEventHandlers(saveCreds: () => Promise<void>) {
    if (!this.socket) return;

    // Unified connection state handler
    this.socket.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(update);
    });

    // Save credentials when they change
    this.socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        await whatsappSessionService.updateLastUsed(this.sessionId);
      } catch (error) {
        console.error(`Failed to save credentials for session ${this.sessionId}:`, error);
      }
    });

    // Handle incoming messages
    this.socket.ev.on('messages.upsert', async (m) => {
      for (const message of m.messages) {
        if (m.type === 'notify') {
          this.emit('message.received', this.sessionId, message);
        }
      }
      await whatsappSessionService.updateLastUsed(this.sessionId);
    });

    // Handle message updates (sent, delivered, read)
    this.socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        // Handle message status updates if needed
        // console.log(`Message update for session ${this.sessionId}:`, update);
      }
    });

    // Handle chats updates
    this.socket.ev.on('chats.upsert', async (chats) => {
      // Handle new chats if needed
      await whatsappSessionService.updateLastUsed(this.sessionId);
    });

    // Handle contacts updates
    this.socket.ev.on('contacts.upsert', async (contacts) => {
      // Handle contacts updates if needed
      await whatsappSessionService.updateLastUsed(this.sessionId);
    });
  }

  /**
   * Unified connection update handler that intelligently handles both normal and QR sessions
   */
  private async handleConnectionUpdate(update: Partial<ConnectionState>) {
    const { connection, lastDisconnect, qr } = update;

    console.log(
      `Session ${this.sessionId} connection update:`,
      JSON.stringify({
        connection,
        qr: !!qr,
        currentState: this._connectionState,
        hasWaitResolver: !!this.connectionWaitResolve,
      }),
    );

    // Handle QR code generation (only for not_auth sessions)
    if (qr && this.isQRSession) {
      await this.handleQRCode(qr);
    }

    // Handle connection states with unified logic
    if (connection === 'close') {
      this.updateConnectionState(WhatsAppConnectionState.DISCONNECTED, 'Connection closed');

      // Handle waitForConnection promise for close events
      if (this.connectionWaitReject) {
        const reason = (lastDisconnect?.error as any)?.output?.statusCode || 'unknown';

        if (this.isQRSession) {
          // For QR sessions, 'close' during setup is normal behavior
          console.log(
            `QR session ${this.sessionId} closed during setup (reason: ${reason}), continuing to wait...`,
          );
          // Don't resolve/reject - keep waiting for QR scan or timeout
        } else {
          // For authenticated sessions, 'close' is a failure
          this.connectionWaitReject(
            new Error(`Connection failed for session ${this.sessionId}. Reason: ${reason}`),
          );
          this.clearConnectionWait();
        }
      }

      await this.handleDisconnection(lastDisconnect);
    } else if (connection === 'open') {
      this.updateConnectionState(WhatsAppConnectionState.AUTHENTICATED, 'Connection authenticated');

      // Handle waitForConnection promise for open events
      if (this.connectionWaitResolve) {
        this.connectionWaitResolve();
        this.clearConnectionWait();
      }

      this.isQRSession = false; // No longer a QR session
      await this.handleConnectionOpen();
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
    } else if (connection === 'connecting') {
      this.updateConnectionState(WhatsAppConnectionState.CONNECTING, 'Connecting to WhatsApp');
    }

    // Emit connection update event for external listeners
    this.emit('connection.update', this.sessionId, update);
  }

  /**
   * Handle QR code generation
   */
  private async handleQRCode(qr: string) {
    try {
      // Update state to indicate we're waiting for QR scan
      this.updateConnectionState(
        WhatsAppConnectionState.WAITING_QR,
        'QR code generated, waiting for scan',
      );

      const expiresAt = dayjs().add(this.PAIRING_TIMEOUT, 'milliseconds').toDate();

      const qrCodeDataURL = await qrcode.toDataURL(qr);
      await whatsappSessionService.setQRCode(this.sessionId, qrCodeDataURL, expiresAt);
      this.emit('qr.update', this.sessionId, qr);

      console.log(`QR code generated for session ${this.sessionId}`);
    } catch (error) {
      console.error(`Failed to handle QR code for session ${this.sessionId}:`, error);
    }
  }

  /**
   * Handle successful connection
   */
  private async handleConnectionOpen() {
    try {
      if (!this.socket?.user) {
        console.error(`No user data available for session ${this.sessionId}`);
        return;
      }

      const phone = this.socket.user.id.split(':')[0] || 'Unknown';
      const name = this.socket.user.name || this.socket.user.verifiedName || 'Unknown';

      await whatsappSessionService.markAsPaired(this.sessionId, phone, name);
      this.emit('session.paired', this.sessionId, phone, name);

      if (this.connectionWaitResolve) {
        this.connectionWaitResolve();
        this.clearConnectionWait();
      }

      console.log(`Session ${this.sessionId} successfully paired with ${phone} (${name})`);
    } catch (error) {
      console.error(`Failed to handle connection open for session ${this.sessionId}:`, error);
    }
  }

  /**
   * Handle connection disconnection with smart logic for QR vs normal sessions
   */
  private async handleDisconnection(lastDisconnect?: { error: Error | undefined; date: Date }) {
    try {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode === DisconnectReason.restartRequired;
      const reason = (lastDisconnect?.error as any)?.output?.statusCode || 'unknown';

      console.log(
        `Session ${this.sessionId} disconnected. Reason: ${reason}, Should reconnect: ${shouldReconnect}, Is QR session: ${this.isQRSession}`,
      );

      if (this.isQRSession && !shouldReconnect && this.connectionWaitReject) {
        // For QR sessions, we don't want to reconnect automatically
        this.updateConnectionState(WhatsAppConnectionState.DISCONNECTED, 'QR session disconnected');
        this.connectionWaitReject(
          new Error(`Connection failed for session ${this.sessionId}. Reason: ${reason}`),
        );
        this.clearConnectionWait();
      }

      if (reason === DisconnectReason.loggedOut) {
        // User logged out - clear session data
        await whatsappSessionService.updateSession(this.sessionId, {
          status: 'not_auth',
        });
        await whatsappSessionService.clearQRCode(this.sessionId);
        this.emit('session.disconnected', this.sessionId, 'logged_out');
      } else if (
        shouldReconnect &&
        this.reconnectAttempts < this.maxReconnectAttempts &&
        !this.isDestroyed
      ) {
        // Attempt to reconnect for authenticated sessions
        this.reconnectAttempts++;
        console.log(
          `Attempting to reconnect session ${this.sessionId} (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
        );

        setTimeout(() => {
          if (!this.isDestroyed) {
            this.reconnect();
          }
        }, this.reconnectDelay);
      } else {
        // Max reconnect attempts reached or should not reconnect
        this.emit('session.disconnected', this.sessionId, 'connection_failed');
      }
    } catch (error) {
      console.error(`Failed to handle disconnection for session ${this.sessionId}:`, error);
    }
  }

  /**
   * Reconnect the session
   */
  private async reconnect() {
    try {
      this.socket = null;
      this.updateConnectionState(WhatsAppConnectionState.CONNECTING, 'Reconnecting');
      await this.connect();
      console.log(`Session ${this.sessionId} successfully reconnected`);
    } catch (error) {
      console.error(`Failed to reconnect session ${this.sessionId}:`, error);
      this.updateConnectionState(WhatsAppConnectionState.FAILED, 'Reconnection failed');
      this.emit('session.disconnected', this.sessionId, 'reconnect_failed');
    }
  }

  /**
   * Send a text message
   */
  async sendMessage(jid: string, text: string): Promise<proto.WebMessageInfo | undefined> {
    if (!this.isConnected()) {
      throw new Error(`Connection not ready. Current state: ${this._connectionState}`);
    }

    if (!this.socket) {
      throw new Error('Socket not available');
    }

    try {
      const result = await this.socket.sendMessage(jid, { text });
      this.emit('message.sent', this.sessionId, result);
      await whatsappSessionService.updateLastUsed(this.sessionId);
      return result;
    } catch (error) {
      console.error(`Failed to send message from session ${this.sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Send a media message
   */
  async sendMediaMessage(
    jid: string,
    media: Buffer,
    mediaType: 'image' | 'video' | 'document',
    caption?: string,
    fileName?: string,
  ): Promise<proto.WebMessageInfo | undefined> {
    if (!this.isConnected()) {
      throw new Error(`Connection not ready. Current state: ${this._connectionState}`);
    }

    if (!this.socket) {
      throw new Error('Socket not available');
    }

    try {
      let messageContent: any;

      switch (mediaType) {
        case 'image':
          messageContent = { image: media, caption };
          break;
        case 'video':
          messageContent = { video: media, caption };
          break;
        case 'document':
          messageContent = { document: media, fileName, caption };
          break;
        default:
          throw new Error(`Unsupported media type: ${mediaType}`);
      }

      const result = await this.socket.sendMessage(jid, messageContent);
      this.emit('message.sent', this.sessionId, result);
      await whatsappSessionService.updateLastUsed(this.sessionId);
      return result;
    } catch (error) {
      console.error(`Failed to send media message from session ${this.sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get connection state
   */
  getConnectionState(): WhatsAppConnectionState {
    return this._connectionState;
  }

  /**
   * Check if connected and ready to send messages
   */
  isConnected(): boolean {
    return this._connectionState === WhatsAppConnectionState.AUTHENTICATED && !!this.socket;
  }

  /**
   * Get user info
   */
  getUserInfo() {
    return this.socket?.user || null;
  }

  /**
   * Disconnect and cleanup (without logout)
   */
  async disconnect(): Promise<void> {
    try {
      this.isDestroyed = true;
      this.updateConnectionState(WhatsAppConnectionState.DESTROYED, 'Disconnecting');

      // Clear any pending connection waits
      this.clearConnectionWait();

      if (this.socket) {
        // Close connection without logout
        if (this.socket.ws) {
          this.socket.ws.close();
        }
        this.socket = null;
      }

      this.removeAllListeners();
      console.log(`Session ${this.sessionId} disconnected and cleaned up`);
    } catch (error) {
      console.error(`Failed to disconnect session ${this.sessionId}:`, error);
    }
  }

  /**
   * Logout and clear auth state (for session deletion)
   */
  async logout(): Promise<void> {
    try {
      console.log(`Logging out session ${this.sessionId}`);

      if (this.socket) {
        await this.socket.logout();
      }

      // Clear auth state from database
      await clearAuthState(this.sessionId, this.database);

      console.log(`Session ${this.sessionId} logged out and auth state cleared`);
    } catch (error) {
      console.error(`Failed to logout session ${this.sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Force close connection without logout
   */
  forceClose(): void {
    this.isDestroyed = true;
    this.updateConnectionState(WhatsAppConnectionState.DESTROYED, 'Force closing');

    // Clear any pending connection waits
    this.clearConnectionWait();

    if (this.socket?.ws) {
      this.socket.ws.close();
    }

    this.socket = null;
    this.removeAllListeners();
    console.log(`Session ${this.sessionId} force closed`);
  }

  /**
   * Clear connection wait state and timeout
   */
  private clearConnectionWait() {
    if (this.connectionTimeout) {
      if (typeof this.connectionTimeout.close === 'function') {
        this.connectionTimeout.close();
      }
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    this.connectionWaitResolve = null;
    this.connectionWaitReject = null;
    this.isQRSession = false;
  }
}

interface WhatsAppConnectionManagerDependencies {
  whatsappSessionService: typeof whatsappSessionService;
  database: typeof db;
  // Optional configuration for connection cleanup
  inactivityTimeoutMs?: number; // Default: 30 minutes
  cleanupIntervalMs?: number; // Default: 5 minutes
}

/**
 * WhatsApp Connection Manager
 *
 * Manages multiple WhatsApp connections and provides a centralized interface
 * Automatically cleans up inactive connections to prevent memory leaks
 */
export class WhatsAppConnectionManager extends EventEmitter {
  private connections = new Map<string, WhatsAppConnection>();
  private readonly whatsappSessionService: typeof whatsappSessionService;
  private readonly database: typeof db;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private inactivityTimeoutMs: number;
  private cleanupIntervalMs: number;

  constructor(dependencies: WhatsAppConnectionManagerDependencies) {
    super();
    this.whatsappSessionService = dependencies.whatsappSessionService;
    this.database = dependencies.database;

    // Default: 30 minutes of inactivity before cleanup
    this.inactivityTimeoutMs = dependencies.inactivityTimeoutMs ?? 30 * 60 * 1000;
    // Default: check for inactive connections every 5 minutes
    this.cleanupIntervalMs = dependencies.cleanupIntervalMs ?? 5 * 60 * 1000;

    // Start the cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Start the automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.stopCleanupTimer();

    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveConnections().catch((error) => {
        console.error('Error during connection cleanup:', error);
      });
    }, this.cleanupIntervalMs);

    console.log(
      `WhatsApp connection cleanup timer started. Checking every ${this.cleanupIntervalMs / 1000}s for connections inactive for more than ${this.inactivityTimeoutMs / 1000}s`,
    );
  }

  /**
   * Stop the automatic cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      if (typeof this.cleanupTimer.close === 'function') {
        this.cleanupTimer.close();
      }
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up inactive connections
   */
  private async cleanupInactiveConnections(): Promise<void> {
    const now = dayjs();
    const connectionsToCleanup: string[] = [];

    for (const [sessionId, connection] of this.connections) {
      try {
        if (
          [WhatsAppConnectionState.WAITING_QR, WhatsAppConnectionState.CONNECTING].includes(
            connection.getConnectionState(),
          )
        ) {
          continue;
        }
        // Get session data to check last usage
        const session = await this.whatsappSessionService.getSessionById(sessionId);
        if (!session || !session.lastUsedAt) {
          // Session no longer exists, clean up connection
          connectionsToCleanup.push(sessionId);
          continue;
        }

        // Check if connection has been inactive using dayjs
        const lastUsedAt = dayjs(session.lastUsedAt);
        const inactiveTime = now.diff(lastUsedAt, 'millisecond');
        const inactiveTimeMinutes = now.diff(lastUsedAt, 'minute');

        if (inactiveTime > this.inactivityTimeoutMs) {
          console.log(
            `Connection ${sessionId} has been inactive for ${inactiveTimeMinutes} minutes, scheduling for cleanup`,
          );
          connectionsToCleanup.push(sessionId);
        }
      } catch (error) {
        console.error(`Error checking activity for connection ${sessionId}:`, error);
        // If we can't check the session, better to clean it up
        connectionsToCleanup.push(sessionId);
      }
    }

    // Clean up inactive connections
    for (const sessionId of connectionsToCleanup) {
      try {
        console.log(`Cleaning up inactive connection: ${sessionId}`);
        await this.removeConnection(sessionId);
        this.emit('connection.cleaned_up', sessionId, 'inactivity');
      } catch (error) {
        console.error(`Error cleaning up connection ${sessionId}:`, error);
      }
    }

    if (connectionsToCleanup.length > 0) {
      console.log(`Cleaned up ${connectionsToCleanup.length} inactive connections`);
    }
  }

  /**
   * Manually trigger cleanup of inactive connections
   */
  async cleanupNow(): Promise<number> {
    await this.cleanupInactiveConnections();
    return this.connections.size;
  }

  /**
   * Create and start a new WhatsApp connection
   */
  async createConnection(sessionId: string, userId: string): Promise<WhatsAppConnection> {
    // Check if connection already exists
    if (this.connections.has(sessionId)) {
      throw new Error(`Connection for session ${sessionId} already exists`);
    }

    // Validate session exists
    const session = await this.whatsappSessionService.getSessionById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.userId !== userId) {
      throw new Error(`Session ${sessionId} does not belong to user ${userId}`);
    }

    // Create connection
    const connection = new WhatsAppConnection({
      sessionId,
      userId,
      whatsappSessionService: this.whatsappSessionService,
      database: this.database,
    });

    // Forward events
    this.forwardConnectionEvents(connection);

    // Store connection
    this.connections.set(sessionId, connection);

    // Start connection
    try {
      await connection.connect();

      // For sessions that are already paired, verify the connection is actually ready
      if (session.status === 'paired') {
        // Extra verification for paired sessions
        let attempts = 0;
        while (!connection.isConnected() && attempts < 10) {
          console.log(
            `Waiting for paired session ${sessionId} to be ready... (attempt ${attempts + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;
        }

        if (!connection.isConnected()) {
          throw new Error(`Paired session ${sessionId} failed to become ready`);
        }
      }

      // Update last used timestamp since connection was successfully created/accessed
      await this.whatsappSessionService.updateLastUsed(sessionId);

      return connection;
    } catch (error) {
      // Remove failed connection
      this.connections.delete(sessionId);
      throw error;
    }
  }

  /**
   * Get existing connection
   */
  getConnection(sessionId: string): WhatsAppConnection | undefined {
    const connection = this.connections.get(sessionId);

    // Update last used timestamp when connection is accessed
    if (connection) {
      this.whatsappSessionService.updateLastUsed(sessionId).catch((error) => {
        console.error(`Failed to update last used for session ${sessionId}:`, error);
      });
    }

    return connection;
  }

  /**
   * Get all connections
   */
  getAllConnections(): WhatsAppConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connections for a specific user
   */
  getUserConnections(userId: string): WhatsAppConnection[] {
    return this.getAllConnections().filter((conn) => conn.userId === userId);
  }

  /**
   * Remove and disconnect a connection
   */
  async removeConnection(sessionId: string): Promise<void> {
    const connection = this.connections.get(sessionId);
    if (connection) {
      await connection.disconnect();
      this.connections.delete(sessionId);
    }
  }

  /**
   * Logout and remove a connection (for session deletion)
   */
  async logoutConnection(sessionId: string): Promise<void> {
    const connection = this.connections.get(sessionId);
    if (connection) {
      await connection.logout();
      await connection.disconnect();
      this.connections.delete(sessionId);
    }
  }

  /**
   * Remove all connections (for shutdown)
   */
  async removeAllConnections(): Promise<void> {
    // Stop the cleanup timer
    this.stopCleanupTimer();

    const disconnectPromises = Array.from(this.connections.values()).map((conn) =>
      conn.disconnect(),
    );

    await Promise.allSettled(disconnectPromises);
    this.connections.clear();
  }

  /**
   * Forward connection events to manager events
   */
  private forwardConnectionEvents(connection: WhatsAppConnection) {
    connection.on('connection.update', (sessionId, state) => {
      this.emit('connection.update', sessionId, state);
    });

    connection.on('qr.update', (sessionId, qr) => {
      this.emit('qr.update', sessionId, qr);
    });

    connection.on('session.paired', (sessionId, phone, name) => {
      this.emit('session.paired', sessionId, phone, name);
    });

    connection.on('session.disconnected', (sessionId, reason) => {
      this.emit('session.disconnected', sessionId, reason);
      // Clean up disconnected connection
      this.connections.delete(sessionId);
    });

    connection.on('message.received', (sessionId, message) => {
      this.emit('message.received', sessionId, message);
    });

    connection.on('message.sent', (sessionId, message) => {
      this.emit('message.sent', sessionId, message);
    });
  }

  /**
   * Health check - get status of all connections
   */
  getConnectionsStatus() {
    return Array.from(this.connections.entries()).map(([sessionId, connection]) => ({
      sessionId,
      userId: connection.userId,
      state: connection.getConnectionState(),
      isConnected: connection.isConnected(),
      userInfo: connection.getUserInfo(),
    }));
  }

  /**
   * Get connection statistics and cleanup info
   */
  getConnectionStats() {
    return {
      totalConnections: this.connections.size,
      inactivityTimeoutMs: this.inactivityTimeoutMs,
      cleanupIntervalMs: this.cleanupIntervalMs,
      cleanupTimerActive: !!this.cleanupTimer,
      connections: this.getConnectionsStatus(),
    };
  }

  /**
   * Update cleanup configuration
   */
  updateCleanupConfig(inactivityTimeoutMs?: number, cleanupIntervalMs?: number): void {
    if (inactivityTimeoutMs !== undefined) {
      this.inactivityTimeoutMs = inactivityTimeoutMs;
    }
    if (cleanupIntervalMs !== undefined) {
      this.cleanupIntervalMs = cleanupIntervalMs;
    }

    // Restart timer with new configuration
    this.startCleanupTimer();

    console.log(
      `Connection cleanup config updated: inactivity timeout=${this.inactivityTimeoutMs / 1000}s, cleanup interval=${this.cleanupIntervalMs / 1000}s`,
    );
  }

  /**
   * Graceful shutdown - cleanup all connections and timers
   */
  async shutdown(): Promise<void> {
    console.log('WhatsApp Connection Manager shutting down...');

    this.stopCleanupTimer();
    await this.removeAllConnections();

    console.log('WhatsApp Connection Manager shutdown complete');
  }
}

// Export singleton instance with default configuration
export const whatsappConnectionManager = new WhatsAppConnectionManager({
  whatsappSessionService,
  database: db,
  inactivityTimeoutMs: 30 * 60 * 1000, // 30 minutes
  cleanupIntervalMs: 5 * 60 * 1000, // 5 minutes
});
