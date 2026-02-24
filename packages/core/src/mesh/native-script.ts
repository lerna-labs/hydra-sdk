import { deserializeAddress, type NativeScript, resolveScriptHash, serializeNativeScript } from '@meshsdk/core';

/**
 * Create a multisig address using 'any' policy (AND logic)
 * @param address1 The first address to include in the script (staking or payment)
 * @param address2 The second address to include in the script (staking or payment)
 * @param networkId 0 = testnet, 1 = mainnet
 * @param scriptType
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
 * Create a Native Script policy for minting tokens
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
