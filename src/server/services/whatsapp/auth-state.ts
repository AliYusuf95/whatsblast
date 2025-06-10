import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { db } from '../../db';
import { authStates } from '../../db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Custom Auth State Implementation for Baileys
 *
 * Replaces useMultiFileAuthState with database-backed solution
 * Stores all authentication data securely in the database
 * Compatible with Baileys AuthenticationState interface
 */

export interface DatabaseAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

// Helper function to create database key
const createKey = (type: string, id: string): string => `${type}-${id}`;

// Helper function to write data to database
const writeData = async (
  sessionId: string,
  key: string,
  data: any,
  dbInstance: Omit<typeof db, '$client'>,
): Promise<void> => {
  if (data === null) {
    // Delete if data is null/undefined
    await dbInstance
      .delete(authStates)
      .where(and(eq(authStates.sessionId, sessionId), eq(authStates.key, key)));
  } else {
    const value = JSON.stringify(data, BufferJSON.replacer);
    // Upsert data
    await dbInstance
      .insert(authStates)
      .values({
        sessionId,
        key,
        value,
      })
      .onConflictDoUpdate({
        target: [authStates.sessionId, authStates.key],
        set: {
          value,
          updatedAt: new Date(),
        },
      });
  }
};

// Helper function to read data from database
const readData = async (
  sessionId: string,
  key: string,
  dbInstance: Omit<typeof db, '$client'>,
): Promise<any> => {
  const record = await dbInstance.query.authStates.findFirst({
    where: and(eq(authStates.sessionId, sessionId), eq(authStates.key, key)),
    columns: {
      value: true,
    },
  });
  if (!record) {
    return null;
  }
  return record.value ? JSON.parse(record.value as string, BufferJSON.reviver) : null;
};

/**
 * Creates a database-backed authentication state for Baileys
 * This replaces the file-based useMultiFileAuthState
 *
 * @param sessionId - The WhatsApp session ID
 * @param database - Optional database instance (defaults to global db)
 * @returns Promise<DatabaseAuthState> - Auth state compatible with Baileys
 */
export async function useDatabaseAuthState(
  sessionId: string,
  database: typeof db,
): Promise<DatabaseAuthState> {
  const dbInstance = database;

  // Load credentials from database or initialize new ones
  const creds: AuthenticationCreds =
    (await readData(sessionId, 'creds', dbInstance)) || initAuthCreds();

  // Signal key store implementation
  const keys = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};

      // Use Promise.all for concurrent reads
      const results = await Promise.all(
        ids.map(async (id) => {
          const key = createKey(type, id);
          const value = await readData(sessionId, key, dbInstance);
          return { id, value };
        }),
      );

      // Build result object
      results.forEach(({ id, value }) => {
        if (value !== null) {
          data[id] =
            type === 'app-state-sync-key' && value
              ? proto.Message.AppStateSyncKeyData.fromObject(value)
              : value;
        }
      });

      return data;
    },

    set: async (data: SignalDataSet) => {
      // Use transaction for atomic operations
      await dbInstance.transaction(async (tx) => {
        // Collect all write operations using map (not flatMap with loops)
        const writePromises = Object.entries(data).map(([category, categoryData]) =>
          Promise.all(
            Object.entries(categoryData).map(([id, value]) => {
              const key = createKey(category, id);
              return writeData(sessionId, key, value, tx);
            }),
          ),
        );

        // Execute all operations concurrently within transaction
        await Promise.all(writePromises);
      });
    },

    clear: async () => {
      await dbInstance.delete(authStates).where(eq(authStates.sessionId, sessionId));
    },
  };

  // Save credentials function
  const saveCreds = async () => {
    await writeData(sessionId, 'creds', creds, dbInstance);
  };

  // Create the authentication state
  const state: AuthenticationState = {
    creds,
    keys,
  };

  return {
    state,
    saveCreds,
  };
}

/**
 * Utility function to check if a session has valid authentication
 */
export async function hasValidAuth(sessionId: string, database: typeof db): Promise<boolean> {
  const dbInstance = database;

  try {
    const creds = await readData(sessionId, 'creds', dbInstance);

    if (!creds) {
      return false;
    }

    // Check for essential Baileys authentication credentials
    return !!(creds.noiseKey && creds.signedIdentityKey && creds.registrationId);
  } catch (error) {
    console.error(`Failed to check auth validity for session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Utility function to clear all auth data for a session
 */
export async function clearAuthState(sessionId: string, database: typeof db): Promise<void> {
  const dbInstance = database;

  try {
    await dbInstance.delete(authStates).where(eq(authStates.sessionId, sessionId));

    console.log(`Cleared auth state for session ${sessionId}`);
  } catch (error) {
    console.error(`Failed to clear auth state for session ${sessionId}:`, error);
    throw error;
  }
}
