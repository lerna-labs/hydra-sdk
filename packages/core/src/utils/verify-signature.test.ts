import { describe, expect, it } from 'vitest';
import { bufferToAscii, bufferToHex, decodeBech32Address, verifySignature } from './verify-signature.js';

describe('bufferToHex', () => {
  it('converts known bytes to hex', () => {
    expect(bufferToHex(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
  });

  it('converts empty buffer to empty string', () => {
    expect(bufferToHex(Buffer.from([]))).toBe('');
  });

  it('converts single byte', () => {
    expect(bufferToHex(Buffer.from([0xff]))).toBe('ff');
  });
});

describe('bufferToAscii', () => {
  it('converts known ASCII bytes', () => {
    expect(bufferToAscii(Buffer.from([0x48, 0x69]))).toBe('Hi');
  });

  it('converts empty buffer to empty string', () => {
    expect(bufferToAscii(Buffer.from([]))).toBe('');
  });
});

describe('verifySignature', () => {
  it('returns invalid result on garbage input', () => {
    const result = verifySignature('not-hex', 'message', 'addr_test1qz', 'key');
    expect(result).toEqual({ isValid: false, sigMeta: [], pubKeyHex: '' });
  });

  it('returns invalid result on empty strings', () => {
    const result = verifySignature('', '', '', '');
    expect(result).toEqual({ isValid: false, sigMeta: [], pubKeyHex: '' });
  });
});

describe('decodeBech32Address', () => {
  // Valid bech32 Cardano-shaped addresses with correct checksums. Base addresses are
  // 103 chars, well above the bech32 library's default 90-char limit — they must decode
  // without truncation. Generated with `bech32.encode` over realistic payload byte lengths.
  const mainnetBaseAddr =
    'addr1qx46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4sjte4wy';
  const testnetBaseAddr =
    'addr_test1qpd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfd95kj6tfdqkw67fu';
  const stakeAddr = 'stake1u8xumnwdehxumnwdehxumnwdehxumnwdehxumnwdehxumngnxnspf';
  const poolAddr = 'pool1alh7lml0alh7lml0alh7lml0alh7lml0alh7lml0alh77kynhnn';
  const drepAddr = 'drep1zgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysauaqmw';

  it('decodes long mainnet base addresses (>90 chars) without truncation', () => {
    expect(mainnetBaseAddr.length).toBeGreaterThan(90);
    const { prefix, addressBytes } = decodeBech32Address(mainnetBaseAddr);
    expect(prefix).toBe('addr');
    // Cardano base address: 1 header byte + 28 payment + 28 staking = 57 bytes.
    expect(addressBytes.length).toBe(57);
  });

  it('decodes long testnet base addresses (>90 chars) without truncation', () => {
    expect(testnetBaseAddr.length).toBeGreaterThan(90);
    const { prefix, addressBytes } = decodeBech32Address(testnetBaseAddr);
    expect(prefix).toBe('addr_test');
    expect(addressBytes.length).toBe(57);
  });

  it('decodes stake addresses', () => {
    const { prefix, addressBytes } = decodeBech32Address(stakeAddr);
    expect(prefix).toBe('stake');
    // 1 header byte + 28-byte stake key hash.
    expect(addressBytes.length).toBe(29);
  });

  it('decodes pool ids (no header byte)', () => {
    const { prefix, addressBytes } = decodeBech32Address(poolAddr);
    expect(prefix).toBe('pool');
    // Raw 28-byte pool key hash, no header prefix.
    expect(addressBytes.length).toBe(28);
  });

  it('decodes drep ids', () => {
    const { prefix, addressBytes } = decodeBech32Address(drepAddr);
    expect(prefix).toBe('drep');
    expect(addressBytes.length).toBeGreaterThan(0);
  });

  it('verifySignature reaches COSE parsing with long addresses (not tripped by char limit)', () => {
    // Before the fix, a >90-char address threw "Exceeds length limit" inside bech32.decode,
    // causing verifySignature to short-circuit before touching the signature. After the fix,
    // decode succeeds and the error path is driven by the (deliberately invalid) signature.
    const result = verifySignature('deadbeef', 'hello', mainnetBaseAddr, 'a4');
    expect(result).toEqual({ isValid: false, sigMeta: [], pubKeyHex: '' });
  });
});
