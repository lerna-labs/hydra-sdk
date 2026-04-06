import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydraHttpClient } from './hydra-http-client.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();

vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body = '') {
  return new Response(body, { status });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HydraHttpClient', () => {
  let client: HydraHttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new HydraHttpClient('http://localhost:4001');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildCommit()', () => {
    it('POSTs to /commit and returns cborHex', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ cborHex: 'deadbeef' }));

      const result = await client.buildCommit({});

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4001/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(result).toBe('deadbeef');
    });

    it('handles blueprint commit payload', async () => {
      const payload = {
        blueprintTx: { type: 'Tx ConwayEra' as const, cborHex: 'cafe', description: '' },
        utxo: {
          'abc#0': {
            address: 'addr1',
            datum: null,
            inlineDatum: null,
            inlineDatumRaw: null,
            inlineDatumhash: null,
            referenceScript: null,
            value: { lovelace: 5000000 },
          },
        },
      };

      mockFetch.mockResolvedValueOnce(jsonResponse({ cborHex: 'signed-tx' }));

      const result = await client.buildCommit(payload);
      expect(result).toBe('signed-tx');

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.blueprintTx.cborHex).toBe('cafe');
      expect(body.utxo['abc#0'].address).toBe('addr1');
    });

    it('accepts 202 status', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ cborHex: 'abc' }, 202));
      await expect(client.buildCommit({})).resolves.toBe('abc');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));
      await expect(client.buildCommit({})).rejects.toThrow('Hydra HTTP 500 on POST /commit');
    });
  });

  describe('publishDecommit()', () => {
    it('POSTs the transaction envelope directly to /decommit', async () => {
      const tx = { type: 'Tx ConwayEra' as const, cborHex: 'decommit-cbor', description: '' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ cborHex: 'result' }));

      await client.publishDecommit(tx);

      const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
      expect(body.type).toBe('Tx ConwayEra');
      expect(body.cborHex).toBe('decommit-cbor');
      expect(body.tag).toBeUndefined();
    });
  });

  describe('getSnapshotUtxo()', () => {
    it('GETs /snapshot/utxo', async () => {
      const utxos = {
        'abc#0': {
          address: 'addr1',
          datum: null,
          inlineDatum: null,
          inlineDatumRaw: null,
          inlineDatumhash: null,
          referenceScript: null,
          value: { lovelace: 1000000 },
        },
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(utxos));

      const result = await client.getSnapshotUtxo();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4001/snapshot/utxo');
      expect(result['abc#0'].address).toBe('addr1');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(404, 'Not Found'));
      await expect(client.getSnapshotUtxo()).rejects.toThrow('Hydra HTTP 404 on GET /snapshot/utxo');
    });
  });

  describe('getProtocolParameters()', () => {
    it('GETs /protocol-parameters', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ maxTxSize: 16384 }));

      const result = await client.getProtocolParameters();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4001/protocol-parameters');
      expect(result).toEqual({ maxTxSize: 16384 });
    });
  });

  it('strips trailing slashes from baseUrl', async () => {
    const c = new HydraHttpClient('http://localhost:4001///');
    mockFetch.mockResolvedValueOnce(jsonResponse({ cborHex: 'abc' }));

    await c.buildCommit({});

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:4001/commit', expect.anything());
  });
});
