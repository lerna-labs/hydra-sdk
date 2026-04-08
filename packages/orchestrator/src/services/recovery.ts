import { execFile } from 'node:child_process';
import type { OrchestratorConfig } from '../config.js';
import type { InstanceRegistry } from './instance-registry.js';
import type { PrometheusServiceDiscovery } from './prometheus-sd.js';

/**
 * On startup, reconcile the persisted registry with the actual state of Docker containers.
 *
 * - SCAFFOLDING instances that no longer have running containers → FAILED
 * - READY instances that no longer have running containers → FAILED
 * - Already STOPPED/FAILED → left as-is
 */
export async function reconcileOnStartup(
  config: OrchestratorConfig,
  registry: InstanceRegistry,
  promSD: PrometheusServiceDiscovery,
): Promise<void> {
  const active = registry.listByStatus('SCAFFOLDING', 'READY');
  if (active.length === 0) return;

  console.log(`[recovery] Reconciling ${active.length} active instance(s)...`);

  for (const inst of active) {
    const running = await isContainerRunning(config, inst.network, inst.id);
    if (running) {
      console.log(`[recovery] ${inst.id}: containers running — OK`);
    } else {
      console.log(`[recovery] ${inst.id}: containers not running — marking FAILED`);
      registry.update(inst.id, { status: 'FAILED', error: 'Containers not running after orchestrator restart' });
    }
  }

  promSD.write();
}

async function isContainerRunning(config: OrchestratorConfig, network: string, instance: string): Promise<boolean> {
  const containerName = `hydra-node-${network}-${instance}`;
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['inspect', '--format', '{{.State.Running}}', containerName],
      { cwd: config.projectRoot, timeout: 10_000 },
      (error, stdout) => {
        resolve(!error && stdout.trim() === 'true');
      },
    );
  });
}
