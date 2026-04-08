import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OrchestratorConfig } from '../config.js';
import type { InstanceRegistry } from './instance-registry.js';

interface PrometheusTarget {
  targets: string[];
  labels: Record<string, string>;
}

/**
 * Writes a Prometheus file_sd_configs JSON targets file from the instance registry.
 *
 * Prometheus watches this file (refresh_interval: 15s) and automatically
 * discovers new scrape targets without restart.
 */
export class PrometheusServiceDiscovery {
  private readonly targetsPath: string;

  constructor(
    config: OrchestratorConfig,
    private readonly registry: InstanceRegistry,
  ) {
    this.targetsPath = join(config.projectRoot, 'docker', 'monitoring', 'targets.json');
  }

  /** Regenerate the targets file from current registry state. */
  write(): void {
    const active = this.registry.listByStatus('SCAFFOLDING', 'READY');

    const targets: PrometheusTarget[] = active
      .filter((inst) => inst.endpoints?.metrics)
      .map((inst) => {
        const port = inst.endpoints!.metrics.match(/:(\d+)/)?.[1] ?? '6001';
        return {
          targets: [`localhost:${port}`],
          labels: {
            network: inst.network,
            instance: inst.id,
            managed_by: 'orchestrator',
          },
        };
      });

    mkdirSync(dirname(this.targetsPath), { recursive: true });
    writeFileSync(this.targetsPath, JSON.stringify(targets, null, 2), 'utf-8');
  }
}
