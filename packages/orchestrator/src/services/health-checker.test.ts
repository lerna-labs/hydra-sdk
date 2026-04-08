import { describe, expect, it, vi } from 'vitest';
import type { OrchestratorConfig } from '../config.js';
import { HealthChecker } from './health-checker.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readFileSync: vi.fn((path: string) => {
      if (path === '/proc/loadavg') return '2.50 1.80 1.20 3/456 12345';
      if (path === '/proc/meminfo') return 'MemTotal:    16384000 kB\nMemAvailable:  8192000 kB\n';
      if (path === '/proc/diskstats')
        return '   8    0 sda 50000 0 0 0 30000 0 0 0 0 0 0 0 0 0 0 0 0\n   8    1 sda1 100 0 0 0 200 0 0 0 0 0 0 0 0 0 0 0 0\n';
      throw new Error(`Unexpected read: ${path}`);
    }),
  };
});

function makeConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    apiKey: 'test',
    port: 7000,
    projectRoot: '/tmp',
    externalHost: 'localhost',
    allowedNetworks: ['preprod'],
    maxCpuLoadRatio: 0.8,
    minMemoryAvailableMb: 2048,
    maxDiskUtilPercent: 85,
    maxInstances: 20,
    readinessTimeoutS: 10,
    readinessPollIntervalS: 1,
    instanceTtlS: 0,
    cleanupIntervalS: 300,
    imageAllowlistPattern: '',
    auditLogPath: '/tmp/audit.log',
    ...overrides,
  };
}

describe('HealthChecker', () => {
  it('reads host health from /proc', () => {
    const checker = new HealthChecker(makeConfig(), () => 3);
    const health = checker.getHostHealth();

    expect(health.cpuLoadAvg1m).toBe(2.5);
    expect(health.cpuLoadAvg5m).toBe(1.8);
    expect(health.cpuCores).toBeGreaterThan(0);
    expect(health.memTotalMb).toBe(16000);
    expect(health.memAvailableMb).toBe(8000);
    // sda only (not sda1 partition)
    expect(health.diskIopsRead).toBe(50000);
    expect(health.diskIopsWrite).toBe(30000);
  });

  it('returns canProvision=true when under thresholds', () => {
    const checker = new HealthChecker(makeConfig({ maxCpuLoadRatio: 10 }), () => 0);
    const decision = checker.evaluate();
    expect(decision.canProvision).toBe(true);
  });

  it('rejects when instance limit reached', () => {
    const checker = new HealthChecker(makeConfig({ maxInstances: 5 }), () => 5);
    const decision = checker.evaluate();
    expect(decision.canProvision).toBe(false);
    expect(decision.reason).toContain('Instance limit');
  });

  it('rejects when CPU load too high', () => {
    // loadavg is 2.5, with maxCpuLoadRatio=0.01 it will always be too high
    const checker = new HealthChecker(makeConfig({ maxCpuLoadRatio: 0.01 }), () => 0);
    const decision = checker.evaluate();
    expect(decision.canProvision).toBe(false);
    expect(decision.reason).toContain('CPU load');
  });

  it('rejects when memory too low', () => {
    // Mock returns 8000 MB available
    const checker = new HealthChecker(makeConfig({ minMemoryAvailableMb: 99999 }), () => 0);
    const decision = checker.evaluate();
    expect(decision.canProvision).toBe(false);
    expect(decision.reason).toContain('memory');
  });
});
