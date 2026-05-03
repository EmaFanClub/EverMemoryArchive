# ema-dist

TypeScript distribution scripts for EverMemoryArchive.

## Commands

```bash
pnpm --filter ema-webui build
pnpm --filter ema-dist run revision
pnpm --filter ema-dist run download -- --platform linux-x64
pnpm --filter ema-dist run build -- --platform linux-x64
```

`download` writes portable runtime dependencies to:

```text
dist/$platform/EverMemoryArchive/portables
```

`build` writes CI-ready artifacts to `dist/$platform/`:

```text
ema-$platform-portable-$revision.7z
ema-$platform-portable-$revision.zip
ema-$platform-portable-$revision-installer.{bat,run,command}
ema-$platform-minimal-$revision.7z
ema-$platform-minimal-$revision.zip
ema-$platform-minimal-$revision-installer.{bat,run,command}
```

The platform ids are:

```text
win32-x64
win32-arm64
linux-x64
linux-arm64
linux-armhf
darwin-x64
darwin-arm64
alpine-x64
```

The revision is the nearest previous `v*` tag, or `v0.0.0` when no tag
exists. Untagged commits append the 12-character commit hash, and dirty
worktrees append `-dirty`.

## Portable vs minimal

`portable` bundles Node.js, MongoDB, and the 7-Zip command-line extractor under
`portables/` when upstream binaries exist for the platform.

`minimal` bundles only the built app and launch/configure scripts. It can use
Node.js and MongoDB from configured paths, from `PATH`, or via `EMA_MONGO_URI`.

Launchers open the WebUI in `EMA_OPEN_MODE=webview` by default. This uses an
app-mode browser window without the normal browser toolbar when Edge, Chrome,
Chromium, or Brave is available, and falls back to the system browser. During
installation the user is asked whether to set `EMA_OPEN_MODE=browser` instead.
`EMA_OPEN_MODE=none` starts only the server.

MongoDB Community Server does not publish `linux-armhf` or Alpine/musl archives.
For those platforms the CI produces minimal artifacts and a `.SKIPPED.txt` note
for portable artifacts unless `--include-unsupported-portable` is passed.
