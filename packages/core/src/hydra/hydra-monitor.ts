import { EventEmitter } from 'node:events';
import { HEAD_STATUS_TO_HYDRA, HydraWebSocket, TAG_TO_HYDRA } from './hydra-websocket.js';
import type {
  GreetingsMessage,
  HeadStatus,
  HydraHeadInfo,
  HydraMessage,
  HydraMonitorOptions,
  HydraStatus,
  HydraWsMessage,
  ServerOutput,
  TimestampedEvent,
} from './types.js';

const HYDRA_TO_HEAD_STATUS: Record<HydraStatus, HeadStatus> = {
  IDLE: 'Idle',
  INITIALIZING: 'Initializing',
  OPEN: 'Open',
  CLOSED: 'Closed',
  FANOUT_POSSIBLE: 'FanoutPossible',
  FINAL: 'Final',
};

/**
 * Persistent WebSocket monitor for a Hydra head.
 *
 * Maintains a single long-lived WebSocket connection with auto-reconnect,
 * real-time head state tracking, and proactive error surfacing.
 *
 * Events emitted:
 * - `'message'`        — `(msg: HydraWsMessage)` for every incoming message
 * - `'status'`         — `(status: HydraStatus, previous: HydraStatus)` on head-status changes
 * - `'error:tx'`       — `(msg)` on PostTxOnChainFailed or TxInvalid
 * - `'error:command'`  — `(msg)` on CommandFailed
 * - `'error:decommit'` — `(msg)` on DecommitInvalid
 * - `'connected'`      — `()` WebSocket open + Greetings received
 * - `'disconnected'`   — `()` WebSocket closed (reconnect may follow)
 * - `'reconnecting'`   — `(attempt: number, delayMs: number)`
 * - `'reconnect_failed'` — `()` maxAttempts exhausted
 *
 * @example
 * ```ts
 * const monitor = new HydraMonitor({ wsUrl: 'ws://hydra-node:4102' });
 * await monitor.start();
 * console.log(monitor.headStatus); // 'IDLE'
 * monitor.on('status', (s, prev) => console.log(`${prev} → ${s}`));
 * ```
 */
export class HydraMonitor extends EventEmitter {
  public readonly ws: HydraWebSocket;
  private _headStatus: HydraStatus = 'IDLE';
  private _previousStatus: HydraStatus = 'IDLE';
  private _events: TimestampedEvent[] = [];
  private _stopped = true;
  private _reconnecting = false;

  private readonly reconnectEnabled: boolean;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly eventBufferSize: number;

  private readonly boundOnMessage = (msg: HydraWsMessage) => this.onMessage(msg);
  private readonly boundOnClose = () => this.onClose();

  constructor(options: HydraMonitorOptions) {
    super();
    this.ws = new HydraWebSocket(options.wsUrl);
    this.reconnectEnabled = options.reconnect?.enabled ?? true;
    this.baseDelayMs = options.reconnect?.baseDelayMs ?? 1000;
    this.maxDelayMs = options.reconnect?.maxDelayMs ?? 30_000;
    this.maxAttempts = options.reconnect?.maxAttempts ?? Number.POSITIVE_INFINITY;
    this.eventBufferSize = options.eventBufferSize ?? 100;
  }

  /** Connect to the Hydra node. Resolves after Greetings received. */
  async start(): Promise<void> {
    this._stopped = false;
    await this.ws.waitForGreetings();
    this.ws.on('message', this.boundOnMessage);
    this.ws.on('close', this.boundOnClose);

    // Process the Greetings that was received during waitForGreetings
    if (this.ws.lastGreetings) {
      this.onMessage(this.ws.lastGreetings);
    }

    this.emit('connected');
  }

  /** Disconnect and stop reconnecting. */
  async stop(): Promise<void> {
    this._stopped = true;
    this.ws.removeListener('message', this.boundOnMessage);
    this.ws.removeListener('close', this.boundOnClose);
    await this.ws.disconnect();
    this.emit('disconnected');
  }

  /** Whether the monitor is actively connected and listening. */
  get connected(): boolean {
    return this.ws.connectionState === 'CONNECTED';
  }

  /** Current head status (uppercase). */
  get headStatus(): HydraStatus {
    return this._headStatus;
  }

  /** Current head status (mixed-case, as reported in Greetings). */
  get headStatusMixed(): HeadStatus {
    return HYDRA_TO_HEAD_STATUS[this._headStatus];
  }

  /** The full Greetings message from the most recent connection. */
  get greetings(): GreetingsMessage | null {
    return this.ws.lastGreetings as GreetingsMessage | null;
  }

  /**
   * Summary of Hydra head info extracted from the last Greetings.
   * Excludes the full UTxO snapshot to keep payloads small.
   * Returns `null` if no Greetings has been received yet.
   */
  get headInfo(): HydraHeadInfo | null {
    const g = this.greetings;
    if (!g) return null;

    const peers = g.env?.configuredPeers;
    const peerCount = peers ? peers.split(',').filter(Boolean).length : 0;

    return {
      headStatus: g.headStatus,
      headId: g.hydraHeadId ?? null,
      nodeVersion: g.hydraNodeVersion ?? null,
      me: g.me.vkey,
      contestationPeriod: g.env?.contestationPeriod ?? null,
      depositPeriod: g.env?.depositPeriod ?? null,
      participants: g.env?.participants ?? [],
      networkConnected: g.networkInfo?.networkConnected ?? false,
      peerCount,
      chainSyncedStatus: g.chainSyncedStatus ?? null,
      currentSlot: g.currentSlot ?? null,
    };
  }

  /** The last N events (configurable via eventBufferSize). Most recent last. */
  get recentEvents(): readonly TimestampedEvent[] {
    return this._events;
  }

  /**
   * Wait for headStatus to reach the target. Resolves immediately if already there.
   * @param target - The HydraStatus to wait for.
   * @param timeoutMs - Maximum wait time (default 60s).
   */
  waitForStatus(target: HydraStatus, timeoutMs = 60_000): Promise<void> {
    if (this._headStatus === target) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('status', onStatus);
        reject(new Error(`Timeout waiting for status "${target}" (current: "${this._headStatus}")`));
      }, timeoutMs);

      const onStatus = (status: HydraStatus) => {
        if (status === target) {
          clearTimeout(timer);
          this.removeListener('status', onStatus);
          resolve();
        }
      };

      this.on('status', onStatus);
    });
  }

  /**
   * Wait for the next message matching the given tag.
   * @param tag - The message tag to wait for.
   * @param timeoutMs - Maximum wait time (default 60s).
   */
  waitForMessage<T extends ServerOutput['tag']>(tag: T, timeoutMs = 60_000): Promise<HydraMessage<T>> {
    return new Promise<HydraMessage<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('message', onMsg);
        reject(new Error(`Timeout waiting for message "${tag}"`));
      }, timeoutMs);

      const onMsg = (msg: HydraWsMessage) => {
        if (msg.tag === tag) {
          clearTimeout(timer);
          this.removeListener('message', onMsg);
          resolve(msg as HydraMessage<T>);
        }
      };

      this.on('message', onMsg);
    });
  }

  private onMessage(msg: HydraWsMessage): void {
    // Ring buffer
    this._events.push({ timestamp: Date.now(), message: msg });
    if (this._events.length > this.eventBufferSize) {
      this._events.shift();
    }

    // Forward to listeners
    this.emit('message', msg);

    // Status tracking
    if (msg.tag === 'Greetings' && 'headStatus' in msg) {
      const mapped = HEAD_STATUS_TO_HYDRA[msg.headStatus as HeadStatus];
      if (mapped) this.updateStatus(mapped);
    } else if (msg.tag === 'HeadIsAborted') {
      this.updateStatus('IDLE');
    } else {
      const mapped = TAG_TO_HYDRA[msg.tag];
      if (mapped) this.updateStatus(mapped);
    }

    // Error routing
    if (msg.tag === 'PostTxOnChainFailed' || msg.tag === 'TxInvalid') {
      this.emit('error:tx', msg);
    } else if (msg.tag === 'CommandFailed') {
      this.emit('error:command', msg);
    } else if (msg.tag === 'DecommitInvalid') {
      this.emit('error:decommit', msg);
    }
  }

  private updateStatus(newStatus: HydraStatus): void {
    if (this._headStatus !== newStatus) {
      this._previousStatus = this._headStatus;
      this._headStatus = newStatus;
      this.emit('status', newStatus, this._previousStatus);
    }
  }

  private onClose(): void {
    if (this._stopped) return;
    this.ws.removeListener('message', this.boundOnMessage);
    this.ws.removeListener('close', this.boundOnClose);
    if (this.reconnectEnabled) {
      this.reconnectLoop();
    } else {
      this.emit('disconnected');
    }
  }

  private async reconnectLoop(): Promise<void> {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this.emit('disconnected');

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (this._stopped) {
        this._reconnecting = false;
        return;
      }

      const delay = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
      this.emit('reconnecting', attempt + 1, delay);

      await new Promise((r) => setTimeout(r, delay));

      if (this._stopped) {
        this._reconnecting = false;
        return;
      }

      try {
        await this.ws.waitForGreetings();
        this.ws.on('message', this.boundOnMessage);
        this.ws.on('close', this.boundOnClose);

        // Process the Greetings from the new connection
        if (this.ws.lastGreetings) {
          this.onMessage(this.ws.lastGreetings);
        }

        this._reconnecting = false;
        this.emit('connected');
        return;
      } catch {
        // Retry on next iteration
      }
    }

    this._reconnecting = false;
    this.emit('reconnect_failed');
  }
}
