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
 * @param address1 - Address (bech32) whose key hash is the required signer.
 * @param networkId - `0` for testnet, `1` for mainnet.
 * @param scriptType - `"any"` or `"all"` when combined with time-lock scripts.
 * @param invalidBefore - Optional slot number before which the script is invalid.
 * @param invalidHereafter - Optional slot number after which the script is invalid.
 * @returns The script address, serialized CBOR, and script hash.
 */
export function createNativeScript(
  address1: string,
  networkId: number = 0,
  scriptType: 'any' | 'all' = 'all',
  invalidBefore: number | null = null,
  invalidHereafter: number | null = null,
): {
  address: string;
  scriptCbor?: string;
  scriptHash?: string;
} {
  const keyHash = deserializeAddress(address1).pubKeyHash;

  const script: NativeScript = {
    type: scriptType,
    scripts: [
      {
        type: 'sig',
        keyHash,
      },
    ],
  };

  if (invalidBefore) {
    script.scripts.push({
      type: 'after',
      slot: invalidBefore.toString(),
    });
  }

  if (invalidHereafter) {
    script.scripts.push({
      type: 'before',
      slot: invalidHereafter.toString(),
    });
  }

  const { address, scriptCbor } = serializeNativeScript(script, undefined, networkId);
  const scriptHash = scriptCbor != null ? resolveScriptHash(scriptCbor) : undefined;

  return { address, scriptCbor, scriptHash };
}
