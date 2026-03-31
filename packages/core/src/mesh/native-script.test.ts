import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import of the module under test
// ---------------------------------------------------------------------------

vi.mock('@meshsdk/core', () => ({
  deserializeAddress: vi.fn((addr: string) => ({ pubKeyHash: `hash_${addr}` })),
  serializeNativeScript: vi.fn((_script, _unused, _networkId) => ({
    address: 'addr_script1...',
    scriptCbor: 'script_cbor_hex',
  })),
  resolveScriptHash: vi.fn((_cbor: string) => 'script_hash_abc'),
}));

const { createMultisigAddress, createNativeScript } = await import('./native-script.js');
const { serializeNativeScript } = await import('@meshsdk/core');
const mockedSerialize = vi.mocked(serializeNativeScript);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMultisigAddress', () => {
  it('creates script with two key hashes and default "any" type', () => {
    const result = createMultisigAddress('addr1', 'addr2');

    expect(mockedSerialize).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'any',
        scripts: [
          { type: 'sig', keyHash: 'hash_addr1' },
          { type: 'sig', keyHash: 'hash_addr2' },
        ],
      }),
      undefined,
      0,
    );
    expect(result.address).toBe('addr_script1...');
    expect(result.scriptCbor).toBe('script_cbor_hex');
    expect(result.scriptHash).toBe('script_hash_abc');
  });

  it('respects scriptType "all"', () => {
    createMultisigAddress('addr1', 'addr2', 0, 'all');

    expect(mockedSerialize).toHaveBeenCalledWith(expect.objectContaining({ type: 'all' }), undefined, 0);
  });

  it('passes networkId through', () => {
    createMultisigAddress('addr1', 'addr2', 1);

    expect(mockedSerialize).toHaveBeenCalledWith(expect.anything(), undefined, 1);
  });
});

describe('createNativeScript', () => {
  it('creates a bare sig script when called without options', () => {
    const result = createNativeScript('addr1');

    expect(mockedSerialize).toHaveBeenCalledWith({ type: 'sig', keyHash: 'hash_addr1' }, undefined, 0);
    expect(result.address).toBe('addr_script1...');
    expect(result.scriptCbor).toBe('script_cbor_hex');
    expect(result.scriptHash).toBe('script_hash_abc');
  });

  it('creates a compound all:[sig, before] script when invalidHereafter is provided', () => {
    createNativeScript('addr1', { invalidHereafter: 2000 });

    expect(mockedSerialize).toHaveBeenCalledWith(
      {
        type: 'all',
        scripts: [
          { type: 'sig', keyHash: 'hash_addr1' },
          { type: 'before', slot: '2000' },
        ],
      },
      undefined,
      0,
    );
  });

  it('passes networkId through', () => {
    createNativeScript('addr1', { networkId: 1 });

    expect(mockedSerialize).toHaveBeenCalledWith(expect.anything(), undefined, 1);
  });

  it('returns undefined scriptHash when scriptCbor is undefined', () => {
    mockedSerialize.mockReturnValueOnce({ address: 'addr_script1...' } as ReturnType<typeof serializeNativeScript>);

    const result = createNativeScript('addr1');

    expect(result.scriptHash).toBeUndefined();
  });
});
