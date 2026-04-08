import type { OrchestratorConfig } from '../config.js';
import type { InstanceRegistry } from './instance-registry.js';
import type { PrometheusServiceDiscovery } from './prometheus-sd.js';
import type { Provisioner } from './provisioner.js';

/**
 * Periodically checks for expired instances and tears them down.
 *
 * An instance is considered expired when it has been in READY state
 * longer than the configured TTL. SCAFFOLDING instances that have been
 * stuck for longer than the TTL are also cleaned up.
 */
export class CleanupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly ttlMs: number;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly registry: InstanceRegistry,
    private readonly provisioner: Provisioner,
    private readonly promSD: PrometheusServiceDiscovery,
  ) {
    this.ttlMs = (config.instanceTtlS ?? 0) * 1000;
    this.checkIntervalMs = (config.cleanupIntervalS ?? 300) * 1000;
  }

  /** Start the periodic cleanup check. No-op if TTL is 0 (disabled). */
  start(): void {
    if (this.ttlMs <= 0) {
      console.log('[cleanup] TTL disabled — no automatic cleanup');
      return;
    }

    console.log(`[cleanup] TTL=${this.config.instanceTtlS}s, check every ${this.config.cleanupIntervalS}s`);
    this.timer = setInterval(() => this.sweep(), this.checkIntervalMs);
    // Don't prevent process exit
    this.timer.unref();
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single sweep: find and teardown expired instances. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    const candidates = this.registry.listByStatus('READY', 'SCAFFOLDING');

    for (const inst of candidates) {
      const createdAt = new Date(inst.createdAt).getTime();
      const age = now - createdAt;

      if (age > this.ttlMs) {
        console.log(
          `[cleanup] ${inst.id}: expired (age ${Math.round(age / 60_000)}m > TTL ${Math.round(this.ttlMs / 60_000)}m) — tearing down`,
        );
        try {
          await this.provisioner.stopContainers(inst.network, inst.id);
          this.registry.update(inst.id, { status: 'STOPPED', stoppedAt: new Date().toISOString() });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[cleanup] ${inst.id}: teardown failed — ${msg}`);
          this.registry.update(inst.id, { status: 'FAILED', error: `Cleanup teardown failed: ${msg}` });
        }
        this.promSD.write();
      }
    }
  }
}
