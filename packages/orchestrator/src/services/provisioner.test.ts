import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorConfig } from '../config.js';
import { Provisioner } from './provisioner.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, 'ok', '');
    },
  ),
}));

function makeConfig(projectRoot: string): OrchestratorConfig {
  return {
    apiKey: 'test',
    port: 7000,
    projectRoot,
    externalHost: 'localhost',
    allowedNetworks: ['preprod'],
    maxCpuLoadRatio: 0.8,
    minMemoryAvailableMb: 2048,
    maxDiskUtilPercent: 85,
    maxInstances: 20,
    readinessTimeoutS: 2,
    readinessPollIntervalS: 0.1,
    instanceTtlS: 0,
    cleanupIntervalS: 300,
    imageAllowlistPattern: '',
    auditLogPath: '/tmp/audit.log',
  };
}

describe('Provisioner', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `prov-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('shells out to make create-instance', async () => {
    const { execFile } = await import('node:child_process');
    const prov = new Provisioner(makeConfig(root));
    await prov.createInstance('preprod', 'alpha');

    expect(execFile).toHaveBeenCalledWith(
      'make',
      ['NETWORK=preprod', 'INSTANCE=alpha', 'create-instance'],
      expect.objectContaining({ cwd: root }),
      expect.any(Function),
    );
  });

  it('shells out to make hydra-start', async () => {
    const { execFile } = await import('node:child_process');
    const prov = new Provisioner(makeConfig(root));
    await prov.startContainers('preprod', 'alpha');

    expect(execFile).toHaveBeenCalledWith(
      'make',
      ['NETWORK=preprod', 'INSTANCE=alpha', 'hydra-start'],
      expect.objectContaining({ cwd: root }),
      expect.any(Function),
    );
  });

  it('shells out to make hydra-down', async () => {
    const { execFile } = await import('node:child_process');
    const prov = new Provisioner(makeConfig(root));
    await prov.stopContainers('preprod', 'beta');

    expect(execFile).toHaveBeenCalledWith(
      'make',
      ['NETWORK=preprod', 'INSTANCE=beta', 'hydra-down'],
      expect.objectContaining({ cwd: root }),
      expect.any(Function),
    );
  });

  it('appends EXPRESS_IMAGE to env file', () => {
    const envPath = join(root, '.preprod.alpha.env');
    writeFileSync(envPath, 'INSTANCE=alpha\n');

    const prov = new Provisioner(makeConfig(root));
    prov.setExpressImage('preprod', 'alpha', 'ghcr.io/test:v1');

    const { readFileSync } = require('node:fs');
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('EXPRESS_IMAGE=ghcr.io/test:v1');
  });

  it('appends head params to env file', () => {
    const envPath = join(root, '.preprod.alpha.env');
    writeFileSync(envPath, 'INSTANCE=alpha\n');

    const prov = new Provisioner(makeConfig(root));
    prov.setHeadParams('preprod', 'alpha', { contestationPeriod: 300, depositPeriod: 1800 });

    const { readFileSync } = require('node:fs');
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('CONTESTATION_PERIOD=300');
    expect(content).toContain('DEPOSIT_PERIOD=1800');
  });

  it('parses instance env file', () => {
    const envPath = join(root, '.preprod.alpha.env');
    writeFileSync(
      envPath,
      [
        'INSTANCE=alpha',
        'API_PORT=4102',
        'EXPRESS_PORT=3102',
        'LISTEN_PORT=5102',
        'TRP_PORT=8266',
        'MONITORING_PORT=6102',
        'X_API_KEY=uuid-123',
      ].join('\n'),
    );

    const prov = new Provisioner(makeConfig(root));
    const env = prov.readInstanceEnv('preprod', 'alpha');

    expect(env.apiPort).toBe(4102);
    expect(env.expressPort).toBe(3102);
    expect(env.listenPort).toBe(5102);
    expect(env.trpPort).toBe(8266);
    expect(env.monitoringPort).toBe(6102);
    expect(env.apiKey).toBe('uuid-123');
  });

  it('reads admin address from file', () => {
    const keysDir = join(root, 'data', 'preprod', 'instances', 'alpha', 'keys');
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(join(keysDir, 'alpha.cardano.addr'), 'addr_test1qrxyz\n');

    const prov = new Provisioner(makeConfig(root));
    expect(prov.readAdminAddress('preprod', 'alpha')).toBe('addr_test1qrxyz');
  });

  it('throws when admin address file missing', () => {
    const prov = new Provisioner(makeConfig(root));
    expect(() => prov.readAdminAddress('preprod', 'missing')).toThrow('not found');
  });

  it('detects existing env file', () => {
    writeFileSync(join(root, '.preprod.alpha.env'), 'test');
    const prov = new Provisioner(makeConfig(root));
    expect(prov.instanceEnvExists('preprod', 'alpha')).toBe(true);
    expect(prov.instanceEnvExists('preprod', 'beta')).toBe(false);
  });

  it('purges env file and data dir', async () => {
    const { existsSync } = await import('node:fs');
    const envPath = join(root, '.preprod.alpha.env');
    const dataDir = join(root, 'data', 'preprod', 'instances', 'alpha');
    const keysDir = join(dataDir, 'keys');
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(envPath, 'INSTANCE=alpha\n');
    writeFileSync(join(keysDir, 'alpha.cardano.addr'), 'addr_test1xyz');

    const prov = new Provisioner(makeConfig(root));
    prov.purgeInstance('preprod', 'alpha');

    expect(existsSync(envPath)).toBe(false);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('purge is idempotent on missing files', () => {
    const prov = new Provisioner(makeConfig(root));
    expect(() => prov.purgeInstance('preprod', 'ghost')).not.toThrow();
  });
});
