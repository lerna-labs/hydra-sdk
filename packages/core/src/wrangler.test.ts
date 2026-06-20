import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadStatus, HydraWsMessage } from './hydra/types.js';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import of the module under test
// ---------------------------------------------------------------------------

// Registered 'message' listeners (EventEmitter pattern)
const messageListeners: ((msg: HydraWsMessage) => void)[] = [];

const mockWs = {
  waitForGreetings: vi.fn<() => Promise<boolean>>(),
  connect: vi.fn<() => Promise<void>>(),
  disconnect: vi.fn<() => Promise<void>>(),
  send: vi.fn(),
  getStatus: vi.fn(),
  onStatusChange: vi.fn(),
  on: vi.fn((event: string, cb: (msg: HydraWsMessage) => void) => {
    if (event === 'message') messageListeners.push(cb);
    return mockWs;
  }),
  removeListener: vi.fn((event: string, cb: (msg: HydraWsMessage) => void) => {
    if (event === 'message') {
      const idx = messageListeners.indexOf(cb);
      if (idx >= 0) messageListeners.splice(idx, 1);
    }
    return mockWs;
  }),
};

const mockHttp = {
  buildCommit: vi.fn<(payload: unknown) => Promise<string>>(),
  publishDecommit: vi.fn<(payload: unknown) => Promise<unknown>>(),
};

const mockBlockfrost = {
  submitTx: vi.fn<(tx: string) => Promise<string>>(),
  fetchUTxOs: vi.fn(),
};

vi.mock('./hydra/hydra-websocket.js', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  HydraWebSocket: function () {
    return mockWs;
  },
}));

vi.mock('./hydra/hydra-http-client.js', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  HydraHttpClient: function () {
    return mockHttp;
  },
}));

vi.mock('@meshsdk/core', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  BlockfrostProvider: function () {
    return mockBlockfrost;
  },
}));

vi.mock('./hydra/utxo-conversion.js', () => ({
  toHydraUTxO: vi.fn(() => ({
    address: 'addr_test1',
    datum: null,
    inlineDatum: null,
    inlineDatumRaw: null,
    inlineDatumhash: null,
    referenceScript: null,
    value: { lovelace: 5000000 },
  })),
  toHydraUTxOs: vi.fn(() => ({
    'abc123#0': {
      address: 'addr_test1',
      datum: null,
      inlineDatum: null,
      inlineDatumRaw: null,
      inlineDatumhash: null,
      referenceScript: null,
      value: { lovelace: 5000000 },
    },
  })),
}));

// Stub env vars before the module is loaded
vi.stubEnv('BLOCKFROST_API_KEY', 'test-key');
vi.stubEnv('HYDRA_WS_URL', 'ws://localhost:4001');

// Dynamic import so mocks are in place first
const { Wrangler } = await import('./wrangler.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate the WebSocket emitting a message to all registered handlers. */
function emitMessage(msg: Partial<HydraWsMessage> & { tag: string }) {
  for (const listener of [...messageListeners]) {
    listener(msg as HydraWsMessage);
  }
}

/** Flush microtasks + one timer tick. */
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
    messageListeners.length = 0;

    // Default: connection succeeds immediately
    mockWs.waitForGreetings.mockResolvedValue(true);
    mockWs.disconnect.mockResolvedValue(undefined);
    mockWs.getStatus.mockReturnValue('IDLE');
    mockWs.onStatusChange.mockReturnValue('IDLE');
    mockHttp.buildCommit.mockResolvedValue('raw-tx-hex');
    mockHttp.publishDecommit.mockResolvedValue(undefined);
    mockBlockfrost.submitTx.mockResolvedValue('tx-hash');
    mockBlockfrost.fetchUTxOs.mockResolvedValue([
      {
        input: { txHash: 'abc123', outputIndex: 0 },
        output: { address: 'addr_test1', amount: [{ unit: 'lovelace', quantity: '5000000' }] },
      },
    ]);

    wrangler = new Wrangler('http://localhost:4001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // connect / connectWithRetry
  // -------------------------------------------------------------------------

  describe('connect()', () => {
    it('resolves when waitForGreetings returns true', async () => {
      await expect(wrangler.connect()).resolves.toBeUndefined();
      expect(mockWs.waitForGreetings).toHaveBeenCalledOnce();
    });

    it('retries on failure with exponential backoff', async () => {
      mockWs.waitForGreetings
        .mockRejectedValueOnce(new Error('refused'))
        .mockRejectedValueOnce(new Error('refused'))
        .mockResolvedValueOnce(true);

      const p = wrangler.connect();

      // First retry: 1000ms delay
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry: 2000ms delay
      await vi.advanceTimersByTimeAsync(2000);

      await expect(p).resolves.toBeUndefined();
      expect(mockWs.waitForGreetings).toHaveBeenCalledTimes(3);
    });

    it('rejects after max attempts exhausted', async () => {
      mockWs.waitForGreetings.mockRejectedValue(new Error('refused'));

      const p = wrangler.connect().catch((e) => e);

      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
      }

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Failed to connect after 5 attempts');
    });

    it('retries when waitForGreetings returns false', async () => {
      mockWs.waitForGreetings.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const p = wrangler.connect();
      await vi.advanceTimersByTimeAsync(1000);

      await expect(p).resolves.toBeUndefined();
      expect(mockWs.waitForGreetings).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // disconnect / getStatus / onStatusChange
  // -------------------------------------------------------------------------

  describe('disconnect()', () => {
    it('delegates to ws.disconnect', async () => {
      await wrangler.disconnect(5000);
      expect(mockWs.disconnect).toHaveBeenCalledWith(5000);
    });
  });

  describe('getStatus()', () => {
    it('delegates to ws.getStatus', () => {
      mockWs.getStatus.mockReturnValue('OPEN');
      expect(wrangler.getStatus()).toBe('OPEN');
    });
  });

  describe('onStatusChange()', () => {
    it('delegates to ws.onStatusChange', () => {
      const cb = vi.fn();
      wrangler.onStatusChange(cb);
      expect(mockWs.onStatusChange).toHaveBeenCalledWith(cb);
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
      mockWs.waitForGreetings.mockRejectedValue(new Error('refused'));

      const p = wrangler.getHeadStatus(600_000).catch((e) => e);

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
    it('resolves on HeadIsOpen message', async () => {
      const p = wrangler.waitForHeadOpen(10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsOpen' });

      await expect(p).resolves.toBeUndefined();
    });

    it('sends Init (direct-open) on Greetings with Idle status', async () => {
      const p = wrangler.waitForHeadOpen(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Idle' as HeadStatus });
      await flushAsync();

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Init' });
      // Opening no longer commits any UTxOs (ADR-33)
      expect(mockHttp.buildCommit).not.toHaveBeenCalled();

      emitMessage({ tag: 'HeadIsOpen' });
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects on timeout', async () => {
      const p = wrangler.waitForHeadOpen(2000);
      await flushAsync();

      vi.advanceTimersByTime(2000);

      await expect(p).rejects.toThrow('Timeout waiting for head to open');
    });

    it('settles only once even if multiple HeadIsOpen messages arrive', async () => {
      const p = wrangler.waitForHeadOpen(10000);
      await flushAsync();

      emitMessage({ tag: 'HeadIsOpen' });
      emitMessage({ tag: 'HeadIsOpen' });

      await expect(p).resolves.toBeUndefined();
    });

    it('resolves immediately on Greetings with Open status (steady-state)', async () => {
      const p = wrangler.waitForHeadOpen(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Open' as HeadStatus });

      await expect(p).resolves.toBeUndefined();
      // Must not try to drive the lifecycle forward — no Init send
      expect(mockWs.send).not.toHaveBeenCalledWith({ tag: 'Init' });
    });

    it('resolves immediately when Greetings is replayed with Open status', async () => {
      // Simulate a prior-connection Greetings replay via lastGreetings
      (mockWs as unknown as { lastGreetings: unknown }).lastGreetings = {
        tag: 'Greetings',
        headStatus: 'Open',
      };

      const p = wrangler.waitForHeadOpen(10000);

      await expect(p).resolves.toBeUndefined();

      (mockWs as unknown as { lastGreetings: unknown }).lastGreetings = undefined;
    });

    it.each([
      'Closed',
      'FanoutPossible',
      'Final',
    ] as const)('rejects fast on Greetings with terminal status %s', async (status) => {
      const p = wrangler.waitForHeadOpen(600_000).catch((e) => e);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: status as HeadStatus });

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(`head is "${status}"`);
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

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Fanout' });

      emitMessage({ tag: 'HeadIsFinalized' });
      await expect(p).resolves.toBeUndefined();
    });

    it('calls close on Greetings with Open status', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Open' as HeadStatus });
      await flushAsync();

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Close' });

      emitMessage({ tag: 'HeadIsFinalized' });
      await expect(p).resolves.toBeUndefined();
    });

    it('calls fanout on Greetings with FanoutPossible status', async () => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'FanoutPossible' as HeadStatus });
      await flushAsync();

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Fanout' });

      emitMessage({ tag: 'HeadIsFinalized' });
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects on timeout', async () => {
      const p = wrangler.waitForHeadClose(2000);
      await flushAsync();

      vi.advanceTimersByTime(2000);

      await expect(p).rejects.toThrow('Timeout waiting for head to close!');
    });

    it.each([
      'Closed',
      'Final',
    ] as const)('resolves immediately on Greetings with %s status (steady-state)', async (status) => {
      const p = wrangler.waitForHeadClose(10000);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: status as HeadStatus });

      await expect(p).resolves.toBeUndefined();
      // Must not try to drive the lifecycle forward
      expect(mockWs.send).not.toHaveBeenCalledWith({ tag: 'Close' });
      expect(mockWs.send).not.toHaveBeenCalledWith({ tag: 'Fanout' });
    });

    it('resolves immediately when Greetings is replayed with Closed status', async () => {
      (mockWs as unknown as { lastGreetings: unknown }).lastGreetings = {
        tag: 'Greetings',
        headStatus: 'Closed',
      };

      const p = wrangler.waitForHeadClose(10000);

      await expect(p).resolves.toBeUndefined();

      (mockWs as unknown as { lastGreetings: unknown }).lastGreetings = undefined;
    });

    it('rejects fast on Greetings with Idle status (nothing to close)', async () => {
      const p = wrangler.waitForHeadClose(600_000).catch((e) => e);
      await flushAsync();

      emitMessage({ tag: 'Greetings', headStatus: 'Idle' as HeadStatus });

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('head is "Idle"');
    });
  });

  // -------------------------------------------------------------------------
  // startHead / shutdownHead
  // -------------------------------------------------------------------------

  describe('startHead()', () => {
    it('sets mode to start, registers handler, and connects', async () => {
      await wrangler.startHead();

      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.waitForGreetings).toHaveBeenCalled();
    });

    it('handler calls init on Greetings Idle without committing (direct-open)', async () => {
      await wrangler.startHead();

      emitMessage({ tag: 'Greetings', headStatus: 'Idle' as HeadStatus });
      await flushAsync();

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Init' });
      expect(mockHttp.buildCommit).not.toHaveBeenCalled();
    });
  });

  describe('shutdownHead()', () => {
    it('sets mode to shutdown, registers handler, and connects', async () => {
      await wrangler.shutdownHead();

      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.waitForGreetings).toHaveBeenCalled();
    });

    it('handler calls fanout on ReadyToFanout', async () => {
      await wrangler.shutdownHead();

      emitMessage({ tag: 'ReadyToFanout' });
      await flushAsync();

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Fanout' });
    });

    it('handler calls close on Greetings Open', async () => {
      await wrangler.shutdownHead();

      emitMessage({ tag: 'Greetings', headStatus: 'Open' as HeadStatus });
      await flushAsync();

      expect(mockWs.send).toHaveBeenCalledWith({ tag: 'Close' });
    });
  });

  // -------------------------------------------------------------------------
  // decommit
  // -------------------------------------------------------------------------

  describe('decommit()', () => {
    const decommitTx = { type: 'Tx ConwayEra' as const, cborHex: 'decommitcbor', description: '' };

    it('resolves on DecommitApproved', async () => {
      // First onMessage call is getHeadStatus — simulate Greetings
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.decommit(decommitTx, 10000);
      await flushAsync();

      // Now the decommit awaitMessage handler is registered
      emitMessage({ tag: 'DecommitApproved' });

      await expect(p).resolves.toBeUndefined();
      expect(mockHttp.publishDecommit).toHaveBeenCalledWith(decommitTx);
    });

    it('rejects on DecommitInvalid', async () => {
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
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
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Idle' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.decommit(decommitTx, 10000).catch((e) => e);
      await flushAsync();

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Cannot decommit: head is "Idle"');
    });

    it('rejects on timeout', async () => {
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.decommit(decommitTx, 3000);
      await flushAsync();

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
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.incrementalCommit(singleUtxo, 10000);
      await flushAsync();

      expect(mockBlockfrost.fetchUTxOs).toHaveBeenCalledWith('inc123', 0);
      expect(mockHttp.buildCommit).toHaveBeenCalled();

      emitMessage({ tag: 'CommitFinalized' });

      await expect(p).resolves.toBeUndefined();
    });

    it('uses blueprint in buildCommit when blueprintTx provided', async () => {
      const blueprintTx = { type: 'Tx ConwayEra' as const, cborHex: 'bpcbor', description: '' };
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.incrementalCommit({ ...singleUtxo, blueprintTx }, 10000);
      await flushAsync();

      expect(mockHttp.buildCommit).toHaveBeenCalledWith(expect.objectContaining({ blueprintTx }));

      emitMessage({ tag: 'CommitFinalized' });

      await expect(p).resolves.toBeUndefined();
    });

    it('rejects when head is not Open', async () => {
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Idle' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.incrementalCommit(singleUtxo, 10000).catch((e) => e);
      await flushAsync();

      const err = await p;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('Cannot incrementally commit');
    });

    it('rejects when utxos.length !== 1', async () => {
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
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
      const origOn = mockWs.on.getMockImplementation()!;
      mockWs.on.mockImplementationOnce((event: string, cb: (msg: HydraWsMessage) => void) => {
        origOn(event, cb);
        if (event === 'message') setTimeout(() => cb({ tag: 'Greetings', headStatus: 'Open' } as HydraWsMessage), 0);
        return mockWs;
      });

      const p = wrangler.incrementalCommit(singleUtxo, 3000);
      await flushAsync();

      vi.advanceTimersByTime(3000);

      await expect(p).rejects.toThrow('Timeout waiting for incremental commit finalization');
    });
  });
});
