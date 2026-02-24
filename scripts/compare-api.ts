#!/usr/bin/env tsx
/**
 * Compare two API snapshot files and report changes.
 *
 * Usage: npx tsx scripts/compare-api.ts <baseline> <current>
 *
 * Reports added, removed, and changed exports. Always exits 0 (warn-only
 * during beta).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface MemberInfo {
  name: string;
  kind: string;
  signature: string;
}

interface ExportInfo {
  name: string;
  kind: string;
  signature: string;
  members?: MemberInfo[];
}

interface PackageSnapshot {
  version: string;
  exports: ExportInfo[];
}

interface Snapshot {
  schema: string;
  packages: Record<string, PackageSnapshot>;
}

interface Change {
  type: 'added' | 'removed' | 'changed';
  pkg: string;
  name: string;
  detail?: string;
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function compareSnapshots(baseline: Snapshot, current: Snapshot): Change[] {
  const changes: Change[] = [];

  const allPkgs = new Set([...Object.keys(baseline.packages), ...Object.keys(current.packages)]);

  for (const pkg of allPkgs) {
    const base = baseline.packages[pkg];
    const curr = current.packages[pkg];

    if (!base && curr) {
      for (const exp of curr.exports) {
        changes.push({ type: 'added', pkg, name: exp.name });
      }
      continue;
    }
    if (base && !curr) {
      for (const exp of base.exports) {
        changes.push({ type: 'removed', pkg, name: exp.name });
      }
      continue;
    }

    const baseMap = new Map(base.exports.map((e) => [e.name, e]));
    const currMap = new Map(curr.exports.map((e) => [e.name, e]));

    // Removed
    for (const [name] of baseMap) {
      if (!currMap.has(name)) {
        changes.push({ type: 'removed', pkg, name });
      }
    }

    // Added
    for (const [name] of currMap) {
      if (!baseMap.has(name)) {
        changes.push({ type: 'added', pkg, name });
      }
    }

    // Changed
    for (const [name, baseExport] of baseMap) {
      const currExport = currMap.get(name);
      if (!currExport) continue;

      if (baseExport.kind !== currExport.kind) {
        changes.push({
          type: 'changed',
          pkg,
          name,
          detail: `kind: ${baseExport.kind} → ${currExport.kind}`,
        });
      } else if (baseExport.signature !== currExport.signature) {
        changes.push({
          type: 'changed',
          pkg,
          name,
          detail: `signature: ${baseExport.signature} → ${currExport.signature}`,
        });
      } else if (JSON.stringify(baseExport.members) !== JSON.stringify(currExport.members)) {
        changes.push({
          type: 'changed',
          pkg,
          name,
          detail: 'class members changed',
        });
      }
    }
  }

  return changes;
}

// ── Main ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: compare-api.ts <baseline.json> <current.json>');
  process.exit(1);
}

const baseline = loadSnapshot(resolve(args[0]));
const current = loadSnapshot(resolve(args[1]));
const changes = compareSnapshots(baseline, current);

if (changes.length === 0) {
  console.log('No API surface changes detected.');
} else {
  const breaking = changes.filter((c) => c.type === 'removed' || c.type === 'changed');
  const safe = changes.filter((c) => c.type === 'added');

  if (safe.length > 0) {
    console.log(`\n  Added (${safe.length}):`);
    for (const c of safe) {
      console.log(`    + ${c.pkg} :: ${c.name}`);
    }
  }

  if (breaking.length > 0) {
    console.log(`\n  Breaking changes (${breaking.length}):`);
    for (const c of breaking) {
      const prefix = c.type === 'removed' ? '-' : '~';
      const detail = c.detail ? ` (${c.detail})` : '';
      console.log(`    ${prefix} ${c.pkg} :: ${c.name}${detail}`);
    }
    console.warn('\n  WARNING: Breaking API changes detected. Review before releasing.');
  }
}

// Always exit 0 during beta — warn only
process.exit(0);
