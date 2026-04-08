import { join } from 'node:path';
import express from 'express';
import { loadConfig } from './config.js';
import { createHeadsRouter } from './routes/heads.js';
import { createHealthRouter } from './routes/health.js';
import { AuditLog } from './services/audit-log.js';
import { CleanupScheduler } from './services/cleanup-scheduler.js';
import { HealthChecker } from './services/health-checker.js';
import { InstanceRegistry } from './services/instance-registry.js';
import { PrometheusServiceDiscovery } from './services/prometheus-sd.js';
import { Provisioner } from './services/provisioner.js';
import { reconcileOnStartup } from './services/recovery.js';
import { ScaffoldMutex } from './services/scaffold-mutex.js';

const config = loadConfig();

// ── Services ─────────────────────────────────────────────────────────

const registry = new InstanceRegistry(join(config.projectRoot, 'data', 'orchestrator', 'instances.json'));
const provisioner = new Provisioner(config);
const healthChecker = new HealthChecker(config, () => registry.activeCount());
const promSD = new PrometheusServiceDiscovery(config, registry);
const mutex = new ScaffoldMutex();
const audit = new AuditLog(config.auditLogPath);
const cleanup = new CleanupScheduler(config, registry, provisioner, promSD);

// ── Express app ──────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Bearer token auth
app.use((req, res, next) => {
  // Allow health check without auth
  if (req.path === '/health') {
    next();
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${config.apiKey}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

app.use('/heads', createHeadsRouter(config, registry, provisioner, healthChecker, promSD, mutex, audit));
app.use('/health', createHealthRouter(healthChecker));

// ── Start ────────────────────────────────────────────────────────────

async function start() {
  // Reconcile persisted state with running containers
  await reconcileOnStartup(config, registry, promSD);

  const server = app.listen(config.port, () => {
    console.log(`Hydra Orchestrator listening on port ${config.port}`);
    console.log(`  Project root: ${config.projectRoot}`);
    console.log(`  External host: ${config.externalHost}`);
    console.log(`  Active instances: ${registry.activeCount()}`);

    // Write initial Prometheus targets from persisted state
    promSD.write();

    // Start cleanup scheduler
    cleanup.start();
  });

  // ── Graceful shutdown ──────────────────────────────────────────────

  function shutdown(signal: string) {
    console.log(`\n${signal} received — shutting down orchestrator (heads keep running)`);
    cleanup.stop();
    server.close(() => {
      console.log('Orchestrator stopped.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start orchestrator:', err);
  process.exit(1);
});
