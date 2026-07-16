#!/usr/bin/env node
// Runs as the changesets/action "publish" step. Changesets already bumped
// package.json versions via `changeset version`; this creates and pushes the
// sdk-v*/proof-v* tags that .github/workflows/npm-publish.yml listens for,
// so the existing tag-driven publish flow stays the single place npm publish happens.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PACKAGES = [
  { dir: 'packages/core', prefix: 'sdk' },
  { dir: 'packages/proof', prefix: 'proof' },
];

function git(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

for (const { dir, prefix } of PACKAGES) {
  const { version } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  const tag = `${prefix}-v${version}`;

  if (git(['tag', '-l', tag])) {
    console.log(`${tag} already exists, skipping.`);
    continue;
  }

  git(['tag', '-a', tag, '-m', tag]);
  git(['push', 'origin', tag]);
  console.log(`Tagged and pushed ${tag}.`);
}
