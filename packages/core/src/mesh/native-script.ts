import { deserializeAddress, type NativeScript, resolveScriptHash, serializeNativeScript } from '@meshsdk/core';

/**
 * Create a multisig script address from two Cardano addresses.
 *
 * @param address1 - First address (bech32) to include in the native script.
 * @param address2 - Second address (bech32) to include in the native script.
 * @param networkId - `0` for testnet, `1` for mainnet.
 * @param scriptType - `"any"` requires one signature, `"all"` requires both.
 * @returns The script address, serialized CBOR, and script hash.
 */
export function createMultisigAddress(
  address1: string,
  address2: string,
  networkId: number = 0,
  scriptType: 'any' | 'all' = 'any',
): {
  address: string;
  scriptCbor?: string;
  scriptHash?: string;
} {
  const keyHash1 = deserializeAddress(address1).pubKeyHash;
  const keyHash2 = deserializeAddress(address2).pubKeyHash;

  const script: NativeScript = {
    type: scriptType,
    scripts: [
      {
        type: 'sig',
        keyHash: keyHash1,
      },
      {
        type: 'sig',
        keyHash: keyHash2,
      },
    ],
  };

  const { address, scriptCbor } = serializeNativeScript(script, undefined, networkId);
  const scriptHash = scriptCbor != null ? resolveScriptHash(scriptCbor) : undefined;

  return { address, scriptCbor, scriptHash };
}

/**
 * Create a native script policy for minting tokens.
 *
 * Without options, produces a bare `sig(keyHash)` script suitable for
 * in-head voter tokens that must remain burnable by the admin.
 *
 * When `invalidHereafter` is provided, produces a compound time-bound
 * script: `all: [sig(keyHash), before(slot)]` — each ballot gets its
 * own time-bound policy.
 *
 * @param address - Address (bech32) whose key hash is the required signer.
 * @param opts.invalidHereafter - Slot after which minting is no longer possible.
 * @param opts.networkId - `0` for testnet (default), `1` for mainnet.
 * @returns The script address, serialized CBOR, and script hash.
 */
export function createNativeScript(
  address: string,
  opts?: { invalidHereafter?: number; networkId?: number },
): {
  address: string;
  scriptCbor?: string;
  scriptHash?: string;
} {
  const networkId = opts?.networkId ?? 0;
  const keyHash = deserializeAddress(address).pubKeyHash;

  const sigScript: NativeScript = { type: 'sig', keyHash };

  const script: NativeScript =
    opts?.invalidHereafter != null
      ? {
          type: 'all',
          scripts: [sigScript, { type: 'before', slot: opts.invalidHereafter.toString() }],
        }
      : sigScript;

  const { address: scriptAddress, scriptCbor } = serializeNativeScript(script, undefined, networkId);
  const scriptHash = scriptCbor != null ? resolveScriptHash(scriptCbor) : undefined;

  return { address: scriptAddress, scriptCbor, scriptHash };
}
