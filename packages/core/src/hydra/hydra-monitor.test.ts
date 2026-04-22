import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HydraStatus, HydraWsMessage } from './types.js';

// ---------------------------------------------------------------------------
// Mock HydraWebSocket
// ---------------------------------------------------------------------------

const mockWs = new EventEmitter() as EventEmitter & {
  waitForGreetings: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  connectionState: string;
  lastGreetings: HydraWsMessage | null;
  send: ReturnType<typeof vi.fn>;
};

mockWs.waitForGreetings = vi.fn<() => Promise<boolean>>();
mockWs.disconnect = vi.fn<() => Promise<void>>();
mockWs.connectionState = 'IDLE';
mockWs.lastGreetings = null;
mockWs.send = vi.fn();

vi.mock('./hydra-websocket.js', () => ({
  // biome-ignore lint/complexity/useArrowFunction: must be constructable with `new`
  HydraWebSocket: function () {
    return mockWs;
  },
  HEAD_STATUS_TO_HYDRA: {
    Idle: 'IDLE',
    Initializing: 'INITIALIZING',
    Open: 'OPEN',
    Closed: 'CLOSED',
    FanoutPossible: 'FANOUT_POSSIBLE',
    Final: 'FINAL',
  },
  TAG_TO_HYDRA: {
    HeadIsInitializing: 'INITIALIZING',
    HeadIsOpen: 'OPEN',
    HeadIsClosed: 'CLOSED',
    ReadyToFanout: 'FANOUT_POSSIBLE',
    HeadIsFinalized: 'FINAL',
  },
}));

const { HydraMonitor } = await import('./hydra-monitor.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greetingsMsg(headStatus = 'Idle'): HydraWsMessage {
  return {
    tag: 'Greetings',
    headStatus,
    me: { vkey: 'abc123' },
    hydraHeadId: 'deb5680101c46df8583b02ad2dccccff8058c3d0301a074a876f1c70',
    hydraNodeVersion: '1.3.0-test',
    chainSyncedStatus: 'InSync',
    currentSlot: 119808552,
    env: {
      configuredPeers: 'peer1:5001,peer2:5002',
      contestationPeriod: 120,
      depositPeriod: 1800,
      otherParties: [],
      participants: ['4ab95844', 'deadbeef'],
      party: { vkey: 'abc123' },
    },
    networkInfo: { networkConnected: true, peersInfo: {} },
  } as HydraWsMessage;
}

function emitWsMessage(msg: Partial<HydraWsMessage> & { tag: string }) {
  mockWs.emit('message', msg as HydraWsMessage);
}

async function flushAsync() {
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HydraMonitor', () => {
  let monitor: InstanceType<typeof HydraMonitor>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWs.removeAllListeners();
    mockWs.connectionState = 'CONNECTED';
    mockWs.lastGreetings = greetingsMsg('Idle');
    mockWs.waitForGreetings.mockResolvedValue(true);
    mockWs.disconnect.mockResolvedValue(undefined);

    monitor = new HydraMonitor({ wsUrl: 'ws://localhost:4001', eventBufferSize: 5 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────

  describe('start()', () => {
    it('resolves after Greetings and emits connected', async () => {
      const connected = vi.fn();
      monitor.on('connected', connected);

      await monitor.start();

      expect(mockWs.waitForGreetings).toHaveBeenCalledOnce();
      expect(connected).toHaveBeenCalledOnce();
      expect(monitor.headStatus).toBe('IDLE');
    });

    it('processes Greetings with non-Idle status', async () => {
      mockWs.lastGreetings = greetingsMsg('Open');

      await monitor.start();

      expect(monitor.headStatus).toBe('OPEN');
    });
  });

  describe('stop()', () => {
    it('disconnects and emits disconnected', async () => {
      await monitor.start();

      const disconnected = vi.fn();
      monitor.on('disconnected', disconnected);

      await monitor.stop();

      expect(mockWs.disconnect).toHaveBeenCalledOnce();
      expect(disconnected).toHaveBeenCalledOnce();
    });

    it('suppresses reconnect after stop', async () => {
      await monitor.start();
      await monitor.stop();

      // Simulate close event — should not trigger reconnect
      mockWs.emit('close');
      await flushAsync();

      expect(mockWs.waitForGreetings).toHaveBeenCalledOnce(); // Only the initial start
    });
  });

  describe('connected', () => {
    it('reflects WebSocket state', async () => {
      mockWs.connectionState = 'DISCONNECTED';
      expect(monitor.connected).toBe(false);

      mockWs.connectionState = 'CONNECTED';
      expect(monitor.connected).toBe(true);
    });
  });

  // ── State Tracking ─────────────────────────────────────────────────

  describe('headStatus', () => {
    it('updates from Greetings headStatus', async () => {
      await monitor.start();

      emitWsMessage({ tag: 'Greetings', headStatus: 'Open', me: { vkey: 'x' } });

      expect(monitor.headStatus).toBe('OPEN');
    });

    it('updates from state transition messages', async () => {
      await monitor.start();

      emitWsMessage({ tag: 'HeadIsInitializing', headId: 'abc', parties: [] });
      expect(monitor.headStatus).toBe('INITIALIZING');

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });
      expect(monitor.headStatus).toBe('OPEN');

      emitWsMessage({ tag: 'HeadIsClosed' });
      expect(monitor.headStatus).toBe('CLOSED');

      emitWsMessage({ tag: 'ReadyToFanout' });
      expect(monitor.headStatus).toBe('FANOUT_POSSIBLE');

      emitWsMessage({ tag: 'HeadIsFinalized' });
      expect(monitor.headStatus).toBe('FINAL');
    });

    it('maps HeadIsAborted to IDLE', async () => {
      await monitor.start();

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });
      expect(monitor.headStatus).toBe('OPEN');

      emitWsMessage({ tag: 'HeadIsAborted' });
      expect(monitor.headStatus).toBe('IDLE');
    });
  });

  describe('headStatusMixed', () => {
    it('returns mixed-case HeadStatus', async () => {
      await monitor.start();
      expect(monitor.headStatusMixed).toBe('Idle');

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });
      expect(monitor.headStatusMixed).toBe('Open');
    });
  });

  describe('greetings', () => {
    it('returns last Greetings from WebSocket', async () => {
      await monitor.start();
      expect(monitor.greetings?.tag).toBe('Greetings');
      expect(monitor.greetings?.headStatus).toBe('Idle');
    });
  });

  describe('headInfo', () => {
    it('returns null before start', () => {
      mockWs.lastGreetings = null;
      expect(monitor.headInfo).toBeNull();
    });

    it('extracts summary from Greetings', async () => {
      await monitor.start();
      const info = monitor.headInfo;

      expect(info).not.toBeNull();
      expect(info!.headStatus).toBe('Idle');
      expect(info!.headId).toBe('deb5680101c46df8583b02ad2dccccff8058c3d0301a074a876f1c70');
      expect(info!.nodeVersion).toBe('1.3.0-test');
      expect(info!.me).toBe('abc123');
      expect(info!.contestationPeriod).toBe(120);
      expect(info!.depositPeriod).toBe(1800);
      expect(info!.participants).toEqual(['4ab95844', 'deadbeef']);
      expect(info!.networkConnected).toBe(true);
      expect(info!.peerCount).toBe(2);
      expect(info!.chainSyncedStatus).toBe('InSync');
      expect(info!.currentSlot).toBe(119808552);
    });

    it('handles missing optional fields', async () => {
      mockWs.lastGreetings = { tag: 'Greetings', headStatus: 'Idle', me: { vkey: 'xyz' } } as HydraWsMessage;
      await monitor.start();
      const info = monitor.headInfo;

      expect(info!.headId).toBeNull();
      expect(info!.nodeVersion).toBeNull();
      expect(info!.contestationPeriod).toBeNull();
      expect(info!.participants).toEqual([]);
      expect(info!.networkConnected).toBe(false);
      expect(info!.peerCount).toBe(0);
      expect(info!.chainSyncedStatus).toBeNull();
      expect(info!.currentSlot).toBeNull();
    });

    it('reflects live headStatus across transition messages', async () => {
      await monitor.start();
      expect(monitor.headInfo!.headStatus).toBe('Idle');

      emitWsMessage({ tag: 'HeadIsInitializing', headId: 'new-head-abc', parties: [] });
      expect(monitor.headInfo!.headStatus).toBe('Initializing');

      emitWsMessage({ tag: 'HeadIsOpen', headId: 'new-head-abc', utxo: {} });
      expect(monitor.headInfo!.headStatus).toBe('Open');

      emitWsMessage({ tag: 'HeadIsClosed', headId: 'new-head-abc' });
      expect(monitor.headInfo!.headStatus).toBe('Closed');

      emitWsMessage({ tag: 'ReadyToFanout', headId: 'new-head-abc' });
      expect(monitor.headInfo!.headStatus).toBe('FanoutPossible');

      emitWsMessage({ tag: 'HeadIsFinalized', headId: 'new-head-abc', utxo: {} });
      expect(monitor.headInfo!.headStatus).toBe('Final');
    });

    it('tracks headId from HeadIsInitializing when Greetings lacks it', async () => {
      mockWs.lastGreetings = {
        tag: 'Greetings',
        headStatus: 'Idle',
        me: { vkey: 'xyz' },
      } as HydraWsMessage;
      await monitor.start();
      expect(monitor.headInfo!.headId).toBeNull();

      emitWsMessage({ tag: 'HeadIsInitializing', headId: 'fresh-head-id', parties: [] });
      expect(monitor.headInfo!.headId).toBe('fresh-head-id');
    });

    it('clears headId on HeadIsAborted', async () => {
      await monitor.start();
      emitWsMessage({ tag: 'HeadIsInitializing', headId: 'head-to-abort', parties: [] });
      expect(monitor.headInfo!.headId).toBe('head-to-abort');

      emitWsMessage({ tag: 'HeadIsAborted', headId: 'head-to-abort', utxo: {} });
      expect(monitor.headInfo!.headStatus).toBe('Idle');
      expect(monitor.headInfo!.headId).toBeNull();
    });
  });

  // ── Status Events ──────────────────────────────────────────────────

  describe('status events', () => {
    it('emits status with new and previous', async () => {
      await monitor.start();

      const statusChanges: [HydraStatus, HydraStatus][] = [];
      monitor.on('status', (s: HydraStatus, prev: HydraStatus) => statusChanges.push([s, prev]));

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });
      emitWsMessage({ tag: 'HeadIsClosed' });

      expect(statusChanges).toEqual([
        ['OPEN', 'IDLE'],
        ['CLOSED', 'OPEN'],
      ]);
    });

    it('does not emit when status unchanged', async () => {
      await monitor.start();

      const statusFn = vi.fn();
      monitor.on('status', statusFn);

      emitWsMessage({ tag: 'Greetings', headStatus: 'Idle', me: { vkey: 'x' } });

      expect(statusFn).not.toHaveBeenCalled();
    });
  });

  // ── Ring Buffer ────────────────────────────────────────────────────

  describe('recentEvents', () => {
    it('stores messages up to buffer size', async () => {
      await monitor.start();

      for (let i = 0; i < 7; i++) {
        emitWsMessage({ tag: 'TxValid', transaction: { cborHex: `tx${i}` } });
      }

      // Buffer size is 5, but Greetings from start() also counts = 1 + 7 = 8, capped at 5
      expect(monitor.recentEvents.length).toBe(5);
      // Most recent should be last
      expect((monitor.recentEvents[4].message as any).transaction.cborHex).toBe('tx6');
    });

    it('includes timestamps', async () => {
      await monitor.start();
      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });

      expect(monitor.recentEvents.length).toBeGreaterThan(0);
      expect(typeof monitor.recentEvents[0].timestamp).toBe('number');
    });
  });

  // ── Error Routing ──────────────────────────────────────────────────

  describe('error routing', () => {
    it('emits error:tx on PostTxOnChainFailed', async () => {
      await monitor.start();

      const handler = vi.fn();
      monitor.on('error:tx', handler);

      emitWsMessage({ tag: 'PostTxOnChainFailed' });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tag: 'PostTxOnChainFailed' }));
    });

    it('emits error:tx on TxInvalid', async () => {
      await monitor.start();

      const handler = vi.fn();
      monitor.on('error:tx', handler);

      emitWsMessage({ tag: 'TxInvalid', transaction: {}, validationError: { reason: 'bad' } });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tag: 'TxInvalid' }));
    });

    it('emits error:command on CommandFailed', async () => {
      await monitor.start();

      const handler = vi.fn();
      monitor.on('error:command', handler);

      emitWsMessage({ tag: 'CommandFailed', clientInput: { tag: 'Init' } });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tag: 'CommandFailed' }));
    });

    it('emits error:decommit on DecommitInvalid', async () => {
      await monitor.start();

      const handler = vi.fn();
      monitor.on('error:decommit', handler);

      emitWsMessage({ tag: 'DecommitInvalid', decommitInvalidReason: {} });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ tag: 'DecommitInvalid' }));
    });
  });

  // ── Wait Helpers ───────────────────────────────────────────────────

  describe('waitForStatus()', () => {
    it('resolves immediately if already at target', async () => {
      await monitor.start();
      await expect(monitor.waitForStatus('IDLE')).resolves.toBeUndefined();
    });

    it('resolves when status transitions to target', async () => {
      await monitor.start();

      const p = monitor.waitForStatus('OPEN', 5000);

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });

      await expect(p).resolves.toBeUndefined();
    });

    it('rejects on timeout', async () => {
      await monitor.start();

      const p = monitor.waitForStatus('OPEN', 1000);

      vi.advanceTimersByTime(1000);

      await expect(p).rejects.toThrow('Timeout waiting for status "OPEN"');
    });
  });

  describe('waitForMessage()', () => {
    it('resolves on matching tag', async () => {
      await monitor.start();

      const p = monitor.waitForMessage('HeadIsOpen', 5000);

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });

      const result = await p;
      expect(result.tag).toBe('HeadIsOpen');
    });

    it('ignores non-matching tags', async () => {
      await monitor.start();

      const p = monitor.waitForMessage('HeadIsOpen', 5000);

      emitWsMessage({ tag: 'TxValid', transaction: {} });
      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });

      await expect(p).resolves.toEqual(expect.objectContaining({ tag: 'HeadIsOpen' }));
    });

    it('rejects on timeout', async () => {
      await monitor.start();

      const p = monitor.waitForMessage('HeadIsOpen', 1000);

      vi.advanceTimersByTime(1000);

      await expect(p).rejects.toThrow('Timeout waiting for message "HeadIsOpen"');
    });
  });

  // ── Auto-Reconnect ─────────────────────────────────────────────────

  describe('auto-reconnect', () => {
    it('reconnects after unexpected close', async () => {
      await monitor.start();

      const reconnecting = vi.fn();
      const connected = vi.fn();
      monitor.on('reconnecting', reconnecting);
      monitor.on('connected', connected);

      // Reset for reconnect
      mockWs.lastGreetings = greetingsMsg('Open');

      // Simulate unexpected close
      mockWs.emit('close');

      // Advance past first reconnect delay (1000ms base)
      await vi.advanceTimersByTimeAsync(1000);
      await flushAsync();

      expect(reconnecting).toHaveBeenCalledWith(1, 1000);
      expect(connected).toHaveBeenCalled();
      expect(monitor.headStatus).toBe('OPEN');
    });

    it('emits disconnected on close', async () => {
      await monitor.start();

      const disconnected = vi.fn();
      monitor.on('disconnected', disconnected);

      mockWs.emit('close');

      expect(disconnected).toHaveBeenCalledOnce();
    });

    it('retries with exponential backoff', async () => {
      await monitor.start();

      const reconnecting = vi.fn();
      monitor.on('reconnecting', reconnecting);

      // Fail first two reconnect attempts
      mockWs.waitForGreetings
        .mockRejectedValueOnce(new Error('refused'))
        .mockRejectedValueOnce(new Error('refused'))
        .mockResolvedValueOnce(true);

      mockWs.emit('close');

      // First attempt: 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      await flushAsync();
      expect(reconnecting).toHaveBeenCalledWith(1, 1000);

      // Second attempt: 2000ms
      await vi.advanceTimersByTimeAsync(2000);
      await flushAsync();
      expect(reconnecting).toHaveBeenCalledWith(2, 2000);

      // Third attempt: 4000ms
      await vi.advanceTimersByTimeAsync(4000);
      await flushAsync();
      expect(reconnecting).toHaveBeenCalledWith(3, 4000);
    });

    it('emits reconnect_failed after maxAttempts', async () => {
      monitor = new HydraMonitor({
        wsUrl: 'ws://localhost:4001',
        reconnect: { maxAttempts: 2, baseDelayMs: 100 },
      });

      await monitor.start();

      const failed = vi.fn();
      monitor.on('reconnect_failed', failed);

      mockWs.waitForGreetings.mockRejectedValue(new Error('refused'));

      mockWs.emit('close');

      await vi.advanceTimersByTimeAsync(100); // attempt 1
      await flushAsync();
      await vi.advanceTimersByTimeAsync(200); // attempt 2
      await flushAsync();

      expect(failed).toHaveBeenCalledOnce();
    });

    it('does not reconnect when reconnect.enabled is false', async () => {
      monitor = new HydraMonitor({
        wsUrl: 'ws://localhost:4001',
        reconnect: { enabled: false },
      });

      await monitor.start();

      const disconnected = vi.fn();
      const reconnecting = vi.fn();
      monitor.on('disconnected', disconnected);
      monitor.on('reconnecting', reconnecting);

      mockWs.emit('close');

      expect(disconnected).toHaveBeenCalledOnce();
      expect(reconnecting).not.toHaveBeenCalled();
    });
  });
});
