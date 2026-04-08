import { Router } from 'express';
import type { OrchestratorConfig } from '../config.js';
import type { AuditLog } from '../services/audit-log.js';
import type { HealthChecker } from '../services/health-checker.js';
import type { InstanceRegistry } from '../services/instance-registry.js';
import type { PrometheusServiceDiscovery } from '../services/prometheus-sd.js';
import type { Provisioner } from '../services/provisioner.js';
import type { ScaffoldMutex } from '../services/scaffold-mutex.js';
import type { ManagedInstance, ScaffoldRequest, ScaffoldResponse } from '../types.js';

const INSTANCE_NAME_RE = /^[a-z][a-z0-9-]{1,20}$/;

function generateInstanceName(): string {
  const ts = Math.floor(Date.now() / 1000).toString(36);
  const rand = Math.random().toString(36).slice(2, 5);
  return `h${ts}${rand}`;
}

function toResponse(inst: ManagedInstance): ScaffoldResponse {
  return {
    id: inst.id,
    network: inst.network,
    status: inst.status,
    adminAddress: inst.adminAddress,
    endpoints: inst.endpoints,
    apiKey: inst.apiKey,
    createdAt: inst.createdAt,
  };
}

export function createHeadsRouter(
  config: OrchestratorConfig,
  registry: InstanceRegistry,
  provisioner: Provisioner,
  healthChecker: HealthChecker,
  promSD: PrometheusServiceDiscovery,
  mutex: ScaffoldMutex,
  audit: AuditLog,
): Router {
  const router = Router();

  // POST /heads — scaffold a new instance
  router.post('/', async (req, res) => {
    const body = req.body as ScaffoldRequest;

    // Validate required fields
    if (!body.network || !body.expressImage) {
      res.status(400).json({ error: 'Missing required fields: network, expressImage' });
      return;
    }

    if (!config.allowedNetworks.includes(body.network)) {
      res
        .status(400)
        .json({ error: `Network "${body.network}" not allowed. Allowed: ${config.allowedNetworks.join(', ')}` });
      return;
    }

    // Validate image against allowlist
    if (config.imageAllowlistPattern) {
      const re = new RegExp(config.imageAllowlistPattern);
      if (!re.test(body.expressImage)) {
        res.status(400).json({ error: `Image "${body.expressImage}" not allowed by IMAGE_ALLOWLIST_PATTERN` });
        return;
      }
    }

    // Validate or generate instance name
    const instanceName = body.instanceName ?? generateInstanceName();
    if (!INSTANCE_NAME_RE.test(instanceName)) {
      res.status(400).json({ error: `Invalid instance name "${instanceName}". Must match ${INSTANCE_NAME_RE}` });
      return;
    }

    // Check for existing instance
    if (registry.get(instanceName) || provisioner.instanceEnvExists(body.network, instanceName)) {
      res.status(409).json({ error: `Instance "${instanceName}" already exists` });
      return;
    }

    // Health gate
    const capacity = healthChecker.evaluate();
    if (!capacity.canProvision) {
      res.status(503).json({ error: `Cannot provision: ${capacity.reason}`, health: capacity });
      return;
    }

    // Register immediately with SCAFFOLDING status
    const instance: ManagedInstance = {
      id: instanceName,
      network: body.network,
      status: 'SCAFFOLDING',
      adminAddress: null,
      endpoints: null,
      apiKey: null,
      expressImage: body.expressImage,
      contestationPeriod: body.contestationPeriod,
      depositPeriod: body.depositPeriod,
      createdAt: new Date().toISOString(),
    };
    registry.add(instance);

    audit.log('scaffold_requested', { id: instanceName, network: body.network, expressImage: body.expressImage });

    // Return 202 immediately, scaffold in background
    res.status(202).json(toResponse(instance));

    // Background scaffolding
    scaffold(config, registry, provisioner, promSD, mutex, audit, instance).catch((err) => {
      console.error(`[scaffold] ${instanceName} failed:`, err);
    });
  });

  // GET /heads — list all instances
  router.get('/', (_req, res) => {
    res.json(registry.list().map(toResponse));
  });

  // GET /heads/:id — single instance
  router.get('/:id', (req, res) => {
    const inst = registry.get(req.params.id);
    if (!inst) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }
    res.json(toResponse(inst));
  });

  // DELETE /heads/:id — teardown
  router.delete('/:id', async (req, res) => {
    const inst = registry.get(req.params.id);
    if (!inst) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    if (inst.status === 'STOPPED') {
      res.json(toResponse(inst));
      return;
    }

    try {
      audit.log('teardown_requested', { id: inst.id, network: inst.network });
      await provisioner.stopContainers(inst.network, inst.id);
      const updated = registry.update(inst.id, { status: 'STOPPED', stoppedAt: new Date().toISOString() });
      promSD.write();
      audit.log('teardown_completed', { id: inst.id });
      res.json(toResponse(updated));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      registry.update(inst.id, { status: 'FAILED', error: `Teardown failed: ${msg}` });
      res.status(500).json({ error: `Teardown failed: ${msg}` });
    }
  });

  return router;
}

/**
 * Background scaffolding workflow:
 * 1. make create-instance (keys + env)
 * 2. Append EXPRESS_IMAGE + optional head params
 * 3. Parse env for allocated ports
 * 4. Read admin address
 * 5. make hydra-start (containers)
 * 6. Poll for readiness
 * 7. Update registry → READY
 * 8. Write Prometheus targets
 */
async function scaffold(
  config: OrchestratorConfig,
  registry: InstanceRegistry,
  provisioner: Provisioner,
  promSD: PrometheusServiceDiscovery,
  mutex: ScaffoldMutex,
  audit: AuditLog,
  instance: ManagedInstance,
): Promise<void> {
  const { id, network, expressImage } = instance;
  const release = await mutex.acquire(network);

  try {
    // Step 1: Create instance (keys + env file)
    console.log(`[scaffold] ${id}: creating instance...`);
    await provisioner.createInstance(network, id);

    // Step 2: Append EXPRESS_IMAGE and optional params
    provisioner.setExpressImage(network, id, expressImage);
    if (instance.contestationPeriod || instance.depositPeriod) {
      provisioner.setHeadParams(network, id, {
        contestationPeriod: instance.contestationPeriod,
        depositPeriod: instance.depositPeriod,
      });
    }

    // Step 3: Parse env for ports and API key
    const env = provisioner.readInstanceEnv(network, id);

    // Step 4: Read admin address
    const adminAddress = provisioner.readAdminAddress(network, id);

    // Step 5: Build endpoints
    const host = config.externalHost;
    const endpoints = {
      hydraApi: `http://${host}:${env.apiPort}`,
      hydraWs: `ws://${host}:${env.apiPort}`,
      trp: `http://${host}:${env.trpPort}`,
      express: `http://${host}:${env.expressPort}`,
      metrics: `http://${host}:${env.monitoringPort}/metrics`,
    };

    registry.update(id, { adminAddress, endpoints, apiKey: env.apiKey });

    // Step 6: Start containers
    console.log(`[scaffold] ${id}: starting containers...`);
    await provisioner.startContainers(network, id);

    // Release the mutex — container creation is done, readiness polling is safe to overlap
    release();

    // Step 7: Wait for hydra-node readiness
    console.log(`[scaffold] ${id}: waiting for hydra-node readiness...`);
    const ready = await provisioner.checkHydraReady(env.apiPort);
    if (!ready) {
      throw new Error(`Hydra node did not become ready within ${config.readinessTimeoutS}s`);
    }

    // Step 8: Mark READY
    registry.update(id, { status: 'READY', readyAt: new Date().toISOString() });
    promSD.write();
    audit.log('scaffold_completed', { id, network });
    console.log(`[scaffold] ${id}: READY`);
  } catch (err) {
    release();
    const msg = err instanceof Error ? err.message : String(err);
    audit.log('scaffold_failed', { id, network, error: msg });
    console.error(`[scaffold] ${id}: FAILED — ${msg}`);
    registry.update(id, { status: 'FAILED', error: msg });
  }
}
