// ── Hydra Transaction ────────────────────────────────────────────────

/** A Cardano transaction in Hydra's wire format. */
export type HydraTransaction = {
  type: 'Tx ConwayEra' | 'Unwitnessed Tx ConwayEra' | 'Witnessed Tx ConwayEra';
  description: string;
  cborHex: string;
  txId?: string;
};

/** @deprecated Use HydraTransaction */
export type hydraTransaction = HydraTransaction;

// ── Hydra Assets ─────────────────────────────────────────────────────

/** Hydra's nested asset value format: `{ lovelace: N, policyId: { assetNameHex: N } }`. */
export type HydraAssets = { lovelace: number } & {
  [policyId: string]: number | { [assetNameHex: string]: number };
};

// ── Hydra UTxO ───────────────────────────────────────────────────────

export interface HydraReferenceScript {
  script: {
    cborHex: string;
    description: string;
    type: string | null;
  };
  scriptLanguage: string;
}

/** A single UTxO entry in Hydra's wire format. */
export interface HydraUTxOEntry {
  address: string;
  datum: string | null;
  inlineDatum: object | null;
  inlineDatumRaw: string | null;
  inlineDatumhash: string | null;
  referenceScript: HydraReferenceScript | null;
  value: HydraAssets;
}

/** A set of UTxOs keyed by `"txHash#outputIndex"`. */
export type HydraUTxOs = { [txRef: string]: HydraUTxOEntry };

/** Payload for blueprint-based commits. */
export interface CommitBlueprintPayload {
  blueprintTx: HydraTransaction;
  utxo: HydraUTxOs;
}

// ── Head Status ──────────────────────────────────────────────────────

/**
 * Possible Hydra head states as reported in the `Greetings` message (mixed-case).
 *
 * As of Hydra v2 (ADR-33) the head opens directly into `Open` — there is no
 * longer an `Initializing` phase.
 */
export type HeadStatus = 'Idle' | 'Open' | 'Closed' | 'FanoutPossible' | 'Final';

/** Hydra status values (uppercase, as used by HydraProvider status tracking). */
export type HydraStatus = 'IDLE' | 'OPEN' | 'CLOSED' | 'FANOUT_POSSIBLE' | 'FINAL';

/** @deprecated Use HydraStatus */
export type hydraStatus = HydraStatus;

/** Connection state of the WebSocket. */
export type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED';

// ── Snapshot ─────────────────────────────────────────────────────────

/** A confirmed Hydra L2 snapshot. */
export interface HydraSnapshot {
  headId: string;
  version: number;
  number: number;
  confirmed: HydraTransaction[];
  utxo: HydraUTxOs;
  utxoToCommit: HydraUTxOs | null;
  utxoToDecommit: HydraUTxOs | null;
}

/** Multi-party aggregate signature map. */
export type MultiSignature = Record<string, string>;

/** Discriminated union for confirmed snapshot variants. */
export type ConfirmedSnapshot =
  | { tag: 'InitialSnapshot'; headId: string; initialUTxO?: HydraUTxOs }
  | { tag: 'ConfirmedSnapshot'; snapshot: HydraSnapshot; signatures: MultiSignature };

// ── Client Messages (outbound) ───────────────────────────────────────

/** Messages that can be sent to the Hydra node over WebSocket. */
export type ClientInput =
  | { tag: 'Init' }
  | { tag: 'NewTx'; transaction: HydraTransaction }
  | { tag: 'Close' }
  | { tag: 'SafeClose' }
  | { tag: 'Contest' }
  | { tag: 'Fanout' }
  | { tag: 'Decommit'; decommitTx: HydraTransaction }
  | { tag: 'Recover'; recoverTxId: string }
  | { tag: 'SideLoadSnapshot'; snapshot: ConfirmedSnapshot };

// ── Server Messages (inbound) ────────────────────────────────────────

/** Hydra node environment info reported in Greetings. */
export interface HydraEnv {
  party: { vkey: string };
  signingKey?: string;
  otherParties: { vkey: string }[];
  participants: string[];
  contestationPeriod: number;
  depositPeriod: number;
  unsyncedPeriod?: number;
  configuredPeers: string;
  [key: string]: unknown;
}

/** Network connectivity info reported in Greetings. */
export interface HydraNetworkInfo {
  networkConnected: boolean;
  peersInfo: Record<string, unknown>;
  [key: string]: unknown;
}

/** Greetings message received on initial WebSocket connection. */
export interface GreetingsMessage {
  tag: 'Greetings';
  me: { vkey: string };
  headStatus: HeadStatus;
  hydraHeadId?: string;
  snapshotUtxo?: HydraUTxOs;
  timestamp?: string;
  hydraNodeVersion: string;
  env: HydraEnv;
  networkInfo: HydraNetworkInfo;
  chainSyncedStatus: string;
  currentSlot: number;
}

/**
 * Summary of Hydra head info extracted from the Greetings message.
 * Excludes the full UTxO snapshot to keep payloads small.
 */
export interface HydraHeadInfo {
  headStatus: HeadStatus;
  headId: string | null;
  nodeVersion: string | null;
  me: string;
  contestationPeriod: number | null;
  depositPeriod: number | null;
  participants: string[];
  networkConnected: boolean;
  peerCount: number;
  chainSyncedStatus: string | null;
  currentSlot: number | null;
}

// ── Head lifecycle messages ──────────────────────────────────────────
//
// As of Hydra v2 (ADR-33) the head-initialization phase is gone: `Init`
// opens the head directly with an empty UTxO set. There are no longer any
// `HeadIsInitializing`, `Committed`, or `HeadIsAborted` server outputs.

export interface HeadIsOpenMessage {
  tag: 'HeadIsOpen';
  headId: string;
  utxo: HydraUTxOs;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface HeadIsClosedMessage {
  tag: 'HeadIsClosed';
  headId: string;
  snapshotNumber: number;
  contestationDeadline: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface HeadIsContestedMessage {
  tag: 'HeadIsContested';
  headId: string;
  snapshotNumber: number;
  contestationDeadline: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface ReadyToFanoutMessage {
  tag: 'ReadyToFanout';
  headId: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface HeadIsFinalizedMessage {
  tag: 'HeadIsFinalized';
  headId: string;
  utxo: HydraUTxOs;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

// ── Transaction messages ─────────────────────────────────────────────

export interface TxValidMessage {
  tag: 'TxValid';
  headId: string;
  transactionId: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface TxInvalidMessage {
  tag: 'TxInvalid';
  headId: string;
  utxo: HydraUTxOs;
  transaction: HydraTransaction;
  validationError: { reason: string };
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface SnapshotConfirmedMessage {
  tag: 'SnapshotConfirmed';
  headId: string;
  snapshot: HydraSnapshot;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface SnapshotSideLoadedMessage {
  tag: 'SnapshotSideLoaded';
  headId: string;
  snapshotNumber: number;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

// ── Commit / Deposit messages ────────────────────────────────────────

export interface CommitRecordedMessage {
  tag: 'CommitRecorded';
  headId: string;
  utxoToCommit: HydraUTxOs;
  pendingDeposit: string;
  deadline: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface CommitApprovedMessage {
  tag: 'CommitApproved';
  headId: string;
  utxoToCommit: HydraUTxOs;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface CommitFinalizedMessage {
  tag: 'CommitFinalized';
  headId: string;
  depositTxId: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface CommitRecoveredMessage {
  tag: 'CommitRecovered';
  headId: string;
  recoveredUTxO: HydraUTxOs;
  recoveredTxId: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface DepositActivatedMessage {
  tag: 'DepositActivated';
  headId: string;
  depositTxId: string;
  deadline: string;
  chainTime: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface DepositExpiredMessage {
  tag: 'DepositExpired';
  headId: string;
  depositTxId: string;
  deadline: string;
  chainTime: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

// ── Decommit messages ────────────────────────────────────────────────

export interface DecommitRequestedMessage {
  tag: 'DecommitRequested';
  headId: string;
  decommitTx: HydraTransaction;
  utxoToDecommit: HydraUTxOs;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface DecommitApprovedMessage {
  tag: 'DecommitApproved';
  headId: string;
  decommitTxId: string;
  utxoToDecommit: HydraUTxOs;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface DecommitFinalizedMessage {
  tag: 'DecommitFinalized';
  headId: string;
  distributedUTxO: HydraUTxOs;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface DecommitInvalidMessage {
  tag: 'DecommitInvalid';
  headId: string;
  decommitTx: HydraTransaction;
  decommitInvalidReason:
    | { tag: 'DecommitTxInvalid'; localUTxO: HydraUTxOs; validationError: { reason: string } }
    | { tag: 'DecommitAlreadyInFlight'; otherDecommitTxId: string };
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

// ── Error / status messages ──────────────────────────────────────────

export interface CommandFailedMessage {
  tag: 'CommandFailed';
  clientInput: ClientInput;
  state: unknown;
  [key: string]: unknown;
}

export interface PostTxOnChainFailedMessage {
  tag: 'PostTxOnChainFailed';
  postChainTx: unknown;
  postTxError: unknown;
  [key: string]: unknown;
}

export interface InvalidInputMessage {
  tag: 'InvalidInput';
  reason: string;
  input: string;
  [key: string]: unknown;
}

export interface RejectedInputBecauseUnsyncedMessage {
  tag: 'RejectedInputBecauseUnsynced';
  clientInput: ClientInput;
  drift: number;
  [key: string]: unknown;
}

export interface SideLoadSnapshotRejectedMessage {
  tag: 'SideLoadSnapshotRejected';
  clientInput: ClientInput;
  requirementFailure: unknown;
  [key: string]: unknown;
}

// ── Network / peer messages ──────────────────────────────────────────

export interface PeerConnectedMessage {
  tag: 'PeerConnected';
  peer: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface PeerDisconnectedMessage {
  tag: 'PeerDisconnected';
  peer: string;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface NetworkConnectedMessage {
  tag: 'NetworkConnected';
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface NetworkDisconnectedMessage {
  tag: 'NetworkDisconnected';
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface NetworkVersionMismatchMessage {
  tag: 'NetworkVersionMismatch';
  ourVersion: unknown;
  theirVersion: unknown;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface NetworkClusterIDMismatchMessage {
  tag: 'NetworkClusterIDMismatch';
  clusterPeers?: unknown;
  misconfiguredPeers?: unknown;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

// ── Sync / node status messages ──────────────────────────────────────

export interface SyncedStatusReportMessage {
  tag: 'SyncedStatusReport';
  chainSlot: number;
  chainTime: string;
  drift: number;
  synced: string;
  [key: string]: unknown;
}

export interface NodeSyncedMessage {
  tag: 'NodeSynced';
  chainSlot: number;
  chainTime: string;
  drift: number;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

export interface NodeUnsyncedMessage {
  tag: 'NodeUnsynced';
  chainSlot: number;
  chainTime: string;
  drift: number;
  seq: number;
  timestamp: string;
  [key: string]: unknown;
}

// ── Misc messages ────────────────────────────────────────────────────

export interface EventLogRotatedMessage {
  tag: 'EventLogRotated';
  seq: number;
  checkpoint: unknown;
  timestamp: string;
  [key: string]: unknown;
}

/** Catch-all for message types not explicitly defined above. */
export interface UnknownMessage {
  tag: string;
  [key: string]: unknown;
}

// ── Server Output union ──────────────────────────────────────────────

/** All possible messages the Hydra node can send over its WebSocket API. */
export type ServerOutput =
  // Greetings
  | GreetingsMessage
  // Head lifecycle
  | HeadIsOpenMessage
  | HeadIsClosedMessage
  | HeadIsContestedMessage
  | ReadyToFanoutMessage
  | HeadIsFinalizedMessage
  // Transactions & snapshots
  | TxValidMessage
  | TxInvalidMessage
  | SnapshotConfirmedMessage
  | SnapshotSideLoadedMessage
  // Commits / deposits
  | CommitRecordedMessage
  | CommitApprovedMessage
  | CommitFinalizedMessage
  | CommitRecoveredMessage
  | DepositActivatedMessage
  | DepositExpiredMessage
  // Decommits
  | DecommitRequestedMessage
  | DecommitApprovedMessage
  | DecommitFinalizedMessage
  | DecommitInvalidMessage
  // Errors
  | CommandFailedMessage
  | PostTxOnChainFailedMessage
  | InvalidInputMessage
  | RejectedInputBecauseUnsyncedMessage
  | SideLoadSnapshotRejectedMessage
  // Network / peers
  | PeerConnectedMessage
  | PeerDisconnectedMessage
  | NetworkConnectedMessage
  | NetworkDisconnectedMessage
  | NetworkVersionMismatchMessage
  | NetworkClusterIDMismatchMessage
  // Sync status
  | SyncedStatusReportMessage
  | NodeSyncedMessage
  | NodeUnsyncedMessage
  // Misc
  | EventLogRotatedMessage
  // Catch-all
  | UnknownMessage;

/** Client echo messages (errors, command failures). */
export type ClientMessage = CommandFailedMessage | PostTxOnChainFailedMessage;

/** Any message received via the Hydra WebSocket. */
export type HydraWsMessage = ServerOutput | ClientMessage;

/**
 * Extract a specific message type from the `ServerOutput` union by its `tag`.
 *
 * @example
 * ```ts
 * type Greetings = HydraMessage<"Greetings">;
 * ```
 */
export type HydraMessage<T extends ServerOutput['tag']> = Extract<ServerOutput, { tag: T }>;

// ── Monitor Types ────────────────────────────────────────────────────

/** Configuration options for HydraMonitor. */
export interface HydraMonitorOptions {
  /** Hydra node WebSocket URL. */
  wsUrl: string;
  /** Auto-reconnect configuration. */
  reconnect?: {
    /** Whether to reconnect on unexpected close. Default: `true`. */
    enabled?: boolean;
    /** Initial retry delay in milliseconds. Default: `1000`. */
    baseDelayMs?: number;
    /** Maximum retry delay in milliseconds. Default: `30000`. */
    maxDelayMs?: number;
    /** Maximum reconnect attempts. Default: `Infinity` (keep trying forever). */
    maxAttempts?: number;
  };
  /** Number of recent events to retain in the ring buffer. Default: `100`. */
  eventBufferSize?: number;
}

/** A timestamped Hydra WebSocket event for the recent events buffer. */
export interface TimestampedEvent {
  /** Unix timestamp (ms) when the message was received. */
  timestamp: number;
  /** The raw Hydra message. */
  message: HydraWsMessage;
}
