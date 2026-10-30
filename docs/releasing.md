# Releasing

Releases are cut from `main` by a signed tag. Automation never creates a git tag: a GitHub App cannot sign, so the maintainer creates and pushes the tag, and the workflow only verifies it and publishes from it.

1. Merge the Version Packages PR that Changesets opens against `main`. Merging it publishes nothing.
2. Tag the version commit on `main` with a signed annotated tag, one tag for each package the PR released, and push it. The tag name is the package name and its new version, and `<version-commit-sha>` is the merge commit of the Version Packages PR.

   For `@lerna-labs/hydra-sdk`:

   ```bash
   git fetch origin main
   git tag -s @lerna-labs/hydra-sdk@X.Y.Z -m "@lerna-labs/hydra-sdk@X.Y.Z" <version-commit-sha>
   git push origin @lerna-labs/hydra-sdk@X.Y.Z
   ```

   For `@lerna-labs/hydra-proof`:

   ```bash
   git fetch origin main
   git tag -s @lerna-labs/hydra-proof@X.Y.Z -m "@lerna-labs/hydra-proof@X.Y.Z" <version-commit-sha>
   git push origin @lerna-labs/hydra-proof@X.Y.Z
   ```

3. The tag push runs `.github/workflows/publish.yml`. Its `verify` job runs `.github/scripts/verify-release-tag.sh` and fails, so nothing publishes, unless all of these hold:
   - the ref is an annotated tag object, not a lightweight tag;
   - GitHub reports the tag's signature as verified;
   - the tagged commit is an ancestor of `main`;
   - the tag version equals the `version` in the tagged package's own `package.json`.
4. The `publish` job then builds, publishes only the package the tag names to npm through trusted publishing, and creates the GitHub Release with that package's `CHANGELOG.md` section as the notes. It skips publishing a version already on npm and skips creating a Release that already exists.
5. `backport-release.yml` runs on the same tag push and opens the backport pull requests into `staging` and `development`.

Pushes to `staging` still publish the `rc` snapshot, and pushes to `main` only open or update the Version Packages PR.

To check a tag locally before relying on the workflow, fetch `origin/main` and the tag, then run:

```bash
GITHUB_REPOSITORY=lerna-labs/hydra-sdk GH_TOKEN=$(gh auth token) .github/scripts/verify-release-tag.sh @lerna-labs/hydra-sdk@X.Y.Z
```
