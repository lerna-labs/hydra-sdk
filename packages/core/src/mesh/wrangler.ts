import { BlockfrostProvider } from '@meshsdk/core';
import type { hydraStatus } from '@meshsdk/hydra';
import { HydraInstance, HydraProvider } from '@meshsdk/hydra';
import { requireEnv } from '../config.js';
import type { HeadStatus, HydraWsMessage } from '../hydra/messages.js';

/** UTxO reference used to commit funds into a Hydra head. */
export interface CommitArgs {
  /** Transaction hash containing the UTxO to commit. */
  txHash: string;
  /** Output index of the UTxO within the transaction. */
  txIndex: number;
}

/**
 * High-level controller for Hydra head lifecycle operations.
 *
 * Wraps `HydraProvider` and `HydraInstance` to provide a simplified API
 * for initializing, opening, and closing a Hydra head.
 *
 * @example
 * ```ts
 * const wrangler = new Wrangler("http://localhost:4001");
 * await wrangler.waitForHeadOpen({ txHash: "abc...", txIndex: 0 });
 * ```
 */
export class Wrangler {
  private mode: 'start' | 'shutdown' | undefined;
  public readonly provider: HydraProvider;
  private instance: HydraInstance;
  private readonly blockfrost: BlockfrostProvider;
  private readonly url: string;
  private readonly wsUrl: string;

  constructor(url?: string, wsUrl?: string) {
    this.url = url || requireEnv('HYDRA_API_URL');
    this.wsUrl = wsUrl || requireEnv('HYDRA_WS_URL');
    this.blockfrost = new BlockfrostProvider(requireEnv('BLOCKFROST_API_KEY'));
    this.provider = this.createHydraProvider();
    this.instance = this.createHydraInstance();
  }

  private createHydraProvider() {
    return new HydraProvider({ httpUrl: this.url, history: false });
  }

  private createHydraInstance() {
    return new HydraInstance({
      provider: this.provider,
      fetcher: this.blockfrost,
      submitter: this.provider,
    });
  }

  /**
   * Connect to the Hydra node with exponential-backoff retry.
   *
   * Uses `HydraProvider.isConnected()` which establishes the WebSocket
   * **and** waits for the Hydra `Greetings` handshake, unlike the raw
   * `connect()` which only opens the socket.
   *
   * @param maxAttempts - Maximum number of connection attempts (default 5).
   * @param baseDelayMs - Initial retry delay in milliseconds (default 1000). Doubles each attempt, capped at 30 s.
   */
  private async connectWithRetry(maxAttempts = 5, baseDelayMs = 1000): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const connected = await this.provider.isConnected();
        if (connected) return;
        throw new Error('isConnected() returned false');
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
   */
  private awaitMessage<T>(
    handler: (message: HydraWsMessage, resolve: (value: T) => void) => void,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const settle = <V>(fn: (v: V) => void, value: V) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      this.provider.onMessage((message) => {
        handler(message, (value) => settle(resolve, value));
      });

      const timer = setTimeout(() => settle(reject, new Error(timeoutMessage)), timeoutMs);

      this.connectWithRetry().catch((err) => settle(reject, new Error(`Failed to connect: ${String(err)}`)));
    });
  }

  /** Connect the underlying HydraProvider WebSocket with retry logic. */
  public async connect() {
    return await this.connectWithRetry();
  }

  /** Disconnect the underlying HydraProvider WebSocket. */
  public async disconnect(timeout?: number): Promise<void> {
    return this.provider.disconnect(timeout);
  }

  /** Return the current HydraProvider connection/head status. */
  public getStatus(): hydraStatus {
    return this.provider.getStatus();
  }

  /** Register a callback for HydraProvider status changes. */
  public onStatusChange(callback: (status: hydraStatus) => void): hydraStatus {
    return this.provider.onStatusChange(callback);
  }

  /** Begin the head-opening sequence: init, commit, and listen for state changes. */
  public async startHead(txHash: string, txIndex: number) {
    this.mode = 'start';
    this.provider.onMessage((msg) => this.handleIncoming(msg, { txHash, txIndex }));
    await this.connectWithRetry();
  }

  /** Begin the head-closing sequence: close, fanout, and finalize. */
  public async shutdownHead() {
    this.mode = 'shutdown';
    this.provider.onMessage((msg) => this.handleIncoming(msg));
    await this.connectWithRetry();
  }

  /**
   * Wait for the Hydra head to fully close and finalize.
   * @param timeoutMs - Maximum time to wait in milliseconds.
   */
  public async waitForHeadClose(timeoutMs = 180000): Promise<void> {
    this.mode = 'shutdown';
    return this.awaitMessage<void>(
      (message, resolve) => {
        switch (message.tag) {
          case 'HeadIsClosed':
          case 'HeadIsFinalized':
            resolve();
            break;
          case 'ReadyToFanout':
            this.provider.fanout();
            break;
          case 'Greetings':
            this.onGreetings(message.headStatus);
            break;
        }
      },
      timeoutMs,
      'Timeout waiting for head to close!',
    );
  }

  /**
   * Wait for the Hydra head to reach the `Open` state.
   * @param commitArgs - UTxO to commit into the head during initialization.
   * @param timeoutMs - Maximum time to wait in milliseconds.
   */
  public async waitForHeadOpen(commitArgs: CommitArgs, timeoutMs = 180000): Promise<void> {
    this.mode = 'start';
    return this.awaitMessage<void>(
      (message, resolve) => {
        if (message.tag === 'HeadIsOpen') {
          resolve();
        } else if (message.tag === 'HeadIsInitializing') {
          if (!commitArgs) return;
          this.doCommit(commitArgs);
        } else if (message.tag === 'Greetings') {
          this.onGreetings(message.headStatus, commitArgs);
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
    return this.awaitMessage<HeadStatus>(
      (message, resolve) => {
        if (message.tag === 'Greetings') {
          resolve(message.headStatus);
        }
      },
      timeoutMs,
      'Timeout waiting for head status',
    );
  }

  private async doCommit(commitArgs: CommitArgs) {
    try {
      const rawTx = await this.instance.commitFunds(commitArgs.txHash, commitArgs.txIndex);
      return await this.blockfrost.submitTx(rawTx);
    } catch (err: any) {
      console.error(`Commit error`, err);
      return false;
    }
  }

  private async handleIncoming(message: HydraWsMessage, commitArgs?: CommitArgs) {
    if (message.tag === 'Greetings') {
      await this.onGreetings(message.headStatus, commitArgs);
    } else {
      switch (this.mode) {
        case 'start':
          if (message.tag === 'HeadIsInitializing') {
            if (commitArgs === undefined) {
              console.error('No commit arguments specified... aborting commit!');
              return;
            }
            await this.doCommit(commitArgs);
          }
          if (message.tag === 'HeadIsOpen') {
            // Successfully started the head here... close gracefully?
          }
          break;
        case 'shutdown':
          if (message.tag === 'ReadyToFanout') {
            await this.provider.fanout();
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
            await this.provider.init();
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
            await this.provider.close();
            break;
          case 'FanoutPossible':
            console.log('Fanout now possible: fanning out…');
            await this.provider.fanout();
            break;
          default:
            console.log(`Greetings in shutdown mode, ignoring status: ${status}`);
        }
    }
  }
}
