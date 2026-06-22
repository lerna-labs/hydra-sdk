import { BlockfrostProvider } from '@meshsdk/core';
import { requireEnv } from './config.js';
import { HydraHttpClient } from './hydra/hydra-http-client.js';
import type { HydraMonitor } from './hydra/hydra-monitor.js';
import { HydraWebSocket } from './hydra/hydra-websocket.js';
import type { HeadStatus, HydraStatus, HydraTransaction, HydraWsMessage } from './hydra/types.js';
import { toHydraUTxO } from './hydra/utxo-conversion.js';

const HYDRA_TO_HEAD_STATUS: Record<HydraStatus, HeadStatus> = {
  IDLE: 'Idle',
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

/**
 * Arguments for committing UTxOs into an open Hydra head.
 *
 * As of Hydra v2 (ADR-33) a head opens empty and all commits are drafted as
 * deposits into the open head — see {@link Wrangler.incrementalCommit}.
 */
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
 * for opening, funding, and closing a Hydra head.
 *
 * As of Hydra v2 (ADR-33) opening a head no longer requires a commit: `Init`
 * opens the head directly with an empty UTxO set. Funds are added afterwards
 * via {@link Wrangler.incrementalCommit} (a deposit into the open head).
 *
 * @example
 * ```ts
 * const wrangler = new Wrangler("http://localhost:4001", "ws://localhost:4001");
 * await wrangler.waitForHeadOpen();
 * await wrangler.incrementalCommit({ utxos: [{ txHash: "abc...", outputIndex: 0 }] });
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
          // Seed the handler with the current head status so steady-state callers
          // resolve/drive immediately. With a long-lived monitor, the cached
          // `lastGreetings` is the ONE Greetings from initial connect (often
          // `Idle`) and is stale across multiple lifecycle calls — use the
          // monitor's live tracked status instead. Without a monitor, replay the
          // Greetings consumed during connect (the node only sends it once).
          if (this.monitor?.connected) {
            onMsg({ tag: 'Greetings', headStatus: this.monitor.headStatusMixed } as HydraWsMessage);
          } else if (this.ws.lastGreetings) {
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

  /**
   * Begin the head-opening sequence: send `Init` on an `Idle` head and listen
   * for state changes until it reaches `Open`.
   *
   * As of Hydra v2 (ADR-33) opening no longer commits any UTxOs — the head
   * opens empty. Use {@link incrementalCommit} to add funds once it is `Open`.
   */
  public async startHead() {
    this.mode = 'start';
    await this.connectWithRetry();
    this.ws.on('message', (msg: HydraWsMessage) => this.handleIncoming(msg));
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
          // Resolve only once the head is fully finalized (after fanout). On
          // HeadIsClosed we keep waiting; the node will emit ReadyToFanout after
          // the contestation period, which we answer with Fanout.
          case 'HeadIsFinalized':
            resolve();
            break;
          case 'ReadyToFanout':
            this.ws.send({ tag: 'Fanout' });
            break;
          case 'Greetings': {
            const status = message.headStatus as HeadStatus;
            if (status === 'Final') {
              resolve();
              return;
            }
            if (status === 'Idle') {
              reject(new Error(`Cannot wait for head to close: head is "Idle" — no head exists to close`));
              return;
            }
            // Open → Close, FanoutPossible → Fanout, Closed → wait for ReadyToFanout.
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
   * Open the Hydra head and wait for it to reach the `Open` state.
   *
   * As of Hydra v2 (ADR-33) the head opens directly with an empty UTxO set:
   * on an `Idle` head this sends `Init` and resolves once the node reports
   * `HeadIsOpen`. Funds are added afterwards via {@link incrementalCommit}.
   *
   * Resolves on the `HeadIsOpen` transition event, **and** on the initial
   * `Greetings` replay if the head is already `Open`. Rejects fast if the
   * head is in a terminal or shutting-down state (`Closed`, `FanoutPossible`,
   * `Final`) — a new head must be started from a fresh node.
   *
   * @param timeoutMs - Maximum time to wait in milliseconds.
   */
  public async waitForHeadOpen(timeoutMs = 180000): Promise<void> {
    this.mode = 'start';
    return this.awaitMessage<void>(
      (message, resolve, reject) => {
        if (message.tag === 'HeadIsOpen') {
          resolve();
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
          this.onGreetings(status).catch((err) => reject(new Error(`Greetings handler failed: ${String(err)}`)));
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

  /** Transient L1-submission errors caused by a stale node/chain view post-rollback. */
  private static readonly TRANSIENT_SUBMIT =
    /BadInputsUTxO|ValueNotConserved|StaleUTxO|TxSubmitFail|Bad Request|already in the mempool/i;

  /** Sleep helper (real timers; advanced by fake timers in tests). */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Deposit funds into an open head, resilient to L1 rollbacks.
   *
   * Two failure modes are handled:
   *
   * 1. **Stale fee input (transient).** The hydra-node funds the deposit tx's fee
   *    from the committer's *other* UTxOs using its chain view. Just after a
   *    rollback, that view can reference a reverted tx's outputs, so submission
   *    fails with `BadInputsUTxO`/`ValueNotConserved`. We re-draft after a short
   *    delay (letting the node re-sync) before giving up on the attempt.
   * 2. **Cancelled increment (rollback).** A deposit's increment is triggered by
   *    its on-chain *observation*; a fork-switch can cancel it so the deposit
   *    lingers in `GET /commits` and never enters the snapshot. On a finalize
   *    timeout we retry with a **fresh** UTxO.
   *
   * Funds are never lost: a stranded deposit is recoverable after its deadline.
   *
   * @param getUtxo - Provides a fresh, unspent small UTxO ref for each attempt.
   *   Must return a *different* UTxO each call. A live L1 query satisfies this.
   * @param sign - Signs the drafted deposit tx (CBOR hex) with the UTxO owner's
   *   key, returning the signed CBOR hex (e.g. `(tx) => wallet.signTx(tx, true)`).
   * @param opts.maxAttempts - Max deposit attempts with fresh UTxOs (default 3).
   * @param opts.finalizeTimeoutMs - Per-attempt wait for `CommitFinalized` (default 180s).
   * @param opts.submitRetries - Re-draft attempts on a transient submit error (default 3).
   * @param opts.submitRetryDelayMs - Delay before re-drafting, lets the node re-sync (default 8s).
   * @returns The L1 tx id of the deposit that finalized.
   */
  public async depositResilient(
    getUtxo: () => Promise<UTxORef>,
    sign: (cborHex: string) => Promise<string>,
    opts: {
      maxAttempts?: number;
      finalizeTimeoutMs?: number;
      submitRetries?: number;
      submitRetryDelayMs?: number;
    } = {},
  ): Promise<string> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const finalizeTimeoutMs = opts.finalizeTimeoutMs ?? 180_000;
    const submitRetries = opts.submitRetries ?? 3;
    const submitRetryDelayMs = opts.submitRetryDelayMs ?? 8_000;

    const status = await this.getHeadStatus();
    if (status !== 'Open') {
      throw new Error(`Cannot deposit: head is "${status}", expected "Open"`);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ref = await getUtxo();

      // Draft → sign → submit, re-drafting on transient stale-input errors.
      let l1TxId: string | undefined;
      for (let sub = 1; sub <= submitRetries; sub++) {
        try {
          l1TxId = await this.submitDeposit(ref, sign);
          break;
        } catch (err) {
          if (!Wrangler.TRANSIENT_SUBMIT.test(String(err)) || sub === submitRetries) throw err;
          console.warn(
            `Deposit submit hit a transient stale-input error (try ${sub}/${submitRetries}); ` +
              `re-drafting in ${submitRetryDelayMs}ms…`,
          );
          await this.delay(submitRetryDelayMs);
        }
      }

      // Wait for the increment to finalize. The deposit matures over ~deposit-period,
      // so registering the listener now (just after submit) cannot miss the event.
      try {
        await this.awaitMessage<void>(
          (message, resolve) => {
            if (message.tag === 'CommitFinalized') resolve();
          },
          finalizeTimeoutMs,
          'Timeout waiting for CommitFinalized',
        );
        return l1TxId as string;
      } catch {
        const pending = await this.http.getPendingCommits().catch(() => [] as string[]);
        if (attempt === maxAttempts) {
          throw new Error(
            `Deposit failed to finalize after ${maxAttempts} attempts` +
              (pending.length ? ` (stranded, recoverable after deadline: ${pending.join(', ')})` : ''),
          );
        }
        console.warn(
          `Deposit attempt ${attempt}/${maxAttempts} did not finalize ` +
            `(pending deposits: ${pending.length}). Retrying with a fresh UTxO…`,
        );
      }
    }
    // Unreachable, but satisfies the type checker.
    throw new Error('Deposit failed to finalize');
  }

  /** Draft a deposit for `ref` via `POST /commit`, sign it, and submit to L1. */
  private async submitDeposit(ref: UTxORef, sign: (cborHex: string) => Promise<string>): Promise<string> {
    const { txHash, outputIndex } = ref;
    const utxos = await this.blockfrost.fetchUTxOs(txHash, outputIndex);
    if (!utxos[0]) throw new Error(`UTxO not found: ${txHash}#${outputIndex}`);
    const cborHex = await this.http.buildCommit({ [`${txHash}#${outputIndex}`]: toHydraUTxO(utxos[0]) });
    const signed = await sign(cborHex);
    return this.blockfrost.submitTx(signed);
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

  private async handleIncoming(message: HydraWsMessage) {
    if (message.tag === 'Greetings') {
      await this.onGreetings(message.headStatus as HeadStatus);
    } else {
      switch (this.mode) {
        case 'start':
          if (message.tag === 'HeadIsOpen') {
            // Head opened directly (ADR-33) — nothing left to drive.
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

  private async onGreetings(status: HeadStatus) {
    switch (this.mode) {
      case 'start':
        switch (status) {
          case 'Idle':
            console.log('Idle → init()');
            this.ws.send({ tag: 'Init' });
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
