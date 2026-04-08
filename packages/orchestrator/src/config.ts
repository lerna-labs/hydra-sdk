import { join, resolve } from 'node:path';

export interface OrchestratorConfig {
  /** Bearer token required on all API requests. */
  apiKey: string;
  /** Port the orchestrator listens on. */
  port: number;
  /** Absolute path to the monorepo root (where Makefile lives). */
  projectRoot: string;
  /** Hostname used in returned endpoint URLs. */
  externalHost: string;
  /** Allowed network names for provisioning. */
  allowedNetworks: string[];

  // Health thresholds
  maxCpuLoadRatio: number;
  minMemoryAvailableMb: number;
  maxDiskUtilPercent: number;
  maxInstances: number;

  /** Seconds to wait for hydra-node readiness after container start. */
  readinessTimeoutS: number;
  /** Seconds between readiness polls. */
  readinessPollIntervalS: number;

  /** Instance TTL in seconds. 0 = no auto-cleanup. */
  instanceTtlS: number;
  /** Seconds between cleanup sweeps. */
  cleanupIntervalS: number;

  /** Regex pattern for allowed Express middleware image names. Empty = allow all. */
  imageAllowlistPattern: string;
  /** Path to the append-only audit log file. */
  auditLogPath: string;
}

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

export function loadConfig(): OrchestratorConfig {
  return {
    apiKey: env('ORCHESTRATOR_API_KEY'),
    port: Number.parseInt(env('ORCHESTRATOR_PORT', '7000'), 10),
    projectRoot: resolve(env('PROJECT_ROOT', resolve(import.meta.dirname, '../../..'))),
    externalHost: env('EXTERNAL_HOST', 'localhost'),
    allowedNetworks: env('ALLOWED_NETWORKS', 'offline,preprod,mainnet').split(','),

    maxCpuLoadRatio: Number.parseFloat(env('MAX_CPU_LOAD_RATIO', '0.8')),
    minMemoryAvailableMb: Number.parseInt(env('MIN_MEMORY_AVAILABLE_MB', '2048'), 10),
    maxDiskUtilPercent: Number.parseInt(env('MAX_DISK_UTIL_PERCENT', '85'), 10),
    maxInstances: Number.parseInt(env('MAX_INSTANCES', '20'), 10),

    readinessTimeoutS: Number.parseInt(env('READINESS_TIMEOUT_S', '120'), 10),
    readinessPollIntervalS: Number.parseInt(env('READINESS_POLL_INTERVAL_S', '3'), 10),

    instanceTtlS: Number.parseInt(env('INSTANCE_TTL_S', '0'), 10),
    cleanupIntervalS: Number.parseInt(env('CLEANUP_INTERVAL_S', '300'), 10),

    imageAllowlistPattern: env('IMAGE_ALLOWLIST_PATTERN', ''),
    auditLogPath: env(
      'AUDIT_LOG_PATH',
      join(resolve(env('PROJECT_ROOT', resolve(import.meta.dirname, '../../..'))), 'data', 'orchestrator', 'audit.log'),
    ),
  };
}
