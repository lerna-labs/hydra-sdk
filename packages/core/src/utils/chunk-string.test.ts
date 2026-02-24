import { describe, expect, it } from 'vitest';
import { chunkString } from './chunk-string.js';

describe('chunkString', () => {
  it('splits evenly', () => {
    expect(chunkString('aabbcc', 2)).toEqual(['aa', 'bb', 'cc']);
  });

  it('handles remainder', () => {
    expect(chunkString('abcde', 2)).toEqual(['ab', 'cd', 'e']);
  });

  it('returns single chunk when size >= length', () => {
    expect(chunkString('abc', 10)).toEqual(['abc']);
  });

  it('returns empty array for empty string', () => {
    expect(chunkString('', 5)).toEqual([]);
  });

  it('handles size-1 chunks', () => {
    expect(chunkString('abc', 1)).toEqual(['a', 'b', 'c']);
  });
});
