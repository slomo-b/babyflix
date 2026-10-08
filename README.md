# BabyFlix

A **Plex-like desktop streaming app** for movies, series and live TV, built on the
**Xtream Codes API** (your own IPTV access) with **automatic posters** and **real IMDb ratings**.
Runs as a native desktop app (**Tauri 2 + React + Rust**) on Windows, macOS and Linux.

> BabyFlix provides **no content**. You use your own authorized IPTV access.

---

## Features

- 🎬 **Movies / Series / Live TV** with categories, search and sorting
- 🖼️ **Automatic posters** — from your panel and (key-free) from IMDb
- ⭐ **Real IMDb ratings + vote counts** — completely **without an API key**
- ▶️ **HLS/TS player** (hls.js) with fullscreen, seeking, volume and keyboard shortcuts
- 📺 **Live TV** with channel logos and **EPG** (now / next)
- 📚 **Series** with seasons and episodes, autoplay of the next episode
- ⏱️ **Continue watching** (progress stored locally)
- 🌍 **German / English** UI with a language switch
- 🔄 **Automatic updates** from GitHub Releases (Tauri updater)
- 🔐 **Remembered sign-in** (only cleared when you remove the account)
- 🎨 Dark premium UI with hero banner, hover effects and skeletons

## How the key-free metadata enrichment works

1. **Posters** come primarily from the Xtream panel (`stream_icon`, `movie_image`, `cover`).
2. **Title → IMDb id** via the public IMDb suggestion API (no key, no WAF).
3. **IMDb rating + votes** from the official IMDb dataset `title.ratings.tsv.gz` — downloaded
   once and cached as a compact local index.
4. Plus IMDb poster and top cast from the suggestion API.

Everything is cached aggressively on disk. **No API key is required.**

---

## Requirement: FFmpeg (movies and series)

Live TV plays directly, but **movies and series are remuxed locally with FFmpeg** so that every
container/codec (MKV, HEVC, AC3/DTS …) plays in the webview and all audio tracks are selectable.

BabyFlix looks for `ffmpeg`/`ffprobe` in this order:

1. `BABYFLIX_FFMPEG` / `BABYFLIX_FFPROBE` (path to the binary **or** to its directory)
2. next to the app itself (bundled sidecar)
3. `PATH`
4. the usual install directories — on macOS `/opt/homebrew/bin` (Apple Silicon),
   `/usr/local/bin` (Intel), `/opt/local/bin`; on Windows `%LOCALAPPDATA%\Microsoft\WinGet\Links`,
   `C:\ffmpeg\bin`; on Linux `/usr/local/bin`, `/usr/bin`, `/snap/bin`

Install it once:

```bash
brew install ffmpeg                      # macOS (Homebrew) — restart the app afterwards
winget install Gyan.FFmpeg               # Windows
sudo apt install ffmpeg                  # Linux (Debian/Ubuntu)
```

> **macOS:** an app started from Finder does **not** inherit your shell `PATH`, so Homebrew's
> `/opt/homebrew/bin` is invisible to a plain `PATH` lookup. BabyFlix therefore checks the
> well-known install directories itself — no need to launch it from the terminal.

If FFmpeg is missing, the app now says so right in the player (and in **Settings →
Catalog**): movies/series cannot be played, live TV still can.

---

## Getting started (development)

```bash
npm install
npm run tauri dev
```

The first run compiles the Rust dependencies (takes a few minutes) and downloads the IMDb
dataset once (~9 MB).

### Dev launcher as an `.exe` (with hot reload) — `BabyFlix-Dev.exe`

For a double-click workflow there is a small native Windows `.exe` in the project folder that
starts the whole dev stack:

- **Vite dev server** → Hot Module Replacement (HMR) for the React frontend
- **`tauri dev`** → watches the Rust backend and rebuilds/restarts on change

Just double-click **`BabyFlix-Dev.exe`**. It locates the project folder itself (the folder the
`.exe` lives in), detects already-running instances and keeps output in `dev.out.log` /
`dev.err.log`.

Rebuild the launcher (if `launcher.rs` changes):

```powershell
rustc -O launcher.rs -o BabyFlix-Dev.exe
```

> Note: the dev build loads the app from the Vite dev server (that is what enables HMR). It is
> **not** usable as a standalone single file. For a standalone `.exe` without the dev server
> run `npm run tauri build` (release, no hot reload).

## Using the app

There are **two login modes** (switch at the top of the form):

**A) Xtream Codes** (JSON API)
1. Enter your Xtream panel **server URL** (e.g. `http://server.tv:8080`).
2. Enter **username** and **password** → *Sign in*.
3. The library loads; posters/IMDb ratings are enriched automatically.

**B) M3U playlist** (fallback)
1. Pick the **M3U playlist** tab.
2. Paste the **full playlist URL**, e.g.
   `http://server:8080/get.php?username=USER&password=PASS&type=m3u_plus&output=hls`.
3. *Sign in* → BabyFlix parses channels, movies and series from the playlist.
   `output=hls` yields playable streams (`.m3u8`); for `.ts` links BabyFlix tries the
   HLS variant automatically.

> Tip: the M3U route often works when the Xtream API is blocked by the provider.

Credentials are stored locally (app data folder) and reused on the next start. The sign-in is
remembered until you remove the account (Settings → Sign out).

### Player controls

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek 10 s back / forward |
| `↑` / `↓` | Volume |
| `F` | Fullscreen |
| `M` | Mute |
| `Esc` | Close player |

---

## Architecture

```
Tauri window (WebView2 / WKWebView / WebKitGTK)
 ├─ React + Vite + Tailwind (src/)          UI, router, player (hls.js)
 └─ Rust backend (src-tauri/src/)           runs as a local HTTP server on :4523
     ├─ xtream.rs   Xtream Codes client (login, catalog, details, EPG)
     ├─ m3u.rs      M3U playlist parser (fallback source)
     ├─ imdb.rs     key-free IMDb metadata (suggestion API)
     ├─ ratings.rs  IMDb ratings index from title.ratings.tsv.gz
     ├─ proxy.rs    stream / HLS / image proxy (Range, m3u8 rewrite)
     ├─ state.rs    session, catalog cache, enrichment cache
     └─ routes.rs   HTTP API (axum)
```

**Why a local server inside the Rust process?** No CORS/mixed-content issues, reliable HLS
playback, seeking via HTTP Range, and your credentials stay in the backend (never in the
frontend code). The server binds to `127.0.0.1` only.

### Local API endpoints
`/api/health` · `/api/login` · `/api/login_m3u` · `/api/logout` · `/api/session` ·
`/api/categories` · `/api/browse` · `/api/home` · `/api/detail` · `/api/epg` · `/api/enrich` ·
`/api/enrich_batch` · `/api/refresh` · `/api/diagnose` · `/api/player` · `/api/proxy` · `/api/img`

---

## Installers / builds

BabyFlix is prepared for **Windows, macOS and Linux**.
Important: a **macOS build is not possible from Windows** — it is produced on a Mac or via the
included **GitHub Actions CI** (`.github/workflows/release.yml`).

### Windows
```powershell
npm install
npm run tauri build
```
Output in `src-tauri/target/release/bundle/`:
- `nsis/BabyFlix_*_x64-setup.exe` (installer)
- `msi/BabyFlix_*_x64_en-US.msi` (MSI)

### macOS (on a Mac)
```bash
npm install
npm run tauri build                                    # .app + .dmg
npm run tauri build -- --target aarch64-apple-darwin   # Apple Silicon
npm run tauri build -- --target x86_64-apple-darwin    # Intel
```
Output under `src-tauri/target/**/release/bundle/macos/BabyFlix.app` and
`.../dmg/BabyFlix_*.dmg`. Requires `xcode-select --install` and Rust.

> Note: **automatic updates on macOS require code signing** (an Apple Developer certificate +
> notarization). Windows and Linux auto-update work without an OS code-signing certificate.

### Linux
```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
npm install && npm run tauri build
```

## CI / CD

- **`.github/workflows/ci.yml`** — on push/PR to `main`: frontend typecheck + build and
  `cargo check` on Linux (fast feedback).
- **`.github/workflows/release.yml`** — on a `v*` tag: builds **Windows, macOS (Intel + Apple
  Silicon) and Linux**, signs the updater artifacts and **publishes a GitHub Release**.

Cut a release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## Automatic updates

The app checks `https://github.com/slomo-b/babyflix/releases/latest/download/latest.json` on
startup (and via Settings → Updates) and offers to install new versions. Updates are signed with
a Tauri minisign key pair:

- **Public key** — in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`)
- **Private key + password** — stored as repository secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Generate a new key pair (if you ever need to):

```bash
npx tauri signer generate -w ~/.tauri/babyflix.key
```

---

## Notes

- **Toolchain:** this machine uses the Rust **GNU** toolchain. For a desktop-only build
  `crate-type = ["rlib"]` is set (the default `cdylib`/`staticlib` types exceed the Windows-GNU
  export limit → "export ordinal too large"). For mobile builds re-add `staticlib`/`cdylib` and
  use an MSVC toolchain.
- **Legal:** use only authorized access. IMDb data is intended for personal, non-commercial use.
  BabyFlix hosts and serves no content.
