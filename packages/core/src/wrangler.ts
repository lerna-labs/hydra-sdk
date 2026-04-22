import { BlockfrostProvider } from '@meshsdk/core';
import { requireEnv } from './config.js';
import { HydraHttpClient } from './hydra/hydra-http-client.js';
import type { HydraMonitor } from './hydra/hydra-monitor.js';
import { HydraWebSocket } from './hydra/hydra-websocket.js';
import type { HeadStatus, HydraStatus, HydraTransaction, HydraWsMessage } from './hydra/types.js';
import { toHydraUTxO, toHydraUTxOs } from './hydra/utxo-conversion.js';

const HYDRA_TO_HEAD_STATUS: Record<HydraStatus, HeadStatus> = {
  IDLE: 'Idle',
  INITIALIZING: 'Initializing',
  OPEN: 'Open',
  CLOSED: 'Closed',
  FANOUT_POSSIBLE: 'FanoutPossible',
  FINAL: 'Final',
};

/** UTxO reference for committing funds into a Hydra head. */
export interface UTxORef {
  /** Transaction hash containing the UTxO. */
  txHash: string;
  /** Output index of the UTxO within the transaction. */
  outputIndex: number;
}

/** Arguments for committing UTxOs into a Hydra head. */
export interface CommitArgs {
  /** One or more UTxO references to commit. */
  utxos: UTxORef[];
  /** Blueprint transaction that spends the committed UTxOs (CBOR-encoded, unsigned). Optional — omit for simple ADA-only commits. */
  blueprintTx?: HydraTransaction;
}

/**
 * High-level controller for Hydra head lifecycle operations.
 *
 * Wraps `HydraWebSocket` and `HydraHttpClient` to provide a simplified API
 * for initializing, opening, and closing a Hydra head.
 *
 * @example
 * ```ts
 * const wrangler = new Wrangler("http://localhost:4001", "ws://localhost:4001");
 * await wrangler.waitForHeadOpen({
 *   utxos: [{ txHash: "abc...", outputIndex: 0 }],
 *   blueprintTx: { type: "Tx ConwayEra", cborHex: "...", description: "" },
 * });
 * ```
 */
export class Wrangler {
  private mode: 'start' | 'shutdown' | undefined;
  public readonly ws: HydraWebSocket;
  public readonly http: HydraHttpClient;
  private readonly blockfrost: BlockfrostProvider;
  private readonly monitor: HydraMonitor | null;

  constructor(url?: string, wsUrl?: string, monitor?: HydraMonitor) {
    const httpUrl = url || requireEnv('HYDRA_API_URL');
    this.blockfrost = new BlockfrostProvider(requireEnv('BLOCKFROST_API_KEY'));
    this.http = new HydraHttpClient(httpUrl);
    this.monitor = monitor ?? null;

    if (monitor) {
      // Share the monitor's WebSocket — no new connections
      this.ws = monitor.ws;
    } else {
      const socketUrl = wsUrl || requireEnv('HYDRA_WS_URL');
      this.ws = new HydraWebSocket(socketUrl);
    }
  }

  /**
   * Connect to the Hydra node with exponential-backoff retry.
   *
   * Uses `HydraWebSocket.waitForGreetings()` which establishes the WebSocket
   * **and** waits for the Hydra `Greetings` handshake.
   *
   * @param maxAttempts - Maximum number of connection attempts (default 5).
   * @param baseDelayMs - Initial retry delay in milliseconds (default 1000). Doubles each attempt, capped at 30 s.
   */
  private async connectWithRetry(maxAttempts = 5, baseDelayMs = 1000): Promise<void> {
    // When using a monitor, the WebSocket is already connected
    if (this.monitor?.connected) return;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const connected = await this.ws.waitForGreetings();
        if (connected) return;
        throw new Error('waitForGreetings() returned false');
      } catch (err) {
        if (attempt === maxAttempts - 1) {
          throw new Error(`Failed to connect after ${maxAttempts} attempts: ${String(err)}`);
        }
        const delay = Math.min(baseDelayMs * 2 ** attempt, 30_000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /**
   * Shared helper for promise-based methods that wait for a specific
   * Hydra message. Handles connection, timeout, and settlement in one place.
   *
   * Uses EventEmitter `on`/`removeListener` for multi-listener support,
   * avoiding the single-callback overwrite bug in HydraProvider.
   */
  private awaitMessage<T>(
    handler: (message: HydraWsMessage, resolve: (value: T) => void, reject: (reason: Error) => void) => void,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const settle = <V>(fn: (v: V) => void, value: V) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws.removeListener('message', onMsg);
        fn(value);
      };

      const timer = setTimeout(() => settle(reject, new Error(timeoutMessage)), timeoutMs);

      const onMsg = (message: HydraWsMessage) => {
        handler(
          message,
          (value) => settle(resolve, value),
          (reason) => settle(reject, reason),
        );
      };

      this.connectWithRetry()
        .then(() => {
          this.ws.on('message', onMsg);
          // Replay the Greetings message that was consumed during connection.
          // The Hydra node only sends Greetings once, so the handler above
          // would never see it without this replay.
          if (this.ws.lastGreetings) {
            onMsg(this.ws.lastGreetings);
          }
        })
        .catch((err) => settle(reject, new Error(`Failed to connect: ${String(err)}`)));
    });
  }

  /** Connect the underlying WebSocket with retry logic. */
  public async connect() {
    return await this.connectWithRetry();
  }

  /** Disconnect the underlying WebSocket. */
  public async disconnect(timeout?: number): Promise<void> {
    return this.ws.disconnect(timeout);
  }

  /** Return the current Hydra head status (uppercase). */
  public getStatus(): HydraStatus {
    return this.ws.getStatus();
  }

  /** Register a callback for head status changes. */
  public onStatusChange(callback: (status: HydraStatus) => void): HydraStatus {
    return this.ws.onStatusChange(callback);
  }

  /** Begin the head-opening sequence: init, commit, and listen for state changes. */
  public async startHead(commitArgs: CommitArgs) {
    this.mode = 'start';
    await this.connectWithRetry();
    this.ws.on('message', (msg: HydraWsMessage) => this.handleIncoming(msg, commitArgs));
  }

  /** Begin the head-closing sequence: close, fanout, and finalize. */
  public async shutdownHead() {
    this.mode = 'shutdown';
    await this.connectWithRetry();
    this.ws.on('message', (msg: HydraWsMessage) => this.handleIncoming(msg));
  }

  /**
   * Wait for the Hydra head to fully close and finalize.
   *
   * Resolves on the `HeadIsClosed` / `HeadIsFinalized` transition events, **and**
   * on the initial `Greetings` replay if the head is already at `Closed` or
   * `Final`. Rejects fast if the head is `Idle` (no head exists to close).
   *
   * @param timeoutMs - Maximum time to wait in milliseconds.
   */
  public async waitForHeadClose(timeoutMs = 180000): Promise<void> {
    this.mode = 'shutdown';
    return this.awaitMessage<void>(
      (message, resolve, reject) => {
        switch (message.tag) {
          case 'HeadIsClosed':
          case 'HeadIsFinalized':
            resolve();
            break;
          case 'ReadyToFanout':
            this.ws.send({ tag: 'Fanout' });
            break;
          case 'Greetings': {
            const status = message.headStatus as HeadStatus;
            if (status === 'Closed' || status === 'Final') {
              resolve();
              return;
            }
            if (status === 'Idle') {
              reject(new Error(`Cannot wait for head to close: head is "Idle" — no head exists to close`));
              return;
            }
            this.onGreetings(status).catch((err) => reject(new Error(`Greetings handler failed: ${String(err)}`)));
            break;
          }
        }
      },
      timeoutMs,
      'Timeout waiting for head to close!',
    );
  }

  /**
   * Wait for the Hydra head to reach the `Open` state.
   *
   * Resolves on the `HeadIsOpen` transition event, **and** on the initial
   * `Greetings` replay if the head is already `Open`. Rejects fast if the
   * head is in a terminal or shutting-down state (`Closed`, `FanoutPossible`,
   * `Final`) — a new head must be started from a fresh node.
   *
   * @param commitArgs - UTxO to commit into the head during initialization.
   * @param timeoutMs - Maximum time to wait in milliseconds.
   */
  public async waitForHeadOpen(commitArgs: CommitArgs, timeoutMs = 180000): Promise<void> {
    this.mode = 'start';
    return this.awaitMessage<void>(
      (message, resolve, reject) => {
        if (message.tag === 'HeadIsOpen') {
          resolve();
        } else if (message.tag === 'HeadIsInitializing') {
          if (!commitArgs) return;
          this.doCommit(commitArgs).catch((err) => reject(new Error(`Commit failed: ${String(err)}`)));
        } else if (message.tag === 'Greetings') {
          const status = message.headStatus as HeadStatus;
          if (status === 'Open') {
            resolve();
            return;
          }
          if (status === 'Closed' || status === 'FanoutPossible' || status === 'Final') {
            reject(new Error(`Cannot wait for head to open: head is "${status}" (terminal or shutting down)`));
            return;
          }
          this.onGreetings(status, commitArgs).catch((err) =>
            reject(new Error(`Greetings handler failed: ${String(err)}`)),
          );
        }
      },
      timeoutMs,
      'Timeout waiting for head to open',
    );
  }

  /**
   * Query the current Hydra head status via a `Greetings` message.
   * @param timeoutMs - Maximum time to wait for the status response.
   * @returns The head status string (e.g. `"Idle"`, `"Open"`, `"Closed"`).
   */
  public async getHeadStatus(timeoutMs = 5000): Promise<HeadStatus> {
    // When using a monitor, read the cached status directly — no new WebSocket
    if (this.monitor?.connected) {
      return HYDRA_TO_HEAD_STATUS[this.monitor.headStatus];
    }

    return this.awaitMessage<HeadStatus>(
      (message, resolve, _reject) => {
        if (message.tag === 'Greetings') {
          resolve(message.headStatus as HeadStatus);
        }
      },
      timeoutMs,
      'Timeout waiting for head status',
    );
  }

  private async doCommit(commitArgs: CommitArgs) {
    let cborHex: string;
    if (commitArgs.blueprintTx) {
      const utxos = await this.fetchUtxos(commitArgs.utxos);
      const hydraUtxos = toHydraUTxOs(utxos);
      cborHex = await this.http.buildCommit({ blueprintTx: commitArgs.blueprintTx, utxo: hydraUtxos });
    } else if (commitArgs.utxos.length === 0) {
      cborHex = await this.http.buildCommit({});
    } else if (commitArgs.utxos.length === 1) {
      const { txHash, outputIndex } = commitArgs.utxos[0];
      const utxos = await this.blockfrost.fetchUTxOs(txHash, outputIndex);
      if (!utxos[0]) throw new Error('UTxO not found');
      const hydraUtxo = toHydraUTxO(utxos[0]);
      cborHex = await this.http.buildCommit({ [`${txHash}#${outputIndex}`]: hydraUtxo });
    } else {
      throw new Error('Multiple UTxOs without a blueprintTx require a blueprint transaction');
    }
    return await this.blockfrost.submitTx(cborHex);
  }

  /**
   * Decommit funds from an open Hydra head back to L1.
   *
   * Posts the decommit transaction via HTTP to avoid overwriting message handlers.
   * Resolves on `DecommitApproved` — L1 settlement happens asynchronously.
   *
   * @param transaction - The decommit transaction (CBOR-encoded).
   * @param timeoutMs - Maximum time to wait for approval (default 60s).
   */
  public async decommit(transaction: HydraTransaction, timeoutMs = 60000): Promise<void> {
    const status = await this.getHeadStatus();
    if (status !== 'Open') {
      throw new Error(`Cannot decommit: head is "${status}", expected "Open"`);
    }

    const result = this.awaitMessage<void>(
      (message, resolve, reject) => {
        if (message.tag === 'DecommitApproved') {
          resolve();
        } else if (message.tag === 'DecommitInvalid') {
          reject(new Error(`Decommit invalid: ${JSON.stringify((message as any).decommitInvalidReason)}`));
        }
      },
      timeoutMs,
      'Timeout waiting for decommit approval',
    );

    await this.http.publishDecommit(transaction);

    return result;
  }

  /**
   * Incrementally commit funds into an already-open Hydra head.
   *
   * Only single-UTxO commits are supported (MeshJS limitation).
   * The raw L1 transaction is submitted to Blockfrost automatically.
   *
   * Resolves on `CommitFinalized`.
   *
   * @param commitArgs - Single UTxO (with optional blueprint) to commit.
   * @param timeoutMs - Maximum time to wait for finalization (default 120s).
   */
  public async incrementalCommit(commitArgs: CommitArgs, timeoutMs = 120000): Promise<void> {
    const status = await this.getHeadStatus();
    if (status !== 'Open') {
      throw new Error(`Cannot incrementally commit: head is "${status}", expected "Open"`);
    }

    await this.doIncrementalCommit(commitArgs);

    return this.awaitMessage<void>(
      (message, resolve, _reject) => {
        if (message.tag === 'CommitFinalized') {
          resolve();
        }
      },
      timeoutMs,
      'Timeout waiting for incremental commit finalization',
    );
  }

  private async doIncrementalCommit(commitArgs: CommitArgs) {
    if (commitArgs.utxos.length !== 1) {
      throw new Error('Incremental commit requires exactly one UTxO');
    }
    const { txHash, outputIndex } = commitArgs.utxos[0];
    const utxos = await this.blockfrost.fetchUTxOs(txHash, outputIndex);
    if (!utxos[0]) throw new Error('UTxO not found');
    const hydraUtxo = toHydraUTxO(utxos[0]);

    let cborHex: string;
    if (commitArgs.blueprintTx) {
      cborHex = await this.http.buildCommit({
        blueprintTx: commitArgs.blueprintTx,
        utxo: { [`${txHash}#${outputIndex}`]: hydraUtxo },
      });
    } else {
      cborHex = await this.http.buildCommit({ [`${txHash}#${outputIndex}`]: hydraUtxo });
    }
    return await this.blockfrost.submitTx(cborHex);
  }

  private async fetchUtxos(utxoRefs: UTxORef[]) {
    const results = [];
    for (const { txHash, outputIndex } of utxoRefs) {
      const utxos = await this.blockfrost.fetchUTxOs(txHash, outputIndex);
      if (!utxos.length) {
        throw new Error(`UTxO not found for ${txHash}#${outputIndex}`);
      }
      results.push(...utxos);
    }
    return results;
  }

  private async handleIncoming(message: HydraWsMessage, commitArgs?: CommitArgs) {
    if (message.tag === 'Greetings') {
      await this.onGreetings(message.headStatus as HeadStatus, commitArgs);
    } else {
      switch (this.mode) {
        case 'start':
          if (message.tag === 'HeadIsInitializing') {
            if (commitArgs === undefined) {
              console.error('No commit arguments specified... aborting commit!');
              return;
            }
            try {
              await this.doCommit(commitArgs);
            } catch (err) {
              console.error('Commit failed during startHead:', err);
            }
          }
          if (message.tag === 'HeadIsOpen') {
            // Successfully started the head here... close gracefully?
          }
          break;
        case 'shutdown':
          if (message.tag === 'ReadyToFanout') {
            this.ws.send({ tag: 'Fanout' });
          }
          break;
      }
    }
  }

  private async onGreetings(status: HeadStatus, commitArgs?: CommitArgs) {
    switch (this.mode) {
      case 'start':
        switch (status) {
          case 'Idle':
            console.log('Idle → init()');
            this.ws.send({ tag: 'Init' });
            break;
          case 'Initializing':
            console.log('Initializing -> commit()');
            if (commitArgs === undefined) {
              console.error('No commit arguments specified... aborting commit!');
              return;
            }
            await this.doCommit(commitArgs);
            break;
          case 'Open':
            console.log('Open → already ready, proceeding');
            break;
          default:
            console.log(`Greetings in start mode, ignoring status: ${status}`);
        }
        break;
      case 'shutdown':
        switch (status) {
          case 'Open':
            console.log('Shutting down: closing head…');
            this.ws.send({ tag: 'Close' });
            break;
          case 'FanoutPossible':
            console.log('Fanout now possible: fanning out…');
            this.ws.send({ tag: 'Fanout' });
            break;
          default:
            console.log(`Greetings in shutdown mode, ignoring status: ${status}`);
        }
    }
  }
}
