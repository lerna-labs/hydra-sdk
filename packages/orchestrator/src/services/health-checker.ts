import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import type { OrchestratorConfig } from '../config.js';
import type { CapacityDecision, HostHealth } from '../types.js';

/**
 * Reads host metrics from /proc and makes provisioning capacity decisions.
 *
 * Falls back to `os.cpus()` for core count when /proc is unavailable (e.g., macOS dev).
 */
export class HealthChecker {
  constructor(
    private readonly config: OrchestratorConfig,
    private readonly activeInstanceCount: () => number,
  ) {}

  /** Collect current host metrics. */
  getHostHealth(): HostHealth {
    const { load1m, load5m } = this.readLoadAvg();
    const cores = cpus().length;
    const { totalMb, availableMb } = this.readMemInfo();
    const { readsPerSec, writesPerSec } = this.readDiskStats();

    return {
      cpuLoadAvg1m: load1m,
      cpuLoadAvg5m: load5m,
      cpuCores: cores,
      cpuLoadRatio: cores > 0 ? load1m / cores : 0,
      memTotalMb: totalMb,
      memAvailableMb: availableMb,
      memUsedPercent: totalMb > 0 ? ((totalMb - availableMb) / totalMb) * 100 : 0,
      diskIopsRead: readsPerSec,
      diskIopsWrite: writesPerSec,
    };
  }

  /** Evaluate whether the host can support another instance. */
  evaluate(): CapacityDecision {
    const host = this.getHostHealth();
    const activeInstances = this.activeInstanceCount();
    const maxInstances = this.config.maxInstances;

    if (activeInstances >= maxInstances) {
      return {
        canProvision: false,
        reason: `Instance limit reached (${activeInstances}/${maxInstances})`,
        activeInstances,
        maxInstances,
        host,
      };
    }

    if (host.cpuLoadRatio > this.config.maxCpuLoadRatio) {
      return {
        canProvision: false,
        reason: `CPU load too high (${host.cpuLoadRatio.toFixed(2)} > ${this.config.maxCpuLoadRatio})`,
        activeInstances,
        maxInstances,
        host,
      };
    }

    if (host.memAvailableMb < this.config.minMemoryAvailableMb) {
      return {
        canProvision: false,
        reason: `Insufficient memory (${host.memAvailableMb}MB available, need ${this.config.minMemoryAvailableMb}MB)`,
        activeInstances,
        maxInstances,
        host,
      };
    }

    return { canProvision: true, activeInstances, maxInstances, host };
  }

  // ── /proc readers ──────────────────────────────────────────────────

  private readLoadAvg(): { load1m: number; load5m: number } {
    try {
      const content = readFileSync('/proc/loadavg', 'utf-8');
      const parts = content.trim().split(/\s+/);
      return {
        load1m: Number.parseFloat(parts[0]) || 0,
        load5m: Number.parseFloat(parts[1]) || 0,
      };
    } catch {
      return { load1m: 0, load5m: 0 };
    }
  }

  private readMemInfo(): { totalMb: number; availableMb: number } {
    try {
      const content = readFileSync('/proc/meminfo', 'utf-8');
      const get = (key: string): number => {
        const match = content.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
        return match ? Number.parseInt(match[1], 10) / 1024 : 0; // kB → MB
      };
      return {
        totalMb: Math.round(get('MemTotal')),
        availableMb: Math.round(get('MemAvailable')),
      };
    } catch {
      return { totalMb: 0, availableMb: 0 };
    }
  }

  /**
   * Read aggregate disk I/O stats from /proc/diskstats.
   *
   * Returns a snapshot of reads/writes completed. For true IOPS you'd need
   * to sample twice and compute the delta; for the health gate a single
   * snapshot is sufficient to detect sustained load.
   */
  private readDiskStats(): { readsPerSec: number; writesPerSec: number } {
    try {
      const content = readFileSync('/proc/diskstats', 'utf-8');
      let reads = 0;
      let writes = 0;

      for (const line of content.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 14) continue;
        const device = parts[2];
        // Only count whole-disk devices (sda, vda, nvme0n1), not partitions
        if (/^(sd[a-z]|vd[a-z]|nvme\d+n\d+)$/.test(device)) {
          reads += Number.parseInt(parts[3], 10) || 0;
          writes += Number.parseInt(parts[7], 10) || 0;
        }
      }

      return { readsPerSec: reads, writesPerSec: writes };
    } catch {
      return { readsPerSec: 0, writesPerSec: 0 };
    }
  }
}
