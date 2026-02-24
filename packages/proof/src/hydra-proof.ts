#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { blake2b } from '@noble/hashes/blake2.js';
import { Command } from 'commander';
import { computePackage, type FileLeaf, type LeafMode, verifyInclusion } from './merkle';

// ============== hashing (streaming) ==============
async function blake2b256File(filePath: string): Promise<string> {
  const h = blake2b.create({ dkLen: 32 });
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(filePath);
    // @ts-expect-error
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve());
    s.on('error', (e) => reject(e));
  });
  const digest = h.digest();
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function blake2b256Hex(data: string | Uint8Array): string {
  const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const out = blake2b(u8, { dkLen: 32 });
  return Array.from(out)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============== FS walk & utils ==============
function relPathPosix(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join('/');
}

type WalkOpts = { ignore: string[]; includeHidden: boolean };

function shouldIgnore(fullPath: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  const p = fullPath.toLowerCase();
  return patterns.some((pat) => p.includes(pat.toLowerCase()));
}

async function* walkDir(rootDir: string, opts: WalkOpts): AsyncGenerator<string> {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const isHidden = e.name.startsWith('.');
      if (!opts.includeHidden && isHidden) continue;

      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (shouldIgnore(full, opts.ignore)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (shouldIgnore(full, opts.ignore)) continue;
        yield full;
      }
    }
  }
}

// Build a FileLeaf[] from a directory (stream hashes), optionally return proof package JSON text
async function buildLeavesAndMaybePackage(
  dirRoot: string,
  leafMode: LeafMode,
  opts: { ignore: string[]; includeHidden: boolean; emitProof?: string | false },
): Promise<{ rootHex: string; pkgJson?: string }> {
  const root = path.resolve(dirRoot);
  const items: { relPath: string; size: number; contentHashHex: string }[] = [];

  for await (const abs of walkDir(root, { ignore: opts.ignore, includeHidden: opts.includeHidden })) {
    const rel = relPathPosix(root, abs);
    const st = await fsp.stat(abs);
    const contentHashHex = await blake2b256File(abs);
    items.push({ relPath: rel, size: st.size, contentHashHex });
  }

  items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const leaves: FileLeaf[] = items.map((f) => ({
    name: f.relPath, // path bound ONLY if leafMode === 'content+path'
    size: f.size,
    contentHashHex: f.contentHashHex,
  }));

  const pkg = computePackage(leaves, leafMode);

  if (opts.emitProof) {
    const json = JSON.stringify(pkg, null, 2);
    await fsp.writeFile(opts.emitProof, json);
    return { rootHex: pkg.rootHex, pkgJson: json };
  }
  return { rootHex: pkg.rootHex };
}

// ============== build command ==============
async function buildProof(
  rootDir: string,
  outFile?: string,
  opts?: { ignore: string[]; includeHidden: boolean; leafMode?: LeafMode },
) {
  const root = path.resolve(rootDir);
  const ignore = opts?.ignore ?? [];
  const includeHidden = !!opts?.includeHidden;
  const leafMode: LeafMode = (opts?.leafMode ?? 'content') as LeafMode;

  const items: { relPath: string; size: number; contentHashHex: string }[] = [];
  for await (const abs of walkDir(root, { ignore, includeHidden })) {
    const rel = relPathPosix(root, abs);
    const st = await fsp.stat(abs);
    const contentHashHex = await blake2b256File(abs);
    items.push({ relPath: rel, size: st.size, contentHashHex });
  }

  items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const leaves: FileLeaf[] = items.map((f) => ({
    name: f.relPath,
    size: f.size,
    contentHashHex: f.contentHashHex,
  }));

  const pkg = computePackage(leaves, leafMode);

  const json = JSON.stringify(pkg, null, 2);
  if (outFile) {
    await fsp.writeFile(outFile, json);
    console.log(`Wrote proof package → ${outFile}`);
  } else {
    console.log(json);
  }
  console.log(`Merkle root: ${pkg.rootHex}`);
}

// ============== verify command ==============
async function verifyFile(pkgPath: string, filePath: string) {
  const txt = await fsp.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(txt);
  const basePath: string = pkg.basePath ?? process.cwd();

  const abs = path.resolve(filePath);
  const rel = relPathPosix(path.resolve(basePath), abs);

  const entry = pkg.files.find((f: any) => f.name === rel);
  if (!entry) {
    console.error(`File '${rel}' not found in proof package.`);
    process.exit(1);
  }

  const actualHash = await blake2b256File(abs);
  if (actualHash !== entry.contentHashHex) {
    console.error(`Content hash mismatch for '${rel}'.`);
    console.error(` expected: ${entry.contentHashHex}`);
    console.error(`   actual: ${actualHash}`);
    process.exit(2);
  }

  const mode: LeafMode = pkg.leafMode || 'content+path';
  const ok = verifyInclusion(
    { name: entry.name, contentHashHex: entry.contentHashHex },
    entry.merkleProof,
    pkg.rootHex,
    mode,
  );

  console.log(`Verify ${rel}: ${ok ? 'OK' : 'FAILED'}`);
  process.exit(ok ? 0 : 3);
}

// ============== metadata command ==============
// You can provide either precomputed roots OR directories to compute them now.
// If you give directories, you can also --emit-report-proof / --emit-state-proof to save packages.
type MetaArgs = {
  headId: string;
  snapshot: number;
  fanoutTx: string;
  label: number;
  publisher?: string;
  release?: string;
  version?: number;

  reportRoot?: string;
  reportDir?: string;
  reportLeafMode?: LeafMode;

  stateRoot?: string;
  stateDir?: string;
  stateLeafMode?: LeafMode;

  emitReportProof?: string | false;
  emitStateProof?: string | false;

  ignore: string[];
  includeHidden: boolean;
  out?: string;
};

async function metadataCommand(opts: MetaArgs) {
  // Resolve report root
  let reportRootHex = opts.reportRoot;
  let reportPkgHash: string | undefined;

  if (!reportRootHex && opts.reportDir) {
    const { rootHex, pkgJson } = await buildLeavesAndMaybePackage(opts.reportDir, opts.reportLeafMode ?? 'content', {
      ignore: opts.ignore,
      includeHidden: opts.includeHidden,
      emitProof: opts.emitReportProof || false,
    });
    reportRootHex = rootHex;
    if (pkgJson) reportPkgHash = blake2b256Hex(pkgJson);
  }

  // Resolve state root
  let stateRootHex = opts.stateRoot;
  let statePkgHash: string | undefined;

  if (!stateRootHex && opts.stateDir) {
    const { rootHex, pkgJson } = await buildLeavesAndMaybePackage(opts.stateDir, opts.stateLeafMode ?? 'content+path', {
      ignore: opts.ignore,
      includeHidden: opts.includeHidden,
      emitProof: opts.emitStateProof || false,
    });
    stateRootHex = rootHex;
    if (pkgJson) statePkgHash = blake2b256Hex(pkgJson);
  }

  if (!reportRootHex || !stateRootHex) {
    console.error('Missing roots: provide either --report-root/--state-root or --report-dir/--state-dir.');
    process.exit(4);
  }

  const label = opts.label ?? 199001;

  // Build your v1 metadata with explicit leafMode for each root
  const meta: any = {
    [label]: {
      type: 'hydra.events/anchor@v1',
      head: { id: opts.headId, snapshot: opts.snapshot, fanoutTx: opts.fanoutTx },
      roots: {
        report: {
          value: reportRootHex,
          alg: 'blake2b-256',
          leafMode: opts.reportLeafMode ?? 'content',
          tree: { leafPrefixHex: '00', nodePrefixHex: '01', pairSort: 'lexicographic' },
        },
        state: {
          value: stateRootHex,
          alg: 'blake2b-256',
          leafMode: opts.stateLeafMode ?? 'content+path',
          tree: { leafPrefixHex: '00', nodePrefixHex: '01', pairSort: 'lexicographic' },
        },
      },
      hint: {
        publisher: opts.publisher ?? 'Hydra Events',
        release: opts.release ?? '',
        version: opts.version ?? 1,
      },
    },
  };

  // Optional: hashes of the proof packages (off-chain artifacts)
  if (reportPkgHash || statePkgHash) {
    meta[label].pkg = {};
    if (reportPkgHash) meta[label].pkg.report = { hash: reportPkgHash, alg: 'blake2b-256' };
    if (statePkgHash) meta[label].pkg.state = { hash: statePkgHash, alg: 'blake2b-256' };
  }

  const json = JSON.stringify(meta, null, 2);
  if (opts.out) {
    await fsp.writeFile(opts.out, json);
    console.log(`Wrote metadata → ${opts.out}`);
  } else {
    console.log(json);
  }
}

// ============== commander CLI ==============
const program = new Command();

program
  .name('hydra-proof')
  .description(
    'Build & verify Merkle proofs for directory snapshots, and generate Cardano metadata anchors (Hydra.Events)',
  )
  .version('1.1.0');

program
  .command('build')
  .argument('<dir>', 'directory to snapshot (root)')
  .option('-o, --out <file>', 'output proof package JSON')
  .option('-i, --ignore <substr...>', 'ignore paths containing any of these substrings (case-insensitive)')
  .option('--include-hidden', 'include dotfiles/directories', false)
  .option('--leaf-mode <mode>', "leaf binding: 'content' or 'content+path' (default: content)")
  .action(async (dir, options) => {
    const leafMode: LeafMode = (options.leafMode ?? 'content') as LeafMode;
    await buildProof(dir, options.out, {
      ignore: options.ignore ?? [],
      includeHidden: options.includeHidden,
      leafMode,
    });
  });

program
  .command('verify')
  .argument('<proof.json>', 'proof package file')
  .argument('<file>', 'file path to verify (must be under the same base dir if basePath is set)')
  .action(async (pkg, file) => {
    await verifyFile(pkg, file);
  });

program
  .command('metadata')
  .description('Generate on-chain metadata JSON (v1) from roots or directories')
  // Head details
  .requiredOption('--head-id <id>', 'Hydra head id')
  .requiredOption('--snapshot <n>', 'Hydra head snapshot number', (v) => parseInt(v, 10))
  .requiredOption('--fanout-tx <txhash>', 'Fanout transaction hash')
  .option('--label <n>', 'Metadata label (default 199001)', (v) => parseInt(v, 10), 199001)
  .option('--publisher <name>', 'Publisher name (hint)')
  .option('--release <name>', 'Release name (hint)')
  .option('--version <n>', 'Metadata schema version (hint)', (v) => parseInt(v, 10), 1)
  // Report root inputs
  .option('--report-root <hex>', 'Precomputed report root hex')
  .option('--report-dir <dir>', 'Directory to compute report root from')
  .option(
    '--report-leaf-mode <mode>',
    "Leaf mode for report: 'content' or 'content+path' (default: content)",
    'content',
  )
  .option('--emit-report-proof <file>', 'If set with --report-dir, also write the report proof package JSON')
  // State root inputs
  .option('--state-root <hex>', 'Precomputed state root hex')
  .option('--state-dir <dir>', 'Directory to compute state root from')
  .option(
    '--state-leaf-mode <mode>',
    "Leaf mode for state: 'content' or 'content+path' (default: content+path)",
    'content+path',
  )
  .option('--emit-state-proof <file>', 'If set with --state-dir, also write the state proof package JSON')
  // Common options
  .option('-i, --ignore <substr...>', 'Ignore substrings (applies to dir scans)')
  .option('--include-hidden', 'Include dotfiles/directories in dir scans', false)
  .option('-o, --out <file>', 'Write metadata JSON to file (else print to stdout)')
  .action(async (options) => {
    await metadataCommand({
      headId: options.headId,
      snapshot: options.snapshot,
      fanoutTx: options.fanoutTx,
      label: options.label,
      publisher: options.publisher,
      release: options.release,
      version: options.version,

      reportRoot: options.reportRoot,
      reportDir: options.reportDir,
      reportLeafMode: options.reportLeafMode as LeafMode,
      emitReportProof: options.emitReportProof ?? false,

      stateRoot: options.stateRoot,
      stateDir: options.stateDir,
      stateLeafMode: options.stateLeafMode as LeafMode,
      emitStateProof: options.emitStateProof ?? false,

      ignore: options.ignore ?? [],
      includeHidden: options.includeHidden,
      out: options.out,
    });
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
