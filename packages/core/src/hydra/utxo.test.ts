import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUtxoSet, queryUtxoByAddress } from './utxo.js';

// Mock fetch
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

const SAMPLE_SNAPSHOT: Record<string, any> = {
  'abc123#0': {
    address: 'addr_test1qz_alice',
    datum: null,
    datumHash: null,
    inlineDatum: null,
    referenceScript: null,
    value: { lovelace: '5000000' },
  },
  'def456#2': {
    address: 'addr_test1qz_bob',
    datum: null,
    datumHash: 'abc123hash',
    inlineDatum: { constructor: 0, fields: [{ int: 42 }] },
    referenceScript: null,
    value: { lovelace: '10000000', 'policyId.tokenName': '100' },
  },
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getUtxoSet', () => {
  const originalEnv = process.env.HYDRA_API_URL;

  beforeEach(() => {
    process.env.HYDRA_API_URL = 'http://localhost:4001';
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE_SNAPSHOT));
  });

  afterEach(() => {
    process.env.HYDRA_API_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it('throws when HYDRA_API_URL is not set', async () => {
    delete process.env.HYDRA_API_URL;
    await expect(getUtxoSet()).rejects.toThrow('Missing required environment variable: HYDRA_API_URL');
  });

  it('calls the correct snapshot endpoint', async () => {
    await getUtxoSet();
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:4001/snapshot/utxo');
  });

  it('splits txHash#index keys correctly', async () => {
    const result = await getUtxoSet();
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tx_hash: 'abc123', output_index: 0 }),
        expect.objectContaining({ tx_hash: 'def456', output_index: 2 }),
      ]),
    );
  });

  it('maps value object to amount array', async () => {
    const result = await getUtxoSet();
    const bob = result.find((u) => u.tx_hash === 'def456');
    expect(bob?.amount).toEqual([
      { unit: 'lovelace', quantity: '10000000' },
      { unit: 'policyId.tokenName', quantity: '100' },
    ]);
  });

  it('preserves the address field', async () => {
    const result = await getUtxoSet();
    const alice = result.find((u) => u.tx_hash === 'abc123');
    expect(alice?.address).toBe('addr_test1qz_alice');
  });

  it('excludes datum fields by default', async () => {
    const result = await getUtxoSet();
    const bob = result.find((u) => u.tx_hash === 'def456');
    expect(bob).not.toHaveProperty('datum');
    expect(bob).not.toHaveProperty('datumHash');
    expect(bob).not.toHaveProperty('inlineDatum');
    expect(bob).not.toHaveProperty('referenceScript');
  });

  it('includes datum fields when includeDatums is true', async () => {
    const result = await getUtxoSet({ includeDatums: true });
    const alice = result.find((u) => u.tx_hash === 'abc123');
    expect(alice?.datum).toBeNull();
    expect(alice?.datumHash).toBeNull();
    expect(alice?.inlineDatum).toBeNull();

    const bob = result.find((u) => u.tx_hash === 'def456');
    expect(bob?.datumHash).toBe('abc123hash');
    expect(bob?.inlineDatum).toEqual({ constructor: 0, fields: [{ int: 42 }] });
    expect(bob?.referenceScript).toBeNull();
  });
});

describe('queryUtxoByAddress', () => {
  const originalEnv = process.env.HYDRA_API_URL;

  beforeEach(() => {
    process.env.HYDRA_API_URL = 'http://localhost:4001';
    mockFetch.mockResolvedValue(jsonResponse(SAMPLE_SNAPSHOT));
  });

  afterEach(() => {
    process.env.HYDRA_API_URL = originalEnv;
    vi.restoreAllMocks();
  });

  it('filters UTxOs by address', async () => {
    const result = await queryUtxoByAddress('addr_test1qz_alice');
    expect(result).toHaveLength(1);
    expect(result[0].tx_hash).toBe('abc123');
  });

  it('returns empty array when no UTxOs match', async () => {
    const result = await queryUtxoByAddress('addr_test1qz_nobody');
    expect(result).toEqual([]);
  });
});
