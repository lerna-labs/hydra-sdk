import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitTx } from './submit-tx.js';

describe('submitTx', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    mockFetch.mockClear();
  });

  it('calls the correct URL', async () => {
    await submitTx('https://trp.example.com/submit', 'deadbeef', 'tx-1');
    expect(mockFetch).toHaveBeenCalledWith('https://trp.example.com/submit', expect.anything());
  });

  it('sends a POST with JSON content type', async () => {
    await submitTx('https://trp.example.com/submit', 'deadbeef', 'tx-1');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('sends correct JSON-RPC 2.0 body', async () => {
    await submitTx('https://trp.example.com/submit', 'cafebabe', 'tx-42');
    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      jsonrpc: '2.0',
      method: 'trp.submit',
      params: {
        tx: {
          payload: 'cafebabe',
          encoding: 'hex',
          version: 'v1alpha6',
        },
      },
      id: 'tx-42',
    });
  });

  it('returns the fetch Response', async () => {
    const response = await submitTx('https://trp.example.com/submit', 'deadbeef', 'tx-1');
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
  });
});
