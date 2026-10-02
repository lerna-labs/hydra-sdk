import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeIdentifier, safeJoin } from './safe-path.js';

describe('assertSafeIdentifier', () => {
  it('accepts plain lowercase identifiers', () => {
    expect(assertSafeIdentifier('preprod', 'network')).toBe('preprod');
    expect(assertSafeIdentifier('alpha', 'instance')).toBe('alpha');
    expect(assertSafeIdentifier('h1a2b3c-xyz', 'instance')).toBe('h1a2b3c-xyz');
  });

  it('rejects path traversal payloads', () => {
    expect(() => assertSafeIdentifier('../../etc/passwd', 'network')).toThrow(/Invalid network/);
    expect(() => assertSafeIdentifier('..', 'instance')).toThrow(/Invalid instance/);
    expect(() => assertSafeIdentifier('a/../../b', 'instance')).toThrow(/Invalid instance/);
  });

  it('rejects path separators and absolute paths', () => {
    expect(() => assertSafeIdentifier('foo/bar', 'network')).toThrow();
    expect(() => assertSafeIdentifier('/etc/passwd', 'network')).toThrow();
    expect(() => assertSafeIdentifier('foo\\bar', 'network')).toThrow();
  });

  it('rejects uppercase, empty, and non-identifier characters', () => {
    expect(() => assertSafeIdentifier('', 'instance')).toThrow();
    expect(() => assertSafeIdentifier('Preprod', 'network')).toThrow();
    expect(() => assertSafeIdentifier('pre prod', 'network')).toThrow();
    expect(() => assertSafeIdentifier('pre;prod', 'network')).toThrow();
    expect(() => assertSafeIdentifier('1alpha', 'instance')).toThrow();
  });
});

describe('safeJoin', () => {
  it('joins segments that stay within the base directory', () => {
    const base = '/srv/hydra-sdk';
    expect(safeJoin(base, 'data', 'preprod', 'instances', 'alpha')).toBe(
      join(base, 'data', 'preprod', 'instances', 'alpha'),
    );
  });

  it('rejects a traversal segment that escapes the base directory', () => {
    const base = '/srv/hydra-sdk';
    expect(() => safeJoin(base, '..', '..', 'etc', 'passwd')).toThrow(/escapes base directory/);
    expect(() => safeJoin(base, 'data', '..', '..', 'etc', 'passwd')).toThrow(/escapes base directory/);
  });

  it('rejects an absolute path segment that resolves outside the base directory', () => {
    const base = '/srv/hydra-sdk';
    expect(() => safeJoin(base, '/etc/passwd')).toThrow(/escapes base directory/);
  });

  it('allows the base directory itself', () => {
    const base = '/srv/hydra-sdk';
    expect(safeJoin(base)).toBe(base);
  });
});
