/**
 * Signature Validation Stuff
 */
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import {COSESign1} from "@emurgo/cardano-message-signing-nodejs";
import {Buffer} from "buffer";
import {default as cbor} from "cbor";
import {chunkString} from "./chunk-string.js";
import {bech32} from "bech32";

export const bufferToHex = (buffer: any) => Buffer.from(buffer).toString("hex");
export const bufferToAscii = (buffer: any) => Buffer.from(buffer).toString("ascii");

export function verifySignature(signature: string, message: string, signingAddress: string, signatureKey: string) {
    try {
        const coseSign1 = COSESign1.from_bytes(Buffer.from(signature, "hex"));
        const signatureBytes = coseSign1.signature();
        const [, , , payload1] = cbor.decode(bufferToHex(coseSign1.signed_data().to_bytes()));
        const signaturePayloadAscii = bufferToAscii(payload1);

        const {words} = bech32.decode(signingAddress);

        const addressBytes = Buffer.from(bech32.fromWords(words));
        const coseSigKey = cbor.decode(signatureKey);
        const cosePublicKey = coseSigKey.get(-2);
        const sigKey = CSL.PublicKey.from_bytes(cosePublicKey);
        const publicKeyHash = sigKey.hash();

        const address_matches = addressBytes.toString("hex").slice(2) === publicKeyHash.to_hex();
        const sig = CSL.Ed25519Signature.from_bytes(signatureBytes);
        const validates = sigKey.verify(coseSign1.signed_data().to_bytes(), sig);

        const message_matches = signaturePayloadAscii === message;
        const isValid = validates && message_matches && address_matches;
        const sigMeta = chunkString(sig.to_hex(), 64);
        if (!isValid) {
            console.log("Failed to validate signature!");
            console.log(isValid, validates, message_matches, address_matches);
        }
        return {isValid, sigMeta, pubKeyHex: sigKey.to_hex()};
    } catch (error: any) {
        console.error(`Error during signature validation:`, error);
        return {isValid: false, sigMeta: [], pubKeyHex: ''};
    }
}

/**
 * End Signature Validation Stuff
 */
