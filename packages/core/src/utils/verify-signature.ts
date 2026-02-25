import { Buffer } from 'node:buffer';
import { COSESign1 } from '@emurgo/cardano-message-signing-nodejs';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { bech32 } from 'bech32';
import { default as cbor } from 'cbor';
import { chunkString } from './chunk-string.js';

/** Convert a buffer-like value to a hex string. */
export const bufferToHex = (buffer: Uint8Array | string) => Buffer.from(buffer).toString('hex');
/** Convert a buffer-like value to an ASCII string. */
export const bufferToAscii = (buffer: Uint8Array | string) => Buffer.from(buffer).toString('ascii');

/**
 * Verify a CIP-30 COSE_Sign1 signature against an expected message and address.
 *
 * @param signature - Hex-encoded COSE_Sign1 signature bytes.
 * @param message - The original plaintext message that was signed.
 * @param signingAddress - Bech32 address of the expected signer.
 * @param signatureKey - Hex-encoded COSE key containing the public key.
 * @returns Validation result with `isValid`, chunked signature metadata, and public key hex.
 */
export function verifySignature(signature: string, message: string, signingAddress: string, signatureKey: string) {
  try {
    const coseSign1 = COSESign1.from_bytes(Buffer.from(signature, 'hex'));
    const signatureBytes = coseSign1.signature();
    const [, , , payload1] = cbor.decode(bufferToHex(coseSign1.signed_data().to_bytes()));
    const signaturePayloadAscii = bufferToAscii(payload1);

    const { words } = bech32.decode(signingAddress);

    const addressBytes = Buffer.from(bech32.fromWords(words));
    const coseSigKey = cbor.decode(signatureKey);
    const cosePublicKey = coseSigKey.get(-2);
    const sigKey = CSL.PublicKey.from_bytes(cosePublicKey);
    const publicKeyHash = sigKey.hash();

    const address_matches = addressBytes.toString('hex').slice(2) === publicKeyHash.to_hex();
    const sig = CSL.Ed25519Signature.from_bytes(signatureBytes);
    const validates = sigKey.verify(coseSign1.signed_data().to_bytes(), sig);

    const message_matches = signaturePayloadAscii === message;
    const isValid = validates && message_matches && address_matches;
    const sigMeta = chunkString(sig.to_hex(), 64);
    if (!isValid) {
      console.log('Failed to validate signature!');
      console.log(isValid, validates, message_matches, address_matches);
    }
    return { isValid, sigMeta, pubKeyHex: sigKey.to_hex() };
  } catch (error: unknown) {
    console.error(`Error during signature validation:`, String(error));
    return { isValid: false, sigMeta: [], pubKeyHex: '' };
  }
}
