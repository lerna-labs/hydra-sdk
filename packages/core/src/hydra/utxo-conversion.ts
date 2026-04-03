import type { Asset, UTxO } from '@meshsdk/common';
import { fromScriptRef, parseDatumCbor } from '@meshsdk/core-cst';
import type { HydraAssets, HydraReferenceScript, HydraUTxOEntry, HydraUTxOs } from './types.js';

// ── Asset Conversion ─────────────────────────────────────────────────

/** Convert MeshSDK `Asset[]` to Hydra's nested value format. */
export function toHydraAssets(assets: Asset[]): HydraAssets {
  return assets.reduce<HydraAssets>(
    (acc, asset) => {
      if (asset.unit === '' || asset.unit === 'lovelace') {
        (acc as { lovelace: number }).lovelace += Number(asset.quantity);
      } else {
        const policyId = asset.unit.slice(0, 56);
        const assetNameHex = asset.unit.slice(56) || '';
        if (!acc[policyId] || typeof acc[policyId] === 'number') {
          acc[policyId] = {};
        }
        const policy = acc[policyId] as { [assetNameHex: string]: number };
        policy[assetNameHex] = (policy[assetNameHex] ?? 0) + Number(asset.quantity);
      }
      return acc;
    },
    { lovelace: 0 } as HydraAssets,
  );
}

/** Convert Hydra's nested value format back to MeshSDK `Asset[]`. */
export function fromHydraAssets(assetsObj: HydraAssets): Asset[] {
  const result: Asset[] = [];
  if (assetsObj.lovelace && (assetsObj.lovelace as number) > 0) {
    result.push({ unit: 'lovelace', quantity: String(assetsObj.lovelace) });
  }
  for (const [policyId, assets] of Object.entries(assetsObj)) {
    if (policyId === 'lovelace') continue;
    if (typeof assets !== 'object') continue;
    for (const [assetNameHex, quantity] of Object.entries(assets)) {
      result.push({ unit: policyId + assetNameHex, quantity: String(quantity) });
    }
  }
  return result;
}

// ── Reference Script Conversion ──────────────────────────────────────

function resolveReferenceScript(scriptRef: string): HydraReferenceScript | null {
  if (!scriptRef) return null;

  const scriptInstance = fromScriptRef(scriptRef);
  if (!scriptInstance) return null;

  let scriptType = 'Unknown';
  let scriptLanguage: string | null = null;

  if ('code' in scriptInstance) {
    switch (scriptInstance.version) {
      case 'V1':
        scriptType = 'PlutusScriptV1';
        scriptLanguage = 'PlutusScriptLanguage PlutusScriptV1';
        break;
      case 'V2':
        scriptType = 'PlutusScriptV2';
        scriptLanguage = 'PlutusScriptLanguage PlutusScriptV2';
        break;
      case 'V3':
        scriptType = 'PlutusScriptV3';
        scriptLanguage = 'PlutusScriptLanguage PlutusScriptV3';
        break;
    }
  } else {
    scriptType = 'SimpleScript';
    scriptLanguage = 'NativeScriptLanguage SimpleScript';
  }

  if (!scriptLanguage || scriptType === 'Unknown') return null;

  return {
    script: {
      cborHex: scriptRef,
      description: '',
      type: scriptType,
    },
    scriptLanguage,
  };
}

// ── Datum Resolution ─────────────────────────────────────────────────

function resolvePlutusData(datumCbor: string): { inlineDatum: object | null } {
  const data = parseDatumCbor(datumCbor);

  function normalize(value: unknown): unknown {
    if (typeof value === 'bigint') {
      return value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER ? Number(value) : value.toString();
    }
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
    }
    return value;
  }

  return { inlineDatum: normalize(data) as object | null };
}

// ── UTxO Conversion ──────────────────────────────────────────────────

/** Convert a single MeshSDK UTxO to Hydra wire format. */
export function toHydraUTxO(utxo: UTxO): HydraUTxOEntry {
  return {
    address: utxo.output.address,
    datum: null,
    inlineDatum: utxo.output.plutusData ? resolvePlutusData(utxo.output.plutusData).inlineDatum : null,
    inlineDatumRaw: utxo.output.plutusData ?? null,
    inlineDatumhash: utxo.output.dataHash ?? null,
    referenceScript: utxo.output.scriptRef ? resolveReferenceScript(utxo.output.scriptRef) : null,
    value: toHydraAssets(utxo.output.amount),
  };
}

/** Convert multiple MeshSDK UTxOs to Hydra wire format (keyed by `"txHash#outputIndex"`). */
export function toHydraUTxOs(utxos: UTxO[]): HydraUTxOs {
  return Object.fromEntries(utxos.map((utxo) => [`${utxo.input.txHash}#${utxo.input.outputIndex}`, toHydraUTxO(utxo)]));
}
