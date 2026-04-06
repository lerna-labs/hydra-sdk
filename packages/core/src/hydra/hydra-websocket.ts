import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { ClientInput, ConnectionState, HeadStatus, HydraStatus, HydraWsMessage } from './types.js';

export const HEAD_STATUS_TO_HYDRA: Record<HeadStatus, HydraStatus> = {
  Idle: 'IDLE',
  Initializing: 'INITIALIZING',
  Open: 'OPEN',
  Closed: 'CLOSED',
  FanoutPossible: 'FANOUT_POSSIBLE',
  Final: 'FINAL',
};

export const TAG_TO_HYDRA: Record<string, HydraStatus> = {
  HeadIsInitializing: 'INITIALIZING',
  HeadIsOpen: 'OPEN',
  HeadIsClosed: 'CLOSED',
  ReadyToFanout: 'FANOUT_POSSIBLE',
  HeadIsFinalized: 'FINAL',
};

/**
 * Thin WebSocket wrapper for the Hydra node.
 *
 * Uses `EventEmitter` for multi-listener message dispatch (no single-callback
 * overwrite). Emits:
 *
 * - `'message'`  — `(msg: HydraWsMessage)` for every incoming message
 * - `'status'`   — `(status: HydraStatus)` on head-status changes
 * - `'error'`    — `(err: Error)`
 * - `'close'`    — `()`
 */
export class HydraWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private _status: HydraStatus = 'IDLE';
  private _connectionState: ConnectionState = 'IDLE';
  private _lastGreetings: HydraWsMessage | null = null;

  constructor(wsUrl: string) {
    super();
    this.url = wsUrl;
  }

  /** Current connection state. */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  /** Open the WebSocket connection. Resolves when the socket is open. */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);

      ws.on('open', () => {
        this.ws = ws;
        this._connectionState = 'CONNECTING';
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as HydraWsMessage;
          this.handleMessage(msg);
        } catch {
          // Ignore non-JSON messages
        }
      });

      ws.on('error', (err) => {
        this._connectionState = 'FAILED';
        this.emit('error', err);
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      ws.on('close', () => {
        this._connectionState = 'DISCONNECTED';
        this.ws = null;
        this.emit('close');
      });
    });
  }

  /**
   * Connect and wait for the Greetings message from the Hydra node.
   *
   * Unlike `HydraProvider.isConnected()`, this does NOT overwrite existing
   * message handlers — it uses a one-time EventEmitter listener.
   */
  async waitForGreetings(timeoutMs = 30_000): Promise<boolean> {
    if (this._connectionState === 'CONNECTED') return true;

    // Register the listener BEFORE connecting so the Greetings message
    // (which the Hydra node sends immediately after the socket opens)
    // cannot arrive before we're listening for it.
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('message', onMsg);
        this._connectionState = 'FAILED';
        reject(new Error('Connection timed out: no Greetings from Hydra node'));
      }, timeoutMs);

      const onMsg = (msg: HydraWsMessage) => {
        if (msg.tag === 'Greetings') {
          clearTimeout(timer);
          this.removeListener('message', onMsg);
          this._connectionState = 'CONNECTED';
          resolve(true);
        }
      };

      this.on('message', onMsg);

      this.connect().catch((err) => {
        clearTimeout(timer);
        this.removeListener('message', onMsg);
        reject(err);
      });
    });
  }

  /** Close the WebSocket. */
  async disconnect(timeoutMs = 5000): Promise<void> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this._connectionState = 'DISCONNECTED';
      return;
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.ws?.terminate();
        this._connectionState = 'DISCONNECTED';
        this.ws = null;
        resolve();
      }, timeoutMs);

      this.ws!.on('close', () => {
        clearTimeout(timer);
        this._connectionState = 'DISCONNECTED';
        this.ws = null;
        resolve();
      });

      this.ws!.close();
    });
  }

  /** Send a ClientInput message as JSON over the WebSocket. */
  send(message: ClientInput): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /** Current Hydra head status derived from messages. */
  getStatus(): HydraStatus {
    return this._status;
  }

  /** Register a status-change listener. Returns current status. */
  onStatusChange(callback: (status: HydraStatus) => void): HydraStatus {
    this.on('status', callback);
    return this._status;
  }

  /** The last Greetings message received, if any. */
  get lastGreetings(): HydraWsMessage | null {
    return this._lastGreetings;
  }

  private handleMessage(msg: HydraWsMessage): void {
    if (msg.tag === 'Greetings') {
      this._lastGreetings = msg;
    }

    this.emit('message', msg);

    // Update status from Greetings headStatus
    if (msg.tag === 'Greetings' && 'headStatus' in msg) {
      const mapped = HEAD_STATUS_TO_HYDRA[msg.headStatus as HeadStatus];
      if (mapped) this.updateStatus(mapped);
      return;
    }

    // Update status from state transition messages
    const mapped = TAG_TO_HYDRA[msg.tag];
    if (mapped) this.updateStatus(mapped);
  }

  private updateStatus(newStatus: HydraStatus): void {
    if (this._status !== newStatus) {
      this._status = newStatus;
      this.emit('status', newStatus);
    }
  }
}
