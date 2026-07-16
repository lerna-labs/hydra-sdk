# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — small markdown files
that describe a change for the next release. Run `npx changeset` to add one.

This repo keeps a single root `CHANGELOG.md` rather than per-package changelogs, so
`changelog` generation is disabled in `config.json`; entries are folded into `CHANGELOG.md` by
`scripts/changeset-changelog.mjs` as part of the release workflow (`.github/workflows/release.yml`).

Read the [intro to changesets](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
for full usage docs.
