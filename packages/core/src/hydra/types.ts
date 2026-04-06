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

/** Possible Hydra head states as reported in the `Greetings` message (mixed-case). */
export type HeadStatus = 'Idle' | 'Initializing' | 'Open' | 'Closed' | 'FanoutPossible' | 'Final';

/** Hydra status values (uppercase, as used by HydraProvider status tracking). */
export type HydraStatus = 'IDLE' | 'INITIALIZING' | 'OPEN' | 'CLOSED' | 'FANOUT_POSSIBLE' | 'FINAL';

/** @deprecated Use HydraStatus */
export type hydraStatus = HydraStatus;

/** Connection state of the WebSocket. */
export type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'FAILED' | 'DISCONNECTED';

// ── Client Messages (outbound) ───────────────────────────────────────

/** Messages that can be sent to the Hydra node over WebSocket. */
export type ClientInput =
  | { tag: 'Init' }
  | { tag: 'Abort' }
  | { tag: 'NewTx'; transaction: HydraTransaction }
  | { tag: 'Close' }
  | { tag: 'Contest' }
  | { tag: 'Fanout' }
  | { tag: 'Decommit'; transaction: HydraTransaction }
  | { tag: 'Recover'; recoverTxId: string };

// ── Server Messages (inbound) ────────────────────────────────────────

/** Greetings message received on initial WebSocket connection. */
export interface GreetingsMessage {
  tag: 'Greetings';
  me: { vkey: string };
  headStatus: HeadStatus;
  hydraHeadId?: string;
  snapshotUtxo?: HydraUTxOs;
  hydraNodeVersion?: string;
  env?: Record<string, unknown>;
  networkInfo?: Record<string, unknown>;
}

export interface HeadIsInitializingMessage {
  tag: 'HeadIsInitializing';
  headId: string;
  parties: { vkey: string }[];
  [key: string]: unknown;
}

export interface CommittedMessage {
  tag: 'Committed';
  party: { vkey: string };
  utxo: HydraUTxOs;
  [key: string]: unknown;
}

export interface HeadIsOpenMessage {
  tag: 'HeadIsOpen';
  utxo: HydraUTxOs;
  [key: string]: unknown;
}

export interface HeadIsClosedMessage {
  tag: 'HeadIsClosed';
  [key: string]: unknown;
}

export interface HeadIsContestedMessage {
  tag: 'HeadIsContested';
  [key: string]: unknown;
}

export interface ReadyToFanoutMessage {
  tag: 'ReadyToFanout';
  [key: string]: unknown;
}

export interface HeadIsAbortedMessage {
  tag: 'HeadIsAborted';
  [key: string]: unknown;
}

export interface HeadIsFinalizedMessage {
  tag: 'HeadIsFinalized';
  [key: string]: unknown;
}

export interface TxValidMessage {
  tag: 'TxValid';
  transaction: HydraTransaction;
  [key: string]: unknown;
}

export interface TxInvalidMessage {
  tag: 'TxInvalid';
  transaction: HydraTransaction;
  validationError: { reason: string };
  [key: string]: unknown;
}

export interface SnapshotConfirmedMessage {
  tag: 'SnapshotConfirmed';
  [key: string]: unknown;
}

export interface DecommitApprovedMessage {
  tag: 'DecommitApproved';
  [key: string]: unknown;
}

export interface DecommitInvalidMessage {
  tag: 'DecommitInvalid';
  decommitInvalidReason: unknown;
  [key: string]: unknown;
}

export interface DecommitFinalizedMessage {
  tag: 'DecommitFinalized';
  [key: string]: unknown;
}

export interface CommitFinalizedMessage {
  tag: 'CommitFinalized';
  [key: string]: unknown;
}

export interface CommitApprovedMessage {
  tag: 'CommitApproved';
  [key: string]: unknown;
}

export interface CommandFailedMessage {
  tag: 'CommandFailed';
  clientInput: ClientInput;
  [key: string]: unknown;
}

export interface PostTxOnChainFailedMessage {
  tag: 'PostTxOnChainFailed';
  [key: string]: unknown;
}

/** Catch-all for message types not explicitly defined above. */
export interface UnknownMessage {
  tag: string;
  [key: string]: unknown;
}

/** All possible messages the Hydra node can send over its WebSocket API. */
export type ServerOutput =
  | GreetingsMessage
  | HeadIsInitializingMessage
  | CommittedMessage
  | HeadIsOpenMessage
  | HeadIsClosedMessage
  | HeadIsContestedMessage
  | ReadyToFanoutMessage
  | HeadIsAbortedMessage
  | HeadIsFinalizedMessage
  | TxValidMessage
  | TxInvalidMessage
  | SnapshotConfirmedMessage
  | DecommitApprovedMessage
  | DecommitInvalidMessage
  | DecommitFinalizedMessage
  | CommitFinalizedMessage
  | CommitApprovedMessage
  | CommandFailedMessage
  | PostTxOnChainFailedMessage
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
