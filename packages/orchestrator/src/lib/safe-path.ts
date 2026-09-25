import { resolve, sep } from 'node:path';

/**
 * Strict allowlist for path-segment identifiers (network and instance names).
 * Lowercase letters, digits and hyphens only, must start with a letter, capped
 * at 64 characters. This rejects `/`, `\`, `.` (so `..` traversal is
 * impossible), null bytes, and anything else that isn't a plain identifier.
 */
const SAFE_IDENTIFIER_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Validate that `value` is safe to use as a filesystem path segment.
 * Throws if it contains anything outside the strict identifier allowlist.
 */
export function assertSafeIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER_RE.test(value)) {
    throw new Error(`Invalid ${label} "${value}": must match ${SAFE_IDENTIFIER_RE}`);
  }
  return value;
}

/**
 * Resolve `segments` under `baseDir` and verify the resolved path stays within
 * `baseDir`. This is a defense-in-depth check on top of `assertSafeIdentifier`:
 * even if a caller skipped identifier validation, a path that would escape the
 * base directory is rejected before any filesystem call sees it.
 */
export function safeJoin(baseDir: string, ...segments: string[]): string {
  const base = resolve(baseDir);
  const target = resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Resolved path "${target}" escapes base directory "${base}"`);
  }
  return target;
}
