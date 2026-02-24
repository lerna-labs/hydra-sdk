import { describe, expect, it } from 'vitest';
import { bufferToAscii, bufferToHex, verifySignature } from './verify-signature.js';

describe('bufferToHex', () => {
  it('converts known bytes to hex', () => {
    expect(bufferToHex([0xde, 0xad, 0xbe, 0xef])).toBe('deadbeef');
  });

  it('converts empty buffer to empty string', () => {
    expect(bufferToHex([])).toBe('');
  });

  it('converts single byte', () => {
    expect(bufferToHex([0xff])).toBe('ff');
  });
});

describe('bufferToAscii', () => {
  it('converts known ASCII bytes', () => {
    expect(bufferToAscii([0x48, 0x69])).toBe('Hi');
  });

  it('converts empty buffer to empty string', () => {
    expect(bufferToAscii([])).toBe('');
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
