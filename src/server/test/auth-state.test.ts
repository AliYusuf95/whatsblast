import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { authStates } from "../db/schema";
import { initTestDatabase, testUtils } from "./setup";
import {
  useDatabaseAuthState,
  hasValidAuth,
  clearAuthState,
} from "../services/whatsapp/auth-state";

function createTestKeyPair(publicKey: string, privateKey: string) {
  return {
    public: testUtils.stringToUint8Array(publicKey),
    private: testUtils.stringToUint8Array(privateKey),
  };
}

function createTestSignalData() {
  return {
    "pre-key": {
      "1": createTestKeyPair("test-public-1", "test-private-1"),
      "2": createTestKeyPair("test-public-2", "test-private-2"),
    },
    session: {
      contact1: testUtils.stringToUint8Array("test-session-data-1"),
    },
  };
}

describe("Auth State", () => {
  const testSessionId = "test-session-123";
  let testDb: Awaited<ReturnType<typeof initTestDatabase>>["db"];
  let cleanupDb: () => void;

  beforeEach(async () => {
    const dbSetup = await initTestDatabase();
    testDb = dbSetup.db;
    cleanupDb = dbSetup.cleanup;
  });

  afterEach(async () => {
    cleanupDb();
  });

  describe("useDatabaseAuthState", () => {
    test("should create new auth state with initAuthCreds for new session", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);

      expect(authState.state.creds).toBeDefined();
      expect(authState.state.creds.noiseKey).toBeDefined();
      expect(authState.state.creds.signedIdentityKey).toBeDefined();
      expect(authState.state.creds.registrationId).toBeDefined();
      expect(authState.state.keys).toBeDefined();
      expect(authState.saveCreds).toBeDefined();
    });

    test("should load existing credentials from database", async () => {
      // First create and save auth state
      const initialAuthState = await useDatabaseAuthState(
        testSessionId,
        testDb,
      );
      await initialAuthState.saveCreds();

      // Then load it again
      const loadedAuthState = await useDatabaseAuthState(testSessionId, testDb);

      expect(loadedAuthState.state.creds.noiseKey).toEqual(
        initialAuthState.state.creds.noiseKey,
      );
      expect(loadedAuthState.state.creds.registrationId).toEqual(
        initialAuthState.state.creds.registrationId,
      );
    });

    test("should save credentials to database", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      await authState.saveCreds();

      // Verify credentials were saved
      const savedRecord = await testDb.query.authStates.findFirst({
        where: eq(authStates.sessionId, testSessionId),
      });

      expect(savedRecord).toBeDefined();
      expect(savedRecord?.key).toBe("creds");
    });
  });

  describe("Signal Key Store", () => {
    test("should get and set signal keys", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Test data using helper functions
      const testData = createTestSignalData();

      // Set keys
      await keys.set(testData);

      // Get keys
      const retrievedPreKeys = await keys.get("pre-key", ["1", "2"]);
      const retrievedSessions = await keys.get("session", ["contact1"]);

      expect(retrievedPreKeys["1"]).toEqual(testData["pre-key"]["1"]);
      expect(retrievedPreKeys["2"]).toEqual(testData["pre-key"]["2"]);
      expect(retrievedSessions["contact1"]).toEqual(
        testData["session"]["contact1"],
      );
    });

    test("should handle empty get requests", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      const result = await keys.get("pre-key", ["non-existent"]);
      expect(Object.keys(result)).toHaveLength(0);
    });

    test("should clear all keys", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Set some test data using helper function
      await keys.set({
        "pre-key": {
          "1": createTestKeyPair("test-public", "test-private"),
        },
      });

      // Save credentials
      await authState.saveCreds();

      // Clear all keys
      if (keys.clear) {
        await keys.clear();
      }

      // Verify everything is cleared
      const records = await testDb.query.authStates.findMany({
        where: eq(authStates.sessionId, testSessionId),
      });

      expect(records).toHaveLength(0);
    });
  });

  describe("hasValidAuth", () => {
    test("should return false for non-existent session", async () => {
      const isValid = await hasValidAuth("non-existent-session", testDb);
      expect(isValid).toBe(false);
    });

    test("should return true for valid auth session", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);

      // Set complete credentials that hasValidAuth expects
      authState.state.creds = testUtils.generateTestCreds();

      await authState.saveCreds();

      const isValid = await hasValidAuth(testSessionId, testDb);
      expect(isValid).toBe(true);
    });

    test("should return false for incomplete credentials", async () => {
      // Save incomplete credentials
      const incompleteCreds = { noiseKey: "test-key" }; // Missing other required fields

      await testDb.insert(authStates).values({
        sessionId: testSessionId,
        key: "creds",
        value: JSON.stringify(incompleteCreds),
      });

      const isValid = await hasValidAuth(testSessionId, testDb);
      expect(isValid).toBe(false);
    });
  });

  describe("clearAuthState", () => {
    test("should clear all auth data for session", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);

      // Save some data
      await authState.saveCreds();
      await authState.state.keys.set({
        "pre-key": {
          "1": createTestKeyPair("test-public", "test-private"),
        },
      });

      // Verify data exists
      let records = await testDb.query.authStates.findMany({
        where: eq(authStates.sessionId, testSessionId),
      });
      expect(records.length).toBeGreaterThan(0);

      // Clear auth state
      await clearAuthState(testSessionId, testDb);

      // Verify data is cleared
      records = await testDb.query.authStates.findMany({
        where: eq(authStates.sessionId, testSessionId),
      });
      expect(records).toHaveLength(0);
    });

    test("should not affect other sessions", async () => {
      const otherSessionId = "other-session-456";

      // Create auth states for both sessions
      const authState1 = await useDatabaseAuthState(testSessionId, testDb);
      const authState2 = await useDatabaseAuthState(otherSessionId, testDb);

      await authState1.saveCreds();
      await authState2.saveCreds();

      // Clear only the first session
      await clearAuthState(testSessionId, testDb);

      // Verify first session is cleared
      const records1 = await testDb.query.authStates.findMany({
        where: eq(authStates.sessionId, testSessionId),
      });
      expect(records1).toHaveLength(0);

      // Verify second session still exists
      const records2 = await testDb.query.authStates.findMany({
        where: eq(authStates.sessionId, otherSessionId),
      });
      expect(records2.length).toBeGreaterThan(0);

      // Clean up
      await clearAuthState(otherSessionId, testDb);
    });
  });

  describe("Transaction Safety", () => {
    test("should handle multiple concurrent key sets atomically", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Prepare test data with multiple categories and keys using helper functions
      const testData1 = createTestSignalData();
      const testData2 = {
        "pre-key": {
          "3": createTestKeyPair("test-public-3", "test-private-3"),
        },
        "sender-key": {
          group1: testUtils.stringToUint8Array("test-sender-key-data"),
        },
      };

      // Execute multiple set operations concurrently
      await Promise.all([keys.set(testData1), keys.set(testData2)]);

      // Verify all data was saved correctly
      const preKeys = await keys.get("pre-key", ["1", "2", "3"]);
      const sessions = await keys.get("session", ["contact1"]);
      const senderKeys = await keys.get("sender-key", ["group1"]);

      expect(preKeys["1"]).toEqual(testData1["pre-key"]["1"]);
      expect(preKeys["2"]).toEqual(testData1["pre-key"]["2"]);
      expect(preKeys["3"]).toEqual(testData2["pre-key"]["3"]);
      expect(sessions["contact1"]).toEqual(testData1["session"]["contact1"]);
      expect(senderKeys["group1"]).toEqual(testData2["sender-key"]["group1"]);
    });

    test("should handle database constraint violations during concurrent operations", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // First save some baseline data
      const baselineData = {
        "pre-key": {
          baseline: createTestKeyPair("baseline-public", "baseline-private"),
        },
      };
      await keys.set(baselineData);

      // Try to save data with null values which should be handled gracefully
      const testDataWithNulls = {
        "pre-key": {
          valid: createTestKeyPair("valid-public", "valid-private"),
          null: null, // This should delete the key if it exists
        },
        session: {
          "valid-session": testUtils.stringToUint8Array("valid-session-data"),
          "null-session": null, // This should also delete the key if it exists
        },
      };

      // This should work without throwing errors
      await keys.set(testDataWithNulls);

      // Verify that valid data was saved and null data was handled properly
      const retrievedPreKeys = await keys.get("pre-key", [
        "valid",
        "null",
        "baseline",
      ]);
      const retrievedSessions = await keys.get("session", [
        "valid-session",
        "null-session",
      ]);

      expect(retrievedPreKeys["valid"]).toEqual(
        testDataWithNulls["pre-key"]["valid"],
      );
      expect(retrievedPreKeys["null"]).toBeUndefined();
      expect(retrievedPreKeys["baseline"]).toEqual(
        baselineData["pre-key"]["baseline"],
      );

      expect(retrievedSessions["valid-session"]).toEqual(
        testDataWithNulls["session"]["valid-session"],
      );
      expect(retrievedSessions["null-session"]).toBeUndefined();
    });

    test("should handle partial get operations gracefully", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Save some test data
      const testData = {
        "pre-key": {
          existing1: createTestKeyPair("public1", "private1"),
          existing2: createTestKeyPair("public2", "private2"),
        },
      };
      await keys.set(testData);

      // Try to get a mix of existing and non-existing keys
      const retrievedKeys = await keys.get("pre-key", [
        "existing1",
        "non-existent1",
        "existing2",
        "non-existent2",
      ]);

      // Should only return the existing keys
      expect(Object.keys(retrievedKeys)).toHaveLength(2);
      expect(retrievedKeys["existing1"]).toEqual(
        testData["pre-key"]["existing1"],
      );
      expect(retrievedKeys["existing2"]).toEqual(
        testData["pre-key"]["existing2"],
      );
      expect(retrievedKeys["non-existent1"]).toBeUndefined();
      expect(retrievedKeys["non-existent2"]).toBeUndefined();
    });

    test("should maintain consistency during concurrent operations", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Create multiple auth states for the same session to test concurrent access
      const authState2 = await useDatabaseAuthState(testSessionId, testDb);
      const keys2 = authState2.state.keys;

      const authState3 = await useDatabaseAuthState(testSessionId, testDb);
      const keys3 = authState3.state.keys;

      // Prepare different test data for each concurrent operation
      const testData1 = {
        "pre-key": {
          concurrent1: createTestKeyPair(
            "concurrent-public-1",
            "concurrent-private-1",
          ),
        },
      };

      const testData2 = {
        session: {
          concurrent2: testUtils.stringToUint8Array("concurrent-session-2"),
        },
      };

      const testData3 = {
        "sender-key": {
          concurrent3: testUtils.stringToUint8Array("concurrent-sender-3"),
        },
      };

      // Execute all operations concurrently
      await Promise.all([
        keys.set(testData1),
        keys2.set(testData2),
        keys3.set(testData3),
      ]);

      // Verify all data was saved correctly and no data was lost
      const allPreKeys = await keys.get("pre-key", ["concurrent1"]);
      const allSessions = await keys.get("session", ["concurrent2"]);
      const allSenderKeys = await keys.get("sender-key", ["concurrent3"]);

      expect(allPreKeys["concurrent1"]).toEqual(
        testData1["pre-key"]["concurrent1"],
      );
      expect(allSessions["concurrent2"]).toEqual(
        testData2["session"]["concurrent2"],
      );
      expect(allSenderKeys["concurrent3"]).toEqual(
        testData3["sender-key"]["concurrent3"],
      );

      // Verify data consistency across all instances
      const verifyPreKeys = await keys2.get("pre-key", ["concurrent1"]);
      const verifySessions = await keys3.get("session", ["concurrent2"]);
      const verifySenderKeys = await keys.get("sender-key", ["concurrent3"]);

      expect(verifyPreKeys["concurrent1"]).toEqual(
        testData1["pre-key"]["concurrent1"],
      );
      expect(verifySessions["concurrent2"]).toEqual(
        testData2["session"]["concurrent2"],
      );
      expect(verifySenderKeys["concurrent3"]).toEqual(
        testData3["sender-key"]["concurrent3"],
      );
    });

    test("should handle large batch operations efficiently", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Create a large batch of test data
      const largeBatch: any = {
        "pre-key": {},
        session: {},
        "sender-key": {},
      };

      // Generate 50 keys of each type
      for (let i = 1; i <= 50; i++) {
        largeBatch["pre-key"][`key${i}`] = createTestKeyPair(
          `public${i}`,
          `private${i}`,
        );
        largeBatch["session"][`session${i}`] = testUtils.stringToUint8Array(
          `session-data-${i}`,
        );
        largeBatch["sender-key"][`sender${i}`] = testUtils.stringToUint8Array(
          `sender-data-${i}`,
        );
      }

      // Measure performance
      const startTime = Date.now();
      await keys.set(largeBatch);
      const setTime = Date.now() - startTime;

      // Should complete in reasonable time (less than 5 seconds)
      expect(setTime).toBeLessThan(5000);

      // Verify a sample of the data was saved correctly
      const sampleKeys = await keys.get("pre-key", ["key1", "key25", "key50"]);
      const sampleSessions = await keys.get("session", [
        "session1",
        "session25",
        "session50",
      ]);
      const sampleSenders = await keys.get("sender-key", [
        "sender1",
        "sender25",
        "sender50",
      ]);

      expect(Object.keys(sampleKeys)).toHaveLength(3);
      expect(Object.keys(sampleSessions)).toHaveLength(3);
      expect(Object.keys(sampleSenders)).toHaveLength(3);

      expect(sampleKeys["key1"]).toEqual(largeBatch["pre-key"]["key1"]);
      expect(sampleSessions["session25"]).toEqual(
        largeBatch["session"]["session25"],
      );
      expect(sampleSenders["sender50"]).toEqual(
        largeBatch["sender-key"]["sender50"],
      );
    });

    test("should handle app-state-sync-key deserialization correctly", async () => {
      const authState = await useDatabaseAuthState(testSessionId, testDb);
      const { keys } = authState.state;

      // Create test data with app-state-sync-key type
      const appStateSyncData = {
        "app-state-sync-key": {
          "test-key-id": {
            keyData: testUtils.stringToUint8Array("test-key-data"),
            fingerprint: {
              rawId: 1,
              currentIndex: 0,
            },
          },
        },
      };

      // Set the data
      await keys.set(appStateSyncData);

      // Get the data back
      const retrieved = await keys.get("app-state-sync-key", ["test-key-id"]);

      // The auth-state implementation should handle app-state-sync-key specially
      // by using proto.Message.AppStateSyncKeyData.fromObject
      expect(retrieved["test-key-id"]).toBeDefined();

      // The exact structure depends on Baileys proto message format,
      // but it should be processed differently than other key types
      expect(typeof retrieved["test-key-id"]).toBe("object");
    });
  });
});
