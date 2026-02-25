import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import of the module under test
// ---------------------------------------------------------------------------

const mockWallet = {
  init: vi.fn<() => Promise<void>>(),
  addresses: { enterpriseAddressBech32: 'addr_test1qz...' },
};

// Track constructor calls — must use `class` so `new MeshWallet()` works
const meshWalletCalls: unknown[] = [];

class MockMeshWallet {
  constructor(opts: unknown) {
    meshWalletCalls.push(opts);
    // biome-ignore lint/correctness/noConstructorReturn: intentional mock — return object from constructor
    return mockWallet;
  }
}

vi.mock('@meshsdk/core', () => ({
  MeshWallet: MockMeshWallet,
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

// Dynamic import so mocks are in place first
const { getAdmin } = await import('./get-admin.js');
const { readFileSync } = await import('node:fs');

const mockedReadFileSync = vi.mocked(readFileSync);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    meshWalletCalls.length = 0;
    mockWallet.init.mockResolvedValue(undefined);
    mockWallet.addresses.enterpriseAddressBech32 = 'addr_test1qz...';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads key from HYDRA_ADMIN_KEY_FILE (top-level cborHex format)', async () => {
    vi.stubEnv('HYDRA_ADMIN_KEY_FILE', '/path/to/cardano.sk');
    mockedReadFileSync.mockReturnValue(JSON.stringify({ cborHex: '5820abcd' }));

    await getAdmin();

    expect(mockedReadFileSync).toHaveBeenCalledWith('/path/to/cardano.sk', 'utf-8');
    expect(meshWalletCalls[0]).toEqual(expect.objectContaining({ key: { type: 'cli', payment: '5820abcd' } }));
  });

  it('reads key from HYDRA_ADMIN_KEY_FILE (nested key.cborHex format)', async () => {
    vi.stubEnv('HYDRA_ADMIN_KEY_FILE', '/path/to/cardano.sk');
    mockedReadFileSync.mockReturnValue(JSON.stringify({ key: { cborHex: '5820ef01' } }));

    await getAdmin();

    expect(meshWalletCalls[0]).toEqual(expect.objectContaining({ key: { type: 'cli', payment: '5820ef01' } }));
  });

  it('falls back to HYDRA_ADMIN_CARDANO_PK when no key file is set', async () => {
    vi.stubEnv('HYDRA_ADMIN_CARDANO_PK', '5820fallback');

    await getAdmin();

    expect(mockedReadFileSync).not.toHaveBeenCalled();
    expect(meshWalletCalls[0]).toEqual(expect.objectContaining({ key: { type: 'cli', payment: '5820fallback' } }));
  });

  it('throws when neither env var is set', async () => {
    await expect(getAdmin()).rejects.toThrow('Cardano signing key not found');
  });

  it('defaults network ID to 0', async () => {
    vi.stubEnv('HYDRA_ADMIN_CARDANO_PK', '5820aabb');

    await getAdmin();

    expect(meshWalletCalls[0]).toEqual(expect.objectContaining({ networkId: 0 }));
  });

  it('clamps negative network ID to 0', async () => {
    vi.stubEnv('HYDRA_ADMIN_CARDANO_PK', '5820aabb');
    vi.stubEnv('HYDRA_NETWORK', '-5');

    await getAdmin();

    expect(meshWalletCalls[0]).toEqual(expect.objectContaining({ networkId: 0 }));
  });

  it('clamps network ID > 1 to 1', async () => {
    vi.stubEnv('HYDRA_ADMIN_CARDANO_PK', '5820aabb');
    vi.stubEnv('HYDRA_NETWORK', '99');

    await getAdmin();

    expect(meshWalletCalls[0]).toEqual(expect.objectContaining({ networkId: 1 }));
  });

  it('throws when wallet enterprise address is missing after init', async () => {
    vi.stubEnv('HYDRA_ADMIN_CARDANO_PK', '5820aabb');
    mockWallet.addresses.enterpriseAddressBech32 = '';

    await expect(getAdmin()).rejects.toThrow('Wallet failed to initialize!');
  });
});
