# ema-dist

TypeScript distribution scripts for EverMemoryArchive.

## Commands

```bash
pnpm --filter ema-webui build
pnpm --filter ema-dist run revision
pnpm --filter ema-dist run download -- --platform linux-x64
pnpm --filter ema-dist run pack -- --platform linux-x64 --kind portable --format zip
pnpm --filter ema-dist run build -- --platform linux-x64
```

`download` writes portable runtime dependencies to:

```text
dist/$platform/EverMemoryArchive/portables
```

Application runtime files are staged under:

```text
dist/$platform/EverMemoryArchive/app/server.js
dist/$platform/EverMemoryArchive/app/server.js.map
dist/$platform/EverMemoryArchive/app/assets/
```

`build` writes CI-ready artifacts to `dist/$platform/`:

```text
ema-$platform-minimal-$revision.7z
ema-$platform-minimal-$revision-installer.{bat,run,command}
ema-$platform-portable-$revision.7z
ema-$platform-portable-$revision-installer.{bat,run,command}
ema-$platform-portable-debug-symbols-$revision.7z
ema-$platform-minimal-$revision.zip
ema-$platform-portable-$revision.zip
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

Portable `.pdb` files are removed from portable archives and written to
`ema-$platform-portable-debug-symbols-$revision.7z` when present. The symbols
archive preserves the `EverMemoryArchive/...` relative paths so it can be
extracted over a matching portable package or added to a debugger symbol path.

Target-platform native runtime packages, such as LanceDB and Sharp binaries,
must be present before staging. Cross-platform builds fail during staging when
the matching optional native package is missing instead of producing an archive
that fails at runtime.

`minimal` bundles only the built app and launch/configure scripts. It can use
Node.js and MongoDB from configured paths, from `PATH`, or via `EMA_MONGO_URI`.

Launchers open the WebUI in `EMA_OPEN_MODE=webview` by default. This uses an
app-mode browser window without the normal browser toolbar when Edge, Chrome,
Chromium, or Brave is available, and falls back to the system browser. During
installation the user is asked whether to set `EMA_OPEN_MODE=browser` instead.
`EMA_OPEN_MODE=none` starts only the server.

Installer and `configure` answers are persisted in the normal user config
directory under `ema`: `${XDG_CONFIG_HOME:-$HOME/.config}/ema` on Linux,
`$HOME/Library/Application Support/ema` on macOS, and `%APPDATA%\ema` on
Windows. Set `EMA_CONFIG_HOME` to override this directory.

MongoDB Community Server does not publish `linux-armhf` or Alpine/musl archives.
For those platforms the CI produces minimal artifacts and a `.SKIPPED.txt` note
for portable artifacts unless `--include-unsupported-portable` is passed.
