// Publish the changed public packages to npm with plain `npm publish`, which
// uses OIDC trusted publishing (npm >= 11.5.1 on PATH). `changeset publish`
// signs provenance but authenticates with a non-OIDC npm and gets E404, so we
// drive npm directly. Emits a "New tag:" line per publish so changesets/action
// creates the GitHub Release; the git tag is pushed here (a real release tag),
// which is what backport-release.yml triggers on.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packages = [
  { dir: 'packages/core', name: '@lerna-labs/hydra-sdk' },
  { dir: 'packages/proof', name: '@lerna-labs/hydra-proof' },
];

const onNpm = (name, version) => {
  try {
    execSync(`npm view ${name}@${version} version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

for (const { dir, name } of packages) {
  const { version } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  if (onNpm(name, version)) {
    console.log(`${name}@${version} already on npm; skipping`);
    continue;
  }
  execSync(`npm publish -w ${name} --access public`, { stdio: 'inherit' });
  const tag = `${name}@${version}`;
  if (!execSync(`git tag -l "${tag}"`, { encoding: 'utf8' }).trim()) {
    execSync(`git tag "${tag}"`, { stdio: 'inherit' });
    execSync(`git push origin "${tag}"`, { stdio: 'inherit' });
  }
  console.log(`New tag: ${tag}`);
}
