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
};

const mockInstance = {
  commitFunds: vi.fn<(txHash: string, outputIndex: number) => Promise<string>>(),
};

const mockBlockfrost = {
  submitTx: vi.fn<(tx: string) => Promise<string>>(),
};

vi.mock('@meshsdk/hydra', () => ({
  HydraProvider: function () {
    return mockProvider;
  },
  HydraInstance: function () {
    return mockInstance;
  },
}));

vi.mock('@meshsdk/core', () => ({
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
    mockInstance.commitFunds.mockResolvedValue('raw-tx-hex');
    mockBlockfrost.submitTx.mockResolvedValue('tx-hash');

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
    const commitArgs = { txHash: 'abc123', txIndex: 0 };

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

      expect(mockInstance.commitFunds).toHaveBeenCalledWith('abc123', 0);
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

      expect(mockInstance.commitFunds).toHaveBeenCalledWith('abc123', 0);

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
    it('sets mode to start, registers handler, and connects', async () => {
      await wrangler.startHead('tx1', 0);

      expect(mockProvider.onMessage).toHaveBeenCalled();
      expect(mockProvider.isConnected).toHaveBeenCalled();
    });

    it('handler commits on HeadIsInitializing', async () => {
      await wrangler.startHead('tx1', 2);

      emitMessage({ tag: 'HeadIsInitializing' });
      await flushAsync();

      expect(mockInstance.commitFunds).toHaveBeenCalledWith('tx1', 2);
    });

    it('handler calls init on Greetings Idle', async () => {
      await wrangler.startHead('tx1', 0);

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
});
