# Contributing to Hydra SDK

Thanks for your interest in contributing! This is a monorepo containing the Hydra SDK packages
and a reference example app.

## Workspace layout

See the [README's Project Structure section](./README.md#project-structure) for how the
monorepo's packages, examples, and supporting directories are laid out.

## Branching

Branch from `development` — it's the active branch and the target for all pull requests.
`main` is reserved for releases.

## Making a change

1. Create a branch off `development`.
2. Make your change.
3. Run the local checks:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```

4. Add a changelog entry:

   ```bash
   npx changeset
   ```

   This asks which package(s) your change affects and what kind of version bump it needs, then
   writes a small file under `.changeset/`. CI requires one on every pull request into
   `development`, unless the PR is labeled `skip-changelog` (for things like docs-only or CI-only
   changes that don't affect a published package). Your changeset's summary gets folded into the
   root [`CHANGELOG.md`](./CHANGELOG.md) when the next release PR is prepared.

5. Open a pull request against `development`.

## Filing issues

This repository's issues are tracked centrally in the
[ekklesia-docs](https://github.com/lerna-labs/ekklesia-docs) repository — please file bugs and
feature requests there rather than in this repo.
