#!/usr/bin/env node
// Folds pending .changeset/*.md summaries into the root CHANGELOG.md's
// "## [Unreleased]" section, then leaves the changeset files in place for
// `changeset version` to consume (bump versions + delete them).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const changesetDir = '.changeset';
const changelogPath = 'CHANGELOG.md';

const files = readdirSync(changesetDir).filter((f) => f.endsWith('.md') && f !== 'README.md');

if (files.length === 0) {
  console.log('No pending changesets — CHANGELOG.md left untouched.');
  process.exit(0);
}

const entries = [];

for (const file of files) {
  const raw = readFileSync(join(changesetDir, file), 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) continue;

  const [, frontmatter, body] = match;
  const packages = [...frontmatter.matchAll(/"([^"]+)":\s*\S+/g)].map((m) => m[1]);
  const summary = body.trim().split('\n')[0];
  if (!summary) continue;

  entries.push({ packages, summary });
}

if (entries.length === 0) {
  console.log('No changeset content to fold into CHANGELOG.md.');
  process.exit(0);
}

const changelog = readFileSync(changelogPath, 'utf8');
const heading = '## [Unreleased]';
const idx = changelog.indexOf(heading);
if (idx === -1) {
  throw new Error(`Could not find "${heading}" in ${changelogPath}`);
}

const insertAt = idx + heading.length;
const bullets = entries.map(({ packages, summary }) => `- **${packages.join(', ')}**: ${summary}`).join('\n');

const updated = `${changelog.slice(0, insertAt)}\n\n${bullets}${changelog.slice(insertAt)}`;

writeFileSync(changelogPath, updated);
console.log(`Folded ${entries.length} changeset(s) into ${changelogPath}.`);
