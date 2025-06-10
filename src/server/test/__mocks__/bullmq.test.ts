import { mock } from 'bun:test';

// Mock BullMQ Job for testing
class MockJob {
  constructor(
    public queueName: string,
    public name: string,
    public data: any,
    public opts: any = {},
    public id?: string,
  ) {
    this.id = id || 'mock-job-id';
  }

  async updateProgress(progress: number) {
    return Promise.resolve();
  }

  async log(row: string) {
    return Promise.resolve();
  }

  async remove() {
    return Promise.resolve();
  }

  async retry() {
    return Promise.resolve();
  }
}

// Mock BullMQ Queue for testing
class MockQueue {
  constructor(
    public name: string,
    public opts: any = {},
  ) {}

  async add(name: string, data: any, opts: any = {}) {
    return new MockJob(this.name, name, data, opts);
  }

  async getJob(id: string) {
    return new MockJob(this.name, 'test', {}, {}, id);
  }

  async getJobs(types: string[] = [], start = 0, end = -1) {
    return [];
  }

  async getJobCounts() {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
  }

  async clean(grace: number, type: string) {
    return [];
  }

  async pause() {
    return Promise.resolve();
  }

  async resume() {
    return Promise.resolve();
  }

  async close() {
    return Promise.resolve();
  }

  on(event: string, callback: Function) {
    return this;
  }

  off(event: string, callback: Function) {
    return this;
  }
}

// Mock BullMQ QueueEvents for testing
class MockQueueEvents {
  constructor(
    public queueName: string,
    public opts: any = {},
  ) {}

  on(event: string, callback: Function) {
    return this;
  }

  off(event: string, callback: Function) {
    return this;
  }

  async close() {
    return Promise.resolve();
  }
}

// Mock BullMQ Worker for testing
class MockWorker {
  private _isPaused = false;

  constructor(
    public queueName: string,
    public processor: any,
    public options: any,
  ) {}

  on(event: string, callback: Function) {
    // Simulate ready event
    if (event === 'ready') {
      setTimeout(() => callback(), 0);
    }
    return this;
  }

  close() {
    return Promise.resolve();
  }

  pause() {
    this._isPaused = true;
    return Promise.resolve();
  }

  resume() {
    this._isPaused = false;
    return Promise.resolve();
  }

  isPaused() {
    return this._isPaused;
  }
}

// Mock ioredis Redis connection for testing
class MockRedisConnection {
  constructor(public opts: any = {}) {}
  async connect() {
    return Promise.resolve();
  }
  async disconnect() {
    return Promise.resolve();
  }
  async ping() {
    return Promise.resolve('PONG');
  }
  async get(key: string) {
    return Promise.resolve(null);
  }
  async set(key: string, value: any) {
    return Promise.resolve('OK');
  }
  async del(key: string) {
    return Promise.resolve(1);
  }
  async exists(key: string) {
    return Promise.resolve(0);
  }
  async expire(key: string, seconds: number) {
    return Promise.resolve(1);
  }
  async ttl(key: string) {
    return Promise.resolve(-1);
  }
  async flushall() {
    return Promise.resolve('OK');
  }
  async quit() {
    return Promise.resolve();
  }
  on(event: string, callback: Function) {
    return this;
  }
  off(event: string, callback: Function) {
    return this;
  }
}

// Mock the bullmq module
mock.module('bullmq', () => ({
  Queue: MockQueue,
  QueueEvents: MockQueueEvents,
  Worker: MockWorker,
  Job: MockJob,
}));

// Mock the ioredis module
mock.module('ioredis', () => ({
  default: MockRedisConnection,
}));
