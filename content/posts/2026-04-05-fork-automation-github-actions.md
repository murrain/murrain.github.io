+++
title = "One Workflow File, Six Jobs, Zero Manual Steps"
date = 2026-04-05T00:00:00-08:00
draft = false
tags = ["github-actions", "ci", "linux", "electron", "forks"]
author = "Patrick Smith"
original_date = "2026-04-05"
source_repo = "awakened-poe-trade"
+++

Maintaining a fork is a CI problem. The interesting part isn't the patches, it's the automation that keeps them applied.

I maintain a fork of `awakened-poe-trade`, a Path of Exile trading overlay, with fixes for several Linux-specific bugs: overlay stealing mouse focus, price-check broken on X11/KDE, stale clipboard data triggering false lookups. The patches live on a `linux-v2` branch. Upstream releases irregularly. One workflow file, `linux-appimage.yml`, handles the entire pipeline: check upstream for changes, merge patches onto the new base, compute a version number, rewrite metadata, build an AppImage, publish a release.

The workflow runs on a 6-hour cron. A hotfix could sit for up to 6 hours before the fork picks it up. For a hobby project with a small user base, that's fine. A concurrency group with `cancel-in-progress: false` ensures queued runs complete rather than getting cancelled. A cancelled sync mid-push could leave master in an inconsistent state.

## Detecting upstream changes

The sync job fetches upstream and checks whether its HEAD is already an ancestor of local master:

```bash
git fetch upstream
UPSTREAM_SHA=$(git rev-parse upstream/master)
if git merge-base --is-ancestor "$UPSTREAM_SHA" origin/master; then
  echo "already_synced=true" >> $GITHUB_OUTPUT
else
  git push origin upstream/master:master
  echo "already_synced=false" >> $GITHUB_OUTPUT
fi
```

If `already_synced=true`, the rest of the pipeline is skipped. Otherwise the push updates local master and the build runs.

A `workflow_dispatch` trigger and a push to `linux-v2` both skip the sync and go straight to build. Patching your own branch shouldn't wait 6 hours. Manual dispatch sets `should_build=true` unconditionally, so it can produce a redundant build. The publish step handles that: if the tag already exists, `gh release upload --clobber` overwrites the artifact rather than creating a duplicate release.

## The ephemeral build branch

The build never touches `linux-v2` or `master` directly. It creates a throwaway `build-linux` branch, merges the patches on, tears it down:

```bash
git checkout -B build-linux origin/master
git merge --no-commit --no-ff origin/linux-v2 || true
```

The `|| true` looks like defensive slop. It isn't. `git merge` exits nonzero on conflicts, but the workflow handles conflicts explicitly a few lines later: it checks `git diff --name-only --diff-filter=U` for unresolved files and fails with a named list if any remain. Swallowing the merge exit code lets the conflict detector handle it, which produces better diagnostics than a bare merge failure.

The `--no-commit` flag is load-bearing. After the merge, four files get force-reset to their upstream state:

```bash
git checkout origin/master -- .github/workflows/linux-appimage.yml
git checkout origin/master -- main/package.json
git checkout origin/master -- main/package-lock.json
git checkout origin/master -- main/src/AppUpdater.ts
```

These are upstream-owned files. `package.json` and `package-lock.json` get patched in the next step, not inherited from the merge. `AppUpdater.ts` gets a one-line injection. The workflow file overrides itself with the upstream copy, so the version that ran this step is the same version that runs next time.

Then the patched state gets committed and pushed:

```bash
git commit -m "build: merge linux-v2 patches onto master (build only)"
git push origin build-linux --force
```

`build-linux` exists only to give `electron-builder` a clean commit to tag against.

## Version numbering

The fork needs versions that communicate two things: which upstream release this is based on, and which fork build it is. So the scheme appends a zero-padded 3-digit suffix to the upstream version: `major.minor.patch###`.

```
Upstream: 3.28.102
Fork:     3.28.102001  ← first build from this upstream version
          3.28.102002  ← second build (linux-v2 patch, same upstream)
```

The suffix logic queries the GitHub API for the latest `-linux` release tag (via `gh release list --limit 100`), parses the version, and decides whether to increment or reset:

```javascript
const latestMatch = latestTag.match(/^v?(\d+)\.(\d+)\.(\d+)-linux$/)
if (latestMatch) {
  const [, latestMajor, latestMinor, latestPatch] = latestMatch
  if (
    latestMajor === major &&
    latestMinor === minor &&
    latestPatch.length > 3 &&
    latestPatch.slice(0, -3) === patch
  ) {
    suffix = Number(latestPatch.slice(-3)) + 1
  }
}
```

`latestPatch.length > 3` is what detects whether the previous release was a fork build (has a suffix) or an upstream-only version. If the major/minor/base-patch all match, the suffix increments. Otherwise it resets to `001`.

One edge case: `gh release list --limit 100` means if the repo accumulates more than 100 releases, the version computation silently falls back to suffix `001` instead of incrementing. For a fork with a handful of users this is academic. For a production system it would need pagination or a tag-based lookup.

The computed version then gets written into the package:

```bash
npm version "$FORK_VERSION" --no-git-tag-version --allow-same-version
npm pkg set repository.url="https://github.com/murrain/awakened-poe-trade.git"
npm pkg set dependencies.electron-overlay-window="github:murrain/electron-overlay-window"
```

The last line points at a separate fork of `electron-overlay-window`. The upstream version doesn't support the Linux overlay fixes.

## Redirecting the auto-updater

`electron-updater` is baked into the app. By default it checks `SnosMe/awakened-poe-trade` for updates. Users of the fork would get told to update to the upstream build, which doesn't have their Linux fixes. The injection into `AppUpdater.ts` redirects it:

```javascript
const fs = require('fs')
const path = 'src/AppUpdater.ts'
const marker = "autoUpdater.setFeedURL({ provider: 'github', owner: 'murrain', repo: 'awakened-poe-trade' })"
let text = fs.readFileSync(path, 'utf8')
if (!text.includes(marker)) {
  text = text.replace(
    '// https://www.electron.build',
    `    ${marker}\n    // https://www.electron.build`,
  )
  fs.writeFileSync(path, text)
}
```

The `text.includes(marker)` guard makes this idempotent. The injection runs as an inline Node.js script inside the version computation step, since it's already in a Node context.

## Build and publish

The renderer build uses `npm ci --legacy-peer-deps`. Locally this isn't needed, but the GitHub Actions runner is stricter about peer dependency resolution, and upstream's dependency tree has historically triggered `ERESOLVE` failures in CI that don't reproduce on a dev machine. The flag keeps the build from breaking on upstream dependency churn that has nothing to do with the fork's patches.

The build produces a `.AppImage` and a `latest-linux.yml` manifest, the hash/version file `electron-updater` uses to check for new releases. The release step checks whether a tag already exists:

```bash
if gh release view "$TAG" &>/dev/null; then
  gh release upload "$TAG" *.AppImage latest-linux.yml --clobber
else
  gh release create "$TAG" *.AppImage latest-linux.yml \
    --title "Awakened PoE Trade v${FORK_VERSION} (Linux)" \
    --notes "$RELEASE_NOTES"
fi
```

Release notes combine a static `.github/LINUX_RELEASE_NOTES.md` with the upstream release notes fetched live from the GitHub API, so the published release shows both the Linux-specific fixes and what changed upstream.

## What it doesn't handle well

The workflow has two build jobs: `build-from-sync` (triggered by cron/dispatch after upstream sync) and `build-from-push` (triggered by a push to `linux-v2`). They share the same merge logic, version computation, metadata patching, build steps, and publish steps. That's roughly 200 lines of copy-paste. The right fix is a reusable composite action or a called workflow. I haven't done it because the duplication hasn't caused a bug yet. Both jobs change in lockstep because I'm the only contributor. But if upstream changes the build procedure, I have to update two places and remember both.

---

*Source: [`.github/workflows/linux-appimage.yml`](https://github.com/murrain/awakened-poe-trade/blob/linux-v2/.github/workflows/linux-appimage.yml)*
