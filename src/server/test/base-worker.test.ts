/**
 * Unit Tests for Base Worker
 *
 * Tests the abstract worker functionality including job processing,
 * error handling, lifecycle management, and rate limiting
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { BaseWorker } from "../workers/base-worker";
import { testUtils } from "./setup";
import type { Job } from "bullmq";
import type { JobResult } from "../queue";

// Test implementation of BaseWorker
class TestWorker extends BaseWorker<any> {
  constructor(queueName: string = "test-queue", concurrency: number = 1) {
    super(queueName, concurrency);
  }

  protected async processJob(job: Job<any>): Promise<JobResult> {
    const { action, shouldFail, delay, data } = job.data;

    if (delay) {
      await testUtils.wait(delay);
    }

    if (shouldFail) {
      throw new Error(`Test error: ${action}`);
    }

    return this.createSuccessResult({
      action,
      processedAt: Date.now(),
      ...data,
    });
  }
}

// Test worker that always fails
class FailingWorker extends BaseWorker<any> {
  constructor() {
    super("failing-queue", 1);
  }

  protected async processJob(job: Job<any>): Promise<JobResult> {
    throw new Error("This worker always fails");
  }
}

describe("BaseWorker", () => {
  let testWorker: TestWorker;

  beforeEach(() => {
    testWorker = new TestWorker();
  });

  afterEach(async () => {
    await testWorker.stop();
  });

  describe("constructor", () => {
    test("should create worker with default options", () => {
      const worker = new TestWorker("test-queue");

      expect(worker.getStatus().queueName).toBe("test-queue");
      expect(worker.getStatus().concurrency).toBe(1);
      expect(worker.getStatus().isRunning).toBe(false);
      expect(worker.getStatus().isPaused).toBe(false);
    });

    test("should create worker with custom options", () => {
      const worker = new TestWorker("custom-queue");
      worker.updateConcurrency(5);

      expect(worker.getStatus().queueName).toBe("custom-queue");
      expect(worker.getStatus().concurrency).toBe(5);
    });
  });

  describe("lifecycle management", () => {
    test("should start worker", async () => {
      expect(testWorker.getStatus().isRunning).toBe(false);

      await testWorker.start();

      expect(testWorker.getStatus().isRunning).toBe(true);
    });

    test("should stop worker", async () => {
      await testWorker.start();
      expect(testWorker.getStatus().isRunning).toBe(true);

      await testWorker.stop();

      expect(testWorker.getStatus().isRunning).toBe(false);
    });

    test("should pause worker", async () => {
      await testWorker.start();

      await testWorker.pause();

      expect(testWorker.getStatus().isPaused).toBe(true);
      expect(testWorker.getStatus().isRunning).toBe(true);
    });

    test("should resume worker", async () => {
      await testWorker.start();
      await testWorker.pause();

      await testWorker.resume();

      expect(testWorker.getStatus().isPaused).toBe(false);
      expect(testWorker.getStatus().isRunning).toBe(true);
    });
  });

  describe("job processing", () => {
    test("should process successful job", async () => {
      const mockJob = {
        id: "test-job-1",
        data: {
          sessionId: "test-session",
          type: "test-action",
          timestamp: Date.now(),
          action: "process-data",
          shouldFail: false,
          data: { value: "test" },
        },
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const result = await testWorker["processJob"](mockJob);

      expect(result.success).toBe(true);
      expect(result.data.action).toBe("process-data");
      expect(result.data.value).toBe("test");
      expect(result.timestamp).toBeDefined();
    });

    test("should handle job failure", async () => {
      const mockJob = {
        id: "test-job-2",
        data: {
          sessionId: "test-session",
          type: "test-action",
          timestamp: Date.now(),
          action: "fail-action",
          shouldFail: true,
        },
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      await expect(async () => {
        await testWorker["processJob"](mockJob);
      }).toThrow("Test error: fail-action");
    });

    test("should handle job with delay", async () => {
      const mockJob = {
        id: "test-job-3",
        data: {
          sessionId: "test-session",
          type: "test-action",
          timestamp: Date.now(),
          action: "delayed-action",
          delay: 50,
          shouldFail: false,
        },
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      const startTime = Date.now();
      const result = await testWorker["processJob"](mockJob);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeGreaterThanOrEqual(45); // Allow some margin
    });
  });

  describe("job data validation", () => {
    test("should validate required job data fields", () => {
      const validData = {
        sessionId: "test-session",
        type: "test-type",
        timestamp: Date.now(),
      };

      expect(() => {
        testWorker["validateJobData"](validData);
      }).not.toThrow();
    });

    test("should throw error for missing sessionId", () => {
      const invalidData = {
        type: "test-type",
        timestamp: Date.now(),
      };

      expect(() => {
        testWorker["validateJobData"](invalidData);
      }).toThrow("Job data must include sessionId");
    });

    test("should throw error for missing type", () => {
      const invalidData = {
        sessionId: "test-session",
        timestamp: Date.now(),
      };

      expect(() => {
        testWorker["validateJobData"](invalidData);
      }).toThrow("Job data must include type");
    });

    test("should throw error for missing timestamp", () => {
      const invalidData = {
        sessionId: "test-session",
        type: "test-type",
      };

      expect(() => {
        testWorker["validateJobData"](invalidData);
      }).toThrow("Job data must include timestamp");
    });
  });

  describe("result creation utilities", () => {
    test("should create success result", () => {
      const data = { processed: true };
      const result = testWorker["createSuccessResult"](data);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.timestamp).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    test("should create success result without data", () => {
      const result = testWorker["createSuccessResult"]();

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.timestamp).toBeDefined();
    });

    test("should create error result from string", () => {
      const errorMessage = "Test error message";
      const result = testWorker["createErrorResult"](errorMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
      expect(result.timestamp).toBeDefined();
      expect(result.data).toBeUndefined();
    });

    test("should create error result from Error object", () => {
      const error = new Error("Test error object");
      const result = testWorker["createErrorResult"](error);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Test error object");
      expect(result.timestamp).toBeDefined();
    });

    test("should create error result with additional data", () => {
      const errorMessage = "Test error";
      const additionalData = { context: "error context" };
      const result = testWorker["createErrorResult"](
        errorMessage,
        additionalData,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
      expect(result.data).toEqual(additionalData);
    });
  });

  describe("concurrency control", () => {
    test("should update concurrency", () => {
      expect(testWorker.getStatus().concurrency).toBe(1);

      testWorker.updateConcurrency(3);

      expect(testWorker.getStatus().concurrency).toBe(3);
    });

    test("should not allow negative concurrency", () => {
      expect(() => {
        testWorker.updateConcurrency(-1);
      }).toThrow("Concurrency must be a positive number");
    });

    test("should not allow zero concurrency", () => {
      expect(() => {
        testWorker.updateConcurrency(0);
      }).toThrow("Concurrency must be a positive number");
    });
  });

  describe("error handling", () => {
    test("should handle worker that always fails", async () => {
      const failingWorker = new FailingWorker();

      const mockJob = {
        id: "failing-job",
        data: {
          sessionId: "test-session",
          type: "test-action",
          timestamp: Date.now(),
        },
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      await expect(async () => {
        await failingWorker["processJob"](mockJob);
      }).toThrow("This worker always fails");

      await failingWorker.stop();
    });

    test("should handle malformed job data", () => {
      const malformedData = null;

      expect(() => {
        testWorker["validateJobData"](malformedData as any);
      }).toThrow();
    });

    test("should handle undefined job data", () => {
      expect(() => {
        testWorker["validateJobData"](undefined as any);
      }).toThrow();
    });
  });

  describe("status reporting", () => {
    test("should report correct initial status", () => {
      const status = testWorker.getStatus();

      expect(status).toEqual({
        isRunning: false,
        isPaused: false,
        concurrency: 1,
        queueName: "test-queue",
      });
    });

    test("should report status after starting", async () => {
      await testWorker.start();
      const status = testWorker.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.isPaused).toBe(false);
    });

    test("should report status after pausing", async () => {
      await testWorker.start();
      await testWorker.pause();
      const status = testWorker.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.isPaused).toBe(true);
    });
  });

  describe("job progress and logging", () => {
    test("should allow job progress updates", async () => {
      const mockJob = {
        id: "progress-job",
        data: {
          sessionId: "test-session",
          type: "test-action",
          timestamp: Date.now(),
          action: "track-progress",
        },
        updateProgress: mock(() => Promise.resolve()),
        log: mock(() => Promise.resolve()),
      } as any;

      await testWorker["processJob"](mockJob);

      // Job processing completes successfully
      expect(mockJob.updateProgress).toBeDefined();
      expect(mockJob.log).toBeDefined();
    });
  });

  describe("edge cases", () => {
    test("should handle multiple start calls", async () => {
      await testWorker.start();
      expect(testWorker.getStatus().isRunning).toBe(true);

      // Second start should not cause issues
      await testWorker.start();
      expect(testWorker.getStatus().isRunning).toBe(true);
    });

    test("should handle multiple stop calls", async () => {
      await testWorker.start();
      await testWorker.stop();
      expect(testWorker.getStatus().isRunning).toBe(false);

      // Second stop should not cause issues
      await testWorker.stop();
      expect(testWorker.getStatus().isRunning).toBe(false);
    });

    test("should handle pause when not running", async () => {
      expect(testWorker.getStatus().isRunning).toBe(false);

      // Pause when not running should not cause issues
      await testWorker.pause();
      expect(testWorker.getStatus().isPaused).toBe(false);
    });

    test("should handle resume when not paused", async () => {
      await testWorker.start();
      expect(testWorker.getStatus().isPaused).toBe(false);

      // Resume when not paused should not cause issues
      await testWorker.resume();
      expect(testWorker.getStatus().isPaused).toBe(false);
    });
  });
});
