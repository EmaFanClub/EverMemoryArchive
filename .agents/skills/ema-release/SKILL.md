---
name: ema-release
description: Use when preparing or validating an EverMemoryArchive release, including version preflight, release version updates, CHANGELOG.md generation, parse-changelog release notes, distribution artifact checksums, tag-release CI behavior, and draft/publish handoff. Trigger for requests like "prepare EMA release", "发版", "release v1.0.0-beta.2", "generate changelog", or "draft release notes".
---

# EMA Release

Use this workflow for EverMemoryArchive release preparation. Keep the work local until the maintainer explicitly approves external side effects such as pushing tags, publishing GitHub releases, or marking a draft PR ready.

## Workflow

1. Normalize the target version.
   - Accept `v1.0.0-beta.1` or `1.0.0-beta.1`.
   - Use the normalized version without `v` for source files.
   - Use the tag form with `v` for changelog, release notes, and git tag commands.

2. Inspect readiness before editing.

   ```bash
   node scripts/release-preflight.mjs <version> --json
   ```

   Report the target tag, release type, current branch, changelog status, pending version updates, and generated follow-up commands.

3. Apply local release preparation when asked.
   - Update version strings:

     ```bash
     node scripts/release-preflight.mjs <version> --write
     ```

   - Generate or refresh the root changelog:

     ```bash
     node scripts/generate-changelog.mjs <version> --write
     ```

   - Re-run preflight after edits and call out any remaining pending updates.

4. Validate locally.
   - Fast checks:

     ```bash
     pnpm format:check
     pnpm --filter ema-dist exec tsc --noEmit -p tsconfig.json
     node scripts/release-preflight.mjs <version> --json
     parse-changelog ./CHANGELOG.md
     ```

5. Generate release notes from changelog and artifacts.

   ```bash
   node scripts/draft-release.mjs <version> --artifacts dist/release --output dist/release-notes.md
   ```

   `draft-release` depends on external `parse-changelog`; install it before running locally if missing.

6. Build distribution artifacts only when feasible for the current platform.

   ```bash
   pnpm --filter ema-webui build
   pnpm --filter ema-dist run build -- --platform <platform-id>
   ```

   Use `pnpm --filter ema-dist run list-platforms` to list supported platform ids.

7. Stop before external release side effects.
   - Do not run `git tag`, `git push --tags`, `gh release create`, `gh release edit`, `gh release upload`, or equivalent publishing commands unless the maintainer explicitly approves that exact action.
   - When asking for approval, show the exact command and whether it will create/update a public GitHub release.

## Guardrails

- Keep root `package.json`, `packages/ema/package.json`, `packages/ema-webui/package.json`, `packages/ema-dist/Cargo.toml`, and `packages/ema-dist/Cargo.lock` release versions aligned through `release-preflight`.
- Keep root `CHANGELOG.md` in the format consumed by `parse-changelog`: `## vX.Y.Z - [YYYY-MM-DD]`, topic headings, bullet items, and a `**Full Changelog**` line.
- Use `gh api repos/<owner>/<repo>/releases/generate-notes` through `scripts/generate-changelog.mjs` for changelog candidates.
- Distribution archives and installers should have sibling `.sha256` files; the dist scripts create them automatically.
- Tag CI creates or updates GitHub releases from `dist.yml`; release notes are generated with `scripts/draft-release.mjs`.
- Treat `linux-armhf` and `alpine-x64` portable packages as unsupported unless `--include-unsupported-portable` is intentionally passed.
