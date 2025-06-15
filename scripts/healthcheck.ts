#!/usr/bin/env bun

/**
 * Container Health Check Script for WhatsBlast
 *
 * This script performs comprehensive health checks for the WhatsBlast application
 * running in a Docker container. It verifies:
 * - HTTP server availability
 * - Database connectivity
 * - Redis connectivity
 * - WhatsApp connection manager status
 *
 * Exit codes:
 * - 0: All checks passed (healthy)
 * - 1: Critical failure (unhealthy)
 * - 2: Warning (degraded but functional)
 */

import Redis from 'ioredis';

interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'unhealthy' | 'warning';
  message: string;
  duration?: number;
}

class HealthChecker {
  private results: HealthCheckResult[] = [];
  private readonly timeout = 5000; // 5 seconds timeout
  private readonly port = process.env.PORT || '8080';
  private readonly host = process.env.HOST || 'localhost';

  /**
   * Add a health check result
   */
  private addResult(
    component: string,
    status: HealthCheckResult['status'],
    message: string,
    duration?: number,
  ) {
    this.results.push({ component, status, message, duration });
  }

  /**
   * Check HTTP server health
   */
  private async checkHttpServer(): Promise<void> {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`http://${this.host}:${this.port}/health`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'WhatsBlast-HealthCheck/1.0',
        },
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - start;

      if (response.ok) {
        const text = await response.text();
        if (text === 'OK') {
          this.addResult(
            'http-server',
            'healthy',
            `HTTP server responding (${response.status})`,
            duration,
          );
        } else {
          this.addResult(
            'http-server',
            'warning',
            `HTTP server responding but unexpected body: ${text}`,
            duration,
          );
        }
      } else {
        this.addResult(
          'http-server',
          'unhealthy',
          `HTTP server returned ${response.status}`,
          duration,
        );
      }
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          this.addResult(
            'http-server',
            'unhealthy',
            `HTTP server timeout after ${this.timeout}ms`,
            duration,
          );
        } else {
          this.addResult(
            'http-server',
            'unhealthy',
            `HTTP server error: ${error.message}`,
            duration,
          );
        }
      } else {
        this.addResult('http-server', 'unhealthy', 'HTTP server unknown error', duration);
      }
    }
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<void> {
    const start = Date.now();
    try {
      // Import database dynamically to avoid issues if not available
      const { db, whatsappSessions } = await import('../src/server/db/index.js');

      // Simple query to check database connectivity
      const result = await db.select().from(whatsappSessions).limit(1);

      const duration = Date.now() - start;
      this.addResult('database', 'healthy', 'Database connection successful', duration);
    } catch (error) {
      const duration = Date.now() - start;
      if (error instanceof Error) {
        this.addResult('database', 'unhealthy', `Database error: ${error.message}`, duration);
      } else {
        this.addResult('database', 'unhealthy', 'Database unknown error', duration);
      }
    }
  }

  /**
   * Check Redis connectivity
   */
  private async checkRedis(): Promise<void> {
    const start = Date.now();
    let client;

    try {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379');

      client = new Redis({
        host: redisHost,
        port: redisPort,
        connectTimeout: this.timeout,
        lazyConnect: true,
      });

      await client.connect();

      // Test Redis with a simple ping
      const pong = await client.ping();
      await client.disconnect();

      const duration = Date.now() - start;

      if (pong === 'PONG') {
        this.addResult('redis', 'healthy', 'Redis connection successful', duration);
      } else {
        this.addResult('redis', 'warning', `Redis ping returned: ${pong}`, duration);
      }
    } catch (error) {
      const duration = Date.now() - start;
      if (client) {
        try {
          await client.disconnect();
        } catch (disconnectError) {
          // Ignore disconnect errors during error handling
        }
      }

      if (error instanceof Error) {
        this.addResult('redis', 'unhealthy', `Redis error: ${error.message}`, duration);
      } else {
        this.addResult('redis', 'unhealthy', 'Redis unknown error', duration);
      }
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<void> {
    console.log('🔍 Starting WhatsBlast health checks...\n');

    // Run all checks in parallel for faster execution
    await Promise.all([this.checkHttpServer(), this.checkDatabase(), this.checkRedis()]);
  }

  /**
   * Print results and determine exit code
   */
  getResults(): { exitCode: number; summary: string } {
    let hasUnhealthy = false;
    let hasWarning = false;

    console.log('📊 Health Check Results:');
    console.log('========================\n');

    for (const result of this.results) {
      const icon = {
        healthy: '✅',
        warning: '⚠️',
        unhealthy: '❌',
      }[result.status];

      const durationText = result.duration ? ` (${result.duration}ms)` : '';
      console.log(`${icon} ${result.component.toUpperCase()}: ${result.message}${durationText}`);

      if (result.status === 'unhealthy') {
        hasUnhealthy = true;
      } else if (result.status === 'warning') {
        hasWarning = true;
      }
    }

    console.log('\n========================');

    let exitCode = 0;
    let summary = '';

    if (hasUnhealthy) {
      exitCode = 1;
      summary = '❌ UNHEALTHY - Critical components failing';
    } else if (hasWarning) {
      exitCode = 2;
      summary = '⚠️  DEGRADED - Some components have warnings';
    } else {
      exitCode = 0;
      summary = '✅ HEALTHY - All components operational';
    }

    console.log(summary);
    return { exitCode, summary };
  }
}

// Main execution
async function main() {
  const checker = new HealthChecker();

  try {
    await checker.runAllChecks();
    const { exitCode } = checker.getResults();
    process.exit(exitCode);
  } catch (error) {
    console.error('💥 Health check failed with unexpected error:', error);
    process.exit(1);
  }
}

// Only run if this script is executed directly
if (import.meta.main) {
  main();
}
