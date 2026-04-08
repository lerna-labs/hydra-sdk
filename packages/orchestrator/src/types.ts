// ── Instance lifecycle ────────────────────────────────────────────────

export type InstanceStatus = 'SCAFFOLDING' | 'READY' | 'STOPPED' | 'FAILED';

export interface InstanceEndpoints {
  hydraApi: string;
  hydraWs: string;
  trp: string;
  express: string;
  metrics: string;
}

export interface ManagedInstance {
  id: string;
  network: string;
  status: InstanceStatus;
  adminAddress: string | null;
  endpoints: InstanceEndpoints | null;
  apiKey: string | null;
  expressImage: string;
  contestationPeriod?: number;
  depositPeriod?: number;
  error?: string;
  createdAt: string;
  readyAt?: string;
  stoppedAt?: string;
}

// ── API request/response ─────────────────────────────────────────────

export interface ScaffoldRequest {
  network: string;
  expressImage: string;
  instanceName?: string;
  contestationPeriod?: number;
  depositPeriod?: number;
}

export interface ScaffoldResponse {
  id: string;
  network: string;
  status: InstanceStatus;
  adminAddress: string | null;
  endpoints: InstanceEndpoints | null;
  apiKey: string | null;
  createdAt: string;
}

// ── Host health ──────────────────────────────────────────────────────

export interface HostHealth {
  cpuLoadAvg1m: number;
  cpuLoadAvg5m: number;
  cpuCores: number;
  cpuLoadRatio: number;
  memTotalMb: number;
  memAvailableMb: number;
  memUsedPercent: number;
  diskIopsRead: number;
  diskIopsWrite: number;
}

export interface CapacityDecision {
  canProvision: boolean;
  reason?: string;
  activeInstances: number;
  maxInstances: number;
  host: HostHealth;
}

// ── Parsed instance env ──────────────────────────────────────────────

export interface ParsedInstanceEnv {
  apiPort: number;
  expressPort: number;
  listenPort: number;
  trpPort: number;
  monitoringPort: number;
  apiKey: string;
}
