import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadStatus, HydraWsMessage } from '../hydra/messages.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import of the module under test
// ---------------------------------------------------------------------------

const mockProvider = {
  isConnected: vi.fn<() => Promise<boolean>>(),
  connect: vi.fn<() => Promise<void>>(),
  disconnect: vi.fn<() => Promise<void>>(),
  onMessage: vi.fn<(cb: (msg: HydraWsMessage) => void) => void>(),
  onStatusChange: vi.fn(),
  getStatus: vi.fn(),
  init: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<unknown>>(),
  fanout: vi.fn<() => Promise<unknown>>(),
  publishDecommit: vi.fn<(payload: unknown) => Promise<unknown>>(),
};

const mockInstance = {
  commitBlueprintUTxOs:
    vi.fn<(txIn: { txHash: string; outputIndex: number }[], transaction: unknown) => Promise<string>>(),
  commitEmpty: vi.fn<() => Promise<string>>(),
  commitFunds: vi.fn<(txHash: string, outputIndex: number) => Promise<string>>(),
  incrementalCommitFunds: vi.fn<(txHash: string, outputIndex: number) => Promise<string>>(),
  incrementalBlueprintCommit: vi.fn<(txHash: string, outputIndex: number, transaction: unknown) => Promise<string>>(),
};

const mockBlockfrost = {
  submitTx: vi.fn<(tx: string) => Promise<string>>(),
};

vi.mock('@meshsdk/hydra', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  HydraProvider: function () {
    return mockProvider;
  },
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  HydraInstance: function () {
    return mockInstance;
  },
}));

vi.mock('@meshsdk/core', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  BlockfrostProvider: function () {
    return mockBlockfrost;
  },
}));

// Stub env vars before the module is loaded
vi.stubEnv('BLOCKFROST_API_KEY', 'test-key');
vi.stubEnv('HYDRA_WS_URL', 'ws://localhost:4001');

// Dynamic import so mocks are in place first
const { Wrangler } = await import('./wrangler.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate the provider emitting a message to the last registered handler. */
function emitMessage(msg: Partial<HydraWsMessage> & { tag: string }) {
  const lastCall = mockProvider.onMessage.mock.calls.at(-1);
  if (!lastCall) throw new Error('No onMessage handler registered');
  lastCall[0](msg as HydraWsMessage);
}

/** Flush microtasks + one timer tick so connectWithRetry's setTimeout fires. */
async function flushAsync() {
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Wrangler', () => {
  let wrangler: InstanceType<typeof Wrangler>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: connection succeeds immediately
    mockProvider.isConnected.mockResolvedValue(true);
    mockProvider.disconnect.mockResolvedValue(undefined);
    mockProvider.init.mockResolvedValue(undefined);
    mockProvider.close.mockResolvedValue(undefined);
    mockProvider.fanout.mockResolvedValue(undefined);
    mockProvider.getStatus.mockReturnValue('idle');
    mockProvider.onStatusChange.mockReturnValue('idle');
    mockInstance.commitBlueprintUTxOs.mockResolvedValue('raw-tx-hex');
    mockInstance.commitEmpty.mockResolvedValue('raw-tx-hex');
    mockInstance.commitFunds.mockResolvedValue('raw-tx-hex');
    mockInstance.incrementalCommitFunds.mockResolvedValue('raw-tx-hex');
    mockInstance.incrementalBlueprintCommit.mockResolvedValue('raw-tx-hex');
    mockBlockfrost.submitTx.mockResolvedValue('tx-hash');
    mockProvider.publishDecommit.mockResolvedValue(undefined);

    wrangler = new Wrangler('http://localhost:4001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // connect / connectWithRetry
  // -------------------------------------------------------------------------

  describe('connect()', () => {
    it('resolves when isConnected returns true', async () => {
      await expect(wrangler.connect()).resolves.toBeUndefined();
      expect(mockProvider.isConnected).toHaveBeenCalledOnce();
    });

    it('retries on failure with exponential backoff', async () => {
      mockProvider.isConnected
        .mockRejectedValueOnce(new Error('refused'))
        .mockRejectedValueOnce(new Error('refused'))
        .mockResolvedValueOnce(true);

      const p = wrangler.connect();

      // First retry: 1000ms delay
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry: 2000ms delay
      await vi.advanceTimersByTimeAsync(2000);

      await expect(p).resolves.toBeUndefined();
      expect(mockProvider.isConnected).toHaveBeenCalledTimes(3);
    });

    it('rejects after max attempts exhausted', async () => {
      mockProvider.isConnected.mockRejectedValue(new Error('refused'));

      // Attach a no-op catch immediately so the rejection is "handled"
      // before fake-timer advancement creates the async gap
      const p = wrangler.connect().catch((e) => e);

      // Advance through all 4 retry delays (attempts 0-3 fail then delay, attempt 4 fails and throws)
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
      }

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Failed to connect after 5 attempts');
    });

    it('retries when isConnected returns false', async () => {
      mockProvider.isConnected.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const p = wrangler.connect();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(p).resolves.toBeUndefined();
      expect(mockProvider.isConnected).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // disconnect / getStatus / onStatusChange
  // -------------------------------------------------------------------------

  describe('disconnect()', () => {
    it('delegates to provider.disconnect', async () => {
      await wrangler.disconnect(5000);
      expect(mockProvider.disconnect).toHaveBeenCalledWith(5000);
    });
  });

  describe('getStatus()', () => {
    it('delegates to provider.getStatus', () => {
      mockProvider.getStatus.mockReturnValue('connected');
      expect(wrangler.getStatus()).toBe('connected');
    });
  });

  describe('onStatusChange()', () => {
    it('delegates to provider.onStatusChange', () => {
      const cb = vi.fn();
      wrangler.onStatusChange(cb);
      expect(mockProvider.onStatusChange).toHaveBeenCalledWith(cb);
    });
  });

  // -------------------------------------------------------------------------
  // getHeadStatus
  // -------------------------------------------------------------------------

  describe('getHeadStatus()', () => {
    it('resolves with headStatus from Greetings message', async () => {
      const p = wrangler.getHeadStatus(5000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Open' as HeadStatus });

      await expect(p).resolves.toBe('Open');
    });

    it('ignores non-Greetings messages', async () => {
      const p = wrangler.getHeadStatus(5000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsOpen' });
      emitMessage({ tag: 'Greetings', headStatus: 'Idle' as HeadStatus });

      await expect(p).resolves.toBe('Idle');
    });

    it('rejects on timeout', async () => {
      const p = wrangler.getHeadStatus(3000);
      await flushAsync();

      vi.advanceTimersByTime(3000);

      await expect(p).rejects.toThrow('Timeout waiting for head status');
    });

    it('rejects when connection fails', async () => {
      mockProvider.isConnected.mockRejectedValue(new Error('refused'));

      // Use a large timeout so the connection failure fires before the timeout.
      // Attach a no-op catch to prevent unhandled-rejection during timer advancement.
      const p = wrangler.getHeadStatus(600_000).catch((e) => e);

      // Advance through all retry delays (1s + 2s + 4s + 8s = 15s for 5 attempts)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
      }

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Failed to connect');
    });
  });

  // -------------------------------------------------------------------------
  // waitForHeadOpen
  // -------------------------------------------------------------------------

  describe('waitForHeadOpen()', () => {
    const blueprintTx = { type: 'Tx ConwayEra' as const, cborHex: 'deadbeef', description: '' };
    const commitArgs = { utxos: [{ txHash: 'abc123', outputIndex: 0 }], blueprintTx };

    it('resolves on HeadIsOpen message', async () => {
      const p = wrangler.waitForHeadOpen(commitArgs, 10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsOpen' });

      await expect(p).resolves.toBeUndefined();
    });

    it('commits on HeadIsInitializing', async () => {
      const p = wrangler.waitForHeadOpen(commitArgs, 10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsInitializing' });
      // Allow the commit chain to resolve
      await flushAsync();

      expect(mockInstance.commitBlueprintUTxOs).toHaveBeenCalledWith(
        [{ txHash: 'abc123', outputIndex: 0 }],
        blueprintTx,
      );
      expect(mockBlockfrost.submitTx).toHaveBeenCalledWith('raw-tx-hex');

      // Now resolve by opening
      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });

    it('calls init on Greetings with Idle status', async () => {
      const p = wrangler.waitForHeadOpen(commitArgs, 10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Idle' as HeadStatus });
      await flushAsync();

      expect(mockProvider.init).toHaveBeenCalledOnce();

      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });

    it('commits on Greetings with Initializing status', async () => {
      const p = wrangler.waitForHeadOpen(commitArgs, 10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Initializing' as HeadStatus });
      await flushAsync();

      expect(mockInstance.commitBlueprintUTxOs).toHaveBeenCalledWith(
        [{ txHash: 'abc123', outputIndex: 0 }],
        blueprintTx,
      );

      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects on timeout', async () => {
      const p = wrangler.waitForHeadOpen(commitArgs, 2000);
      await flushAsync();

      vi.advanceTimersByTime(2000);

      await expect(p).rejects.toThrow('Timeout waiting for head to open');
    });

    it('settles only once even if multiple HeadIsOpen messages arrive', async () => {
      const p = wrangler.waitForHeadOpen(commitArgs, 10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsOpen' });
      emitMessage({ tag: 'HeadIsOpen' });

      await expect(p).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // waitForHeadClose
  // -------------------------------------------------------------------------

  describe('waitForHeadClose()', () => {
    it('resolves on HeadIsFinalized', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsFinalized' });

      await expect(p).resolves.toBeUndefined();
    });

    it('resolves on HeadIsClosed', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsClosed' });

      await expect(p).resolves.toBeUndefined();
    });

    it('triggers fanout on ReadyToFanout', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'ReadyToFanout' });
      await flushAsync();

      expect(mockProvider.fanout).toHaveBeenCalledOnce();

      emitMessage({ tag: 'HeadIsFinalized' });
      await expect(p).resolves.toBeUndefined();
    });

    it('calls close on Greetings with Open status', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Open' as HeadStatus });
      await flushAsync();

      expect(mockProvider.close).toHaveBeenCalledOnce();

      emitMessage({ tag: 'HeadIsFinalized' });
      await expect(p).resolves.toBeUndefined();
    });

    it('calls fanout on Greetings with FanoutPossible status', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'FanoutPossible' as HeadStatus });
      await flushAsync();

      expect(mockProvider.fanout).toHaveBeenCalledOnce();

      emitMessage({ tag: 'HeadIsFinalized' });
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects on timeout', async () => {
      const p = wrangler.waitForHeadClose(2000);
      await flushAsync();

      vi.advanceTimersByTime(2000);

      await expect(p).rejects.toThrow('Timeout waiting for head to close!');
    });
  });

  // -------------------------------------------------------------------------
  // startHead / shutdownHead
  // -------------------------------------------------------------------------

  describe('startHead()', () => {
    const startBlueprintTx = { type: 'Tx ConwayEra' as const, cborHex: 'cafebabe', description: '' };

    it('sets mode to start, registers handler, and connects', async () => {
      await wrangler.startHead({ utxos: [{ txHash: 'tx1', outputIndex: 0 }], blueprintTx: startBlueprintTx });

      expect(mockProvider.onMessage).toHaveBeenCalled();
      expect(mockProvider.isConnected).toHaveBeenCalled();
    });

    it('handler commits on HeadIsInitializing', async () => {
      await wrangler.startHead({ utxos: [{ txHash: 'tx1', outputIndex: 2 }], blueprintTx: startBlueprintTx });

      emitMessage({ tag: 'HeadIsInitializing' });
      await flushAsync();

      expect(mockInstance.commitBlueprintUTxOs).toHaveBeenCalledWith(
        [{ txHash: 'tx1', outputIndex: 2 }],
        startBlueprintTx,
      );
    });

    it('handler calls init on Greetings Idle', async () => {
      await wrangler.startHead({ utxos: [{ txHash: 'tx1', outputIndex: 0 }], blueprintTx: startBlueprintTx });

      emitMessage({ tag: 'Greetings', headStatus: 'Idle' as HeadStatus });
      await flushAsync();

      expect(mockProvider.init).toHaveBeenCalledOnce();
    });
  });

  describe('shutdownHead()', () => {
    it('sets mode to shutdown, registers handler, and connects', async () => {
      await wrangler.shutdownHead();

      expect(mockProvider.onMessage).toHaveBeenCalled();
      expect(mockProvider.isConnected).toHaveBeenCalled();
    });

    it('handler calls fanout on ReadyToFanout', async () => {
      await wrangler.shutdownHead();

      emitMessage({ tag: 'ReadyToFanout' });
      await flushAsync();

      expect(mockProvider.fanout).toHaveBeenCalledOnce();
    });

    it('handler calls close on Greetings Open', async () => {
      await wrangler.shutdownHead();

      emitMessage({ tag: 'Greetings', headStatus: 'Open' as HeadStatus });
      await flushAsync();

      expect(mockProvider.close).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // doCommit branching
  // -------------------------------------------------------------------------

  describe('doCommit() branching', () => {
    it('calls commitEmpty when utxos is empty and no blueprintTx', async () => {
      const p = wrangler.waitForHeadOpen({ utxos: [] }, 10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsInitializing' });
      await flushAsync();

      expect(mockInstance.commitEmpty).toHaveBeenCalledOnce();
      expect(mockInstance.commitBlueprintUTxOs).not.toHaveBeenCalled();

      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });

    it('calls commitFunds for single UTxO without blueprintTx', async () => {
      const p = wrangler.waitForHeadOpen({ utxos: [{ txHash: 'abc123', outputIndex: 0 }] }, 10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsInitializing' });
      await flushAsync();

      expect(mockInstance.commitFunds).toHaveBeenCalledWith('abc123', 0);
      expect(mockInstance.commitBlueprintUTxOs).not.toHaveBeenCalled();

      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects for multiple UTxOs without blueprintTx', async () => {
      const commitArgs = {
        utxos: [
          { txHash: 'abc123', outputIndex: 0 },
          { txHash: 'def456', outputIndex: 1 },
        ],
      };
      const p = wrangler.waitForHeadOpen(commitArgs, 10000).catch((e) => e);
      await flushAsync();

      emitMessage({ tag: 'HeadIsInitializing' });
      await flushAsync();

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Multiple UTxOs without a blueprintTx');
    });

    it('calls commitBlueprintUTxOs when blueprintTx is provided', async () => {
      const blueprintTx = { type: 'Tx ConwayEra' as const, cborHex: 'deadbeef', description: '' };
      const commitArgs = { utxos: [{ txHash: 'abc123', outputIndex: 0 }], blueprintTx };
      const p = wrangler.waitForHeadOpen(commitArgs, 10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsInitializing' });
      await flushAsync();

      expect(mockInstance.commitBlueprintUTxOs).toHaveBeenCalledWith(
        [{ txHash: 'abc123', outputIndex: 0 }],
        blueprintTx,
      );

      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // decommit
  // -------------------------------------------------------------------------

  describe('decommit()', () => {
    const decommitTx = { type: 'Tx ConwayEra' as const, cborHex: 'decommitcbor', description: '' };

    it('resolves on DecommitApproved', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        // getHeadStatus registers handler, we immediately emit Greetings
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler.decommit(decommitTx, 10000);
      await flushAsync();

      // Now the decommit awaitMessage handler is registered
      emitMessage({ tag: 'DecommitApproved' });

      await expect(p).resolves.toBeUndefined();
      expect(mockProvider.publishDecommit).toHaveBeenCalledWith(decommitTx);
    });

    it('rejects on DecommitInvalid', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler.decommit(decommitTx, 10000);
      await flushAsync();

      emitMessage({
        tag: 'DecommitInvalid',
        decommitInvalidReason: {
          tag: 'DecommitTxInvalid',
          localUTxO: {},
          validationError: { reason: 'test error' },
        },
      });

      await expect(p).rejects.toThrow('Decommit invalid');
    });

    it('rejects when head is not Open', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Idle' } as HydraWsMessage), 0);
      });

      const p = wrangler.decommit(decommitTx, 10000).catch((e) => e);
      await flushAsync();

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Cannot decommit: head is "Idle"');
    });

    it('rejects on timeout', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler.decommit(decommitTx, 3000);
      await flushAsync();

      // Advance past timeout without sending DecommitApproved
      vi.advanceTimersByTime(3000);

      await expect(p).rejects.toThrow('Timeout waiting for decommit approval');
    });
  });

  // -------------------------------------------------------------------------
  // incrementalCommit
  // -------------------------------------------------------------------------

  describe('incrementalCommit()', () => {
    const singleUtxo = { utxos: [{ txHash: 'inc123', outputIndex: 0 }] };

    it('resolves on CommitFinalized (simple funds)', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler.incrementalCommit(singleUtxo, 10000);
      await flushAsync();

      expect(mockInstance.incrementalCommitFunds).toHaveBeenCalledWith('inc123', 0);

      emitMessage({ tag: 'CommitFinalized' });

      await expect(p).resolves.toBeUndefined();
    });

    it('uses incrementalBlueprintCommit when blueprintTx provided', async () => {
      const blueprintTx = { type: 'Tx ConwayEra' as const, cborHex: 'bpcbor', description: '' };
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler.incrementalCommit({ ...singleUtxo, blueprintTx }, 10000);
      await flushAsync();

      expect(mockInstance.incrementalBlueprintCommit).toHaveBeenCalledWith('inc123', 0, blueprintTx);

      emitMessage({ tag: 'CommitFinalized' });

      await expect(p).resolves.toBeUndefined();
    });

    it('rejects when head is not Open', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Idle' } as HydraWsMessage), 0);
      });

      const p = wrangler.incrementalCommit(singleUtxo, 10000).catch((e) => e);
      await flushAsync();

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Cannot incrementally commit');
    });

    it('rejects when utxos.length !== 1', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler
        .incrementalCommit(
          {
            utxos: [
              { txHash: 'a', outputIndex: 0 },
              { txHash: 'b', outputIndex: 1 },
            ],
          },
          10000,
        )
        .catch((e) => e);
      await flushAsync();

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('exactly one UTxO');
    });

    it('rejects on timeout', async () => {
      mockProvider.onMessage.mockImplementationOnce((cb) => {
        setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
      });

      const p = wrangler.incrementalCommit(singleUtxo, 3000);
      await flushAsync();

      vi.advanceTimersByTime(3000);

      await expect(p).rejects.toThrow('Timeout waiting for incremental commit finalization');
    });
  });
});
