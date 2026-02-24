#!/usr/bin/env tsx
/**
 * Extract the public API surface of each published package into a JSON snapshot.
 *
 * Usage: npx tsx scripts/extract-api.ts [--output api/snapshot.json]
 *
 * Reads compiled .d.ts files via the TypeScript Compiler API and writes a
 * structured manifest of every exported symbol to api/snapshot.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

interface MemberInfo {
  name: string;
  kind: string;
  signature: string;
}

interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'enum' | 'unknown';
  signature: string;
  members?: MemberInfo[];
}

interface PackageSnapshot {
  version: string;
  exports: ExportInfo[];
}

interface Snapshot {
  schema: 'lerna-labs/api-snapshot@v1';
  packages: Record<string, PackageSnapshot>;
}

const ROOT = resolve(import.meta.dirname, '..');

const PACKAGES: { name: string; entryDts: string; packageJson: string }[] = [
  {
    name: '@lerna-labs/hydra-sdk',
    entryDts: resolve(ROOT, 'packages/core/dist/index.d.ts'),
    packageJson: resolve(ROOT, 'packages/core/package.json'),
  },
  {
    name: '@lerna-labs/hydra-proof',
    entryDts: resolve(ROOT, 'packages/proof/dist/index.d.ts'),
    packageJson: resolve(ROOT, 'packages/proof/package.json'),
  },
];

function getSymbolKind(symbol: ts.Symbol, checker: ts.TypeChecker): ExportInfo['kind'] {
  const decl = symbol.declarations?.[0];
  if (!decl) return 'unknown';

  if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl)) return 'function';
  // Arrow functions assigned to const: VariableDeclaration with arrow function initializer
  if (ts.isVariableDeclaration(decl)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
    const callSigs = type.getCallSignatures();
    if (callSigs.length > 0) return 'function';
    return 'const';
  }
  if (ts.isClassDeclaration(decl)) return 'class';
  if (ts.isInterfaceDeclaration(decl)) return 'interface';
  if (ts.isTypeAliasDeclaration(decl)) return 'type';
  if (ts.isEnumDeclaration(decl)) return 'enum';

  return 'unknown';
}

function getSignature(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  const decl = symbol.declarations?.[0];
  if (!decl) return '';

  const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
  return checker.typeToString(
    type,
    decl,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature,
  );
}

function getClassMembers(symbol: ts.Symbol, checker: ts.TypeChecker): MemberInfo[] {
  const members: MemberInfo[] = [];
  const type = checker.getDeclaredTypeOfSymbol(symbol);

  for (const prop of type.getProperties()) {
    // Skip private/protected
    const decl = prop.declarations?.[0];
    if (!decl) continue;

    const modifiers = ts.canHaveModifiers(decl) ? ts.getModifiers(decl) : undefined;
    const isPrivate = modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    );
    if (isPrivate) continue;

    const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
    const callSigs = propType.getCallSignatures();
    const kind = callSigs.length > 0 ? 'method' : 'property';
    const signature = checker.typeToString(
      propType,
      decl,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature,
    );

    members.push({ name: prop.name, kind, signature });
  }

  // Sort for stability
  members.sort((a, b) => a.name.localeCompare(b.name));
  return members;
}

function extractPackage(entry: (typeof PACKAGES)[0]): PackageSnapshot {
  if (!existsSync(entry.entryDts)) {
    console.error(`Missing ${entry.entryDts} — run "npm run build" first`);
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(entry.packageJson, 'utf-8'));
  const program = ts.createProgram([entry.entryDts], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    declaration: true,
    skipLibCheck: true,
  });

  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entry.entryDts);
  if (!sourceFile) {
    console.error(`Could not load source file: ${entry.entryDts}`);
    process.exit(1);
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    console.error(`No module symbol for ${entry.entryDts}`);
    process.exit(1);
  }

  const exports = checker.getExportsOfModule(moduleSymbol);
  const result: ExportInfo[] = [];

  for (const sym of exports) {
    const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const kind = getSymbolKind(resolved, checker);
    const signature = getSignature(resolved, checker);

    const info: ExportInfo = { name: sym.name, kind, signature };

    if (kind === 'class') {
      info.members = getClassMembers(resolved, checker);
    }

    result.push(info);
  }

  // Sort for stable output
  result.sort((a, b) => a.name.localeCompare(b.name));

  return { version: pkg.version, exports: result };
}

// ── Main ──────────────────────────────────────────────────────────────

const outputArg = process.argv.indexOf('--output');
const outputPath = outputArg !== -1 ? resolve(process.argv[outputArg + 1]) : resolve(ROOT, 'api/snapshot.json');

const snapshot: Snapshot = {
  schema: 'lerna-labs/api-snapshot@v1',
  packages: {},
};

for (const pkg of PACKAGES) {
  console.log(`Extracting API: ${pkg.name}`);
  snapshot.packages[pkg.name] = extractPackage(pkg);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Snapshot written to ${outputPath}`);
