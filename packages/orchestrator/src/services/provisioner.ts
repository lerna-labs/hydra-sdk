import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { OrchestratorConfig } from '../config.js';
import type { ParsedInstanceEnv } from '../types.js';

/**
 * Infrastructure provisioner that delegates to the existing Makefile targets.
 *
 * Each method shells out to `make` in the project root, inheriting the
 * environment layering (.env → .{network}.env → .{network}.{instance}.env).
 */
export class Provisioner {
  constructor(private readonly config: OrchestratorConfig) {}

  /**
   * Run `make create-instance` — generates env file, hydra keys, and cardano keys.
   * Takes ~5-10s (Docker containers for key generation).
   */
  async createInstance(network: string, instance: string): Promise<void> {
    await this.make(network, instance, 'create-instance');
  }

  /** Append EXPRESS_IMAGE to the instance env file. */
  setExpressImage(network: string, instance: string, image: string): void {
    const envPath = this.instanceEnvPath(network, instance);
    appendFileSync(envPath, `\nEXPRESS_IMAGE=${image}\n`);
  }

  /** Append optional head parameters (contestation period, deposit period) to the instance env file. */
  setHeadParams(
    network: string,
    instance: string,
    params: { contestationPeriod?: number; depositPeriod?: number },
  ): void {
    const envPath = this.instanceEnvPath(network, instance);
    const lines: string[] = [];
    if (params.contestationPeriod !== undefined) {
      lines.push(`CONTESTATION_PERIOD=${params.contestationPeriod}`);
    }
    if (params.depositPeriod !== undefined) {
      lines.push(`DEPOSIT_PERIOD=${params.depositPeriod}`);
    }
    if (lines.length > 0) {
      appendFileSync(envPath, `\n${lines.join('\n')}\n`);
    }
  }

  /**
   * Run `make hydra-start` — generates TRP config and starts all 3 containers.
   */
  async startContainers(network: string, instance: string): Promise<void> {
    await this.make(network, instance, 'hydra-start');
  }

  /**
   * Run `make hydra-down` — stops and removes instance containers.
   */
  async stopContainers(network: string, instance: string): Promise<void> {
    await this.make(network, instance, 'hydra-down');
  }

  /**
   * Remove the instance env file and data directory.
   * The env file is host-owned so `rmSync` handles it directly; the data directory
   * typically contains files written as root by the hydra-node/etcd containers, so
   * a short-lived container removes it for us (see `make purge-instance-data`).
   * Idempotent — safe on instances whose files were never created or were already removed.
   */
  async purgeInstance(network: string, instance: string): Promise<void> {
    const envPath = this.instanceEnvPath(network, instance);
    rmSync(envPath, { force: true });
    await this.make(network, instance, 'purge-instance-data');
  }

  /** Parse the generated instance env file for allocated ports and API key. */
  readInstanceEnv(network: string, instance: string): ParsedInstanceEnv {
    const envPath = this.instanceEnvPath(network, instance);
    const content = readFileSync(envPath, 'utf-8');

    const get = (key: string): string => {
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (!match) throw new Error(`Missing ${key} in ${envPath}`);
      return match[1].trim();
    };

    return {
      apiPort: Number.parseInt(get('API_PORT'), 10),
      expressPort: Number.parseInt(get('EXPRESS_PORT'), 10),
      listenPort: Number.parseInt(get('LISTEN_PORT'), 10),
      trpPort: Number.parseInt(get('TRP_PORT'), 10),
      monitoringPort: Number.parseInt(get('MONITORING_PORT'), 10),
      apiKey: get('X_API_KEY'),
    };
  }

  /** Read the admin bech32 address from the generated cardano.addr file. */
  readAdminAddress(network: string, instance: string): string {
    const addrPath = join(
      this.config.projectRoot,
      'data',
      network,
      'instances',
      instance,
      'keys',
      `${instance}.cardano.addr`,
    );
    if (!existsSync(addrPath)) {
      throw new Error(`Admin address file not found: ${addrPath}`);
    }
    return readFileSync(addrPath, 'utf-8').trim();
  }

  /** Check if an instance env file already exists. */
  instanceEnvExists(network: string, instance: string): boolean {
    return existsSync(this.instanceEnvPath(network, instance));
  }

  /**
   * Poll the hydra-node HTTP API until it responds.
   * @returns true if ready, false if timed out.
   */
  async checkHydraReady(apiPort: number): Promise<boolean> {
    const url = `http://localhost:${apiPort}/protocol-parameters`;
    const deadline = Date.now() + this.config.readinessTimeoutS * 1000;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return true;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, this.config.readinessPollIntervalS * 1000));
    }

    return false;
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private instanceEnvPath(network: string, instance: string): string {
    return join(this.config.projectRoot, `.${network}.${instance}.env`);
  }

  private make(network: string, instance: string, target: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        'make',
        [`NETWORK=${network}`, `INSTANCE=${instance}`, target],
        {
          cwd: this.config.projectRoot,
          timeout: 120_000,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            const msg = stderr.trim() || stdout.trim() || error.message;
            reject(new Error(`make ${target} failed: ${msg}`));
          } else {
            resolve();
          }
        },
      );
    });
  }
}
