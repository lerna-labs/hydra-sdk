import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HydraWsMessage } from './types.js';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

let mockWsInstance: InstanceType<typeof MockWebSocket>;

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => this.emit('close'), 0);
  });
  terminate = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(_url: string) {
    super();
    mockWsInstance = this;
    // Emit 'open' on next microtask (not setTimeout, so it works with fake timers)
    Promise.resolve().then(() => this.emit('open'));
  }
}

vi.mock('ws', () => {
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

const { HydraWebSocket } = await import('./hydra-websocket.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitWsMessage(msg: Partial<HydraWsMessage> & { tag: string }) {
  const data = Buffer.from(JSON.stringify(msg));
  mockWsInstance.emit('message', data);
}

async function flushAsync() {
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HydraWebSocket', () => {
  let hydraWs: InstanceType<typeof HydraWebSocket>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    hydraWs = new HydraWebSocket('ws://localhost:4001');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connect()', () => {
    it('resolves when WebSocket opens', async () => {
      const p = hydraWs.connect();
      await flushAsync();
      await expect(p).resolves.toBeUndefined();
      expect(hydraWs.connectionState).toBe('CONNECTING');
    });
  });

  describe('waitForGreetings()', () => {
    it('resolves true when Greetings is received', async () => {
      const p = hydraWs.waitForGreetings(5000);
      await flushAsync();

      emitWsMessage({ tag: 'Greetings', headStatus: 'Idle' });

      await expect(p).resolves.toBe(true);
      expect(hydraWs.connectionState).toBe('CONNECTED');
    });

    it('rejects on timeout when no Greetings received', async () => {
      const p = hydraWs.waitForGreetings(3000);
      await flushAsync();

      vi.advanceTimersByTime(3000);

      await expect(p).rejects.toThrow('Connection timed out: no Greetings from Hydra node');
      expect(hydraWs.connectionState).toBe('FAILED');
    });

    it('returns true immediately if already connected', async () => {
      // First connection
      const p1 = hydraWs.waitForGreetings(5000);
      await flushAsync();
      emitWsMessage({ tag: 'Greetings', headStatus: 'Open' });
      await p1;

      // Second call should resolve immediately
      await expect(hydraWs.waitForGreetings(5000)).resolves.toBe(true);
    });
  });

  describe('message dispatch', () => {
    it('emits message events to all listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      hydraWs.on('message', listener1);
      hydraWs.on('message', listener2);

      await hydraWs.connect();
      await flushAsync();

      emitWsMessage({ tag: 'HeadIsOpen' });

      expect(listener1).toHaveBeenCalledWith(expect.objectContaining({ tag: 'HeadIsOpen' }));
      expect(listener2).toHaveBeenCalledWith(expect.objectContaining({ tag: 'HeadIsOpen' }));
    });

    it('does not lose messages when multiple listeners exist', async () => {
      const messages: string[] = [];
      hydraWs.on('message', (msg: HydraWsMessage) => messages.push(msg.tag));

      await hydraWs.connect();
      await flushAsync();

      emitWsMessage({ tag: 'Greetings', headStatus: 'Idle' });
      emitWsMessage({ tag: 'HeadIsInitializing', headId: 'abc', parties: [] });
      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });

      expect(messages).toEqual(['Greetings', 'HeadIsInitializing', 'HeadIsOpen']);
    });
  });

  describe('status tracking', () => {
    it('updates status from Greetings headStatus', async () => {
      await hydraWs.connect();
      await flushAsync();

      expect(hydraWs.getStatus()).toBe('IDLE');

      emitWsMessage({ tag: 'Greetings', headStatus: 'Open' });
      expect(hydraWs.getStatus()).toBe('OPEN');
    });

    it('updates status from state transition messages', async () => {
      await hydraWs.connect();
      await flushAsync();

      emitWsMessage({ tag: 'HeadIsInitializing', headId: 'abc', parties: [] });
      expect(hydraWs.getStatus()).toBe('INITIALIZING');

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });
      expect(hydraWs.getStatus()).toBe('OPEN');

      emitWsMessage({ tag: 'HeadIsClosed' });
      expect(hydraWs.getStatus()).toBe('CLOSED');

      emitWsMessage({ tag: 'ReadyToFanout' });
      expect(hydraWs.getStatus()).toBe('FANOUT_POSSIBLE');

      emitWsMessage({ tag: 'HeadIsFinalized' });
      expect(hydraWs.getStatus()).toBe('FINAL');
    });

    it('emits status events on status changes', async () => {
      const statusChanges: string[] = [];
      hydraWs.on('status', (s: string) => statusChanges.push(s));

      await hydraWs.connect();
      await flushAsync();

      emitWsMessage({ tag: 'Greetings', headStatus: 'Open' });
      emitWsMessage({ tag: 'HeadIsClosed' });

      expect(statusChanges).toEqual(['OPEN', 'CLOSED']);
    });

    it('onStatusChange registers listener and returns current status', async () => {
      await hydraWs.connect();
      await flushAsync();

      emitWsMessage({ tag: 'Greetings', headStatus: 'Idle' });

      const cb = vi.fn();
      const current = hydraWs.onStatusChange(cb);
      expect(current).toBe('IDLE');

      emitWsMessage({ tag: 'HeadIsOpen', utxo: {} });
      expect(cb).toHaveBeenCalledWith('OPEN');
    });
  });

  describe('send()', () => {
    it('sends JSON over WebSocket', async () => {
      await hydraWs.connect();
      await flushAsync();

      hydraWs.send({ tag: 'Init' });
      expect(mockWsInstance.send).toHaveBeenCalledWith('{"tag":"Init"}');
    });

    it('throws when not connected', () => {
      expect(() => hydraWs.send({ tag: 'Init' })).toThrow('WebSocket is not connected');
    });
  });

  describe('disconnect()', () => {
    it('closes the WebSocket', async () => {
      await hydraWs.connect();
      await flushAsync();

      const p = hydraWs.disconnect(5000);
      await flushAsync();

      await expect(p).resolves.toBeUndefined();
      expect(hydraWs.connectionState).toBe('DISCONNECTED');
    });

    it('resolves immediately when not connected', async () => {
      await expect(hydraWs.disconnect()).resolves.toBeUndefined();
    });
  });
});
