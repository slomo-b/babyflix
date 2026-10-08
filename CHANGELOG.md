# Changelog

## [1.0.10] — 2026-10-09

### Fixed
- **macOS: nothing played at all** (endless spinner, then nothing) while Windows was fine. The app
  looked for FFmpeg/FFprobe with the Windows-only `where` command, so **no** binary was ever found
  on macOS/Linux and every movie/series failed to remux. Lookup now uses the
  `BABYFLIX_FFMPEG` / `BABYFLIX_FFPROBE` overrides, a binary next to the app, `PATH` **and the
  usual install locations** (`/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`), which also
  covers Apple-Silicon Homebrew when the app is started from Finder (minimal `PATH`).
- **macOS: plain-HTTP playback** – added App Transport Security + local-network exemptions
  (`src-tauri/Info.plist`) so the webview may reach the local proxy and the IPTV panel over HTTP.
  WebView2 on Windows never needed them, which is why only macOS was affected.
- **No endless spinner any more**: playback errors are bounded and shown – the player now displays
  the real reason plus a *Retry* button instead of spinning forever.

### Added
- **FFmpeg status in the app**: `/api/health` reports the resolved FFmpeg/FFprobe paths and
  Settings shows a warning banner with install instructions when FFmpeg is missing.

## [1.0.9] — 2026-10-06

### Fixed
- The player **track menu** now always shows audio tracks for movies and series: VOD is always
  remuxed, and the stream/audio info is returned from the same FFprobe pass (fewer server
  connections, important for lines with a single connection).

## [1.0.8] — 2026-10-06

### Fixed
- Remuxed streams now show the **correct total length** (from FFprobe) instead of the growing
  HLS length, so the seek bar and time display are right.

### Added
- When the interface language is **German**, remuxed titles automatically start with the
  **German audio track** if the file has one.

## [1.0.7] — 2026-10-06

### Added
- **FFmpeg remux**: movies/series in containers the browser cannot play (e.g. **MKV**) are
  automatically remuxed to HLS on the fly, so they play in-app (with seeking). FFmpeg is
  auto-detected on the system.
- **Audio track selection** for remuxed streams (via FFmpeg).

### Fixed
- Many titles (especially MKV) that previously showed a black screen with no tracks now play.

## [1.0.6] — 2026-10-06

### Added
- **Watchlist**: a new sidebar tab listing everything you saved via “Add to watchlist”.
- **Category search**: filter the category list for movies/series, plus a searchable live-TV
  category picker.
- **Player track selection**: choose **audio**, **subtitle** and **video quality** tracks (HLS)
  and embedded subtitles for native playback — useful when a file has multiple tracks.

### Changed
- Watchlist entries now store title/poster, so the list renders instantly.

## [1.0.5] — 2026-10-06

### Changed
- **Redesigned the detail view** for movies and series: larger hero backdrop, a big poster card,
  a highlighted IMDb rating badge, genre pills, an overview section, director/cast chips and a
  nicer episode list with a season picker.

## [1.0.4] — 2026-10-05

### Fixed
- Detail header/backdrop is no longer empty: if there is no (or a broken) backdrop image, the
  poster is shown as a blurred background instead.

## [1.0.3] — 2026-10-05

### Changed
- The **server URL must now be entered with the full protocol** (`http://` or `https://`);
  BabyFlix no longer adds it automatically.

### Fixed
- Long titles on the detail page now wrap instead of being clipped.
- Zero/unknown durations are no longer shown as `0`.

## [1.0.2] — 2026-10-05

### Added
- **Update button in the top bar** (next to the library reload) that appears automatically
  when a new version is available and installs it with one click.

### Changed
- The update check now also runs periodically (every 6 hours).

## [1.0.1] — 2026-10-05

### Changed
- **Login screen:** replaced the diagnostics button with a **DE/EN language switch** that works
  before signing in.
- Moved the **connection diagnosis** into **Settings**.

## [1.0.0] — 2026-10-05

Initial release.

### Features
- **Xtream Codes** login (server URL + username + password) with automatic
  HTTP/HTTPS fallback, multiple user agents and a built-in connection diagnosis.
- **M3U playlist** login as a fallback for providers that block the Xtream API.
- **Movies, series and live TV** with categories, sorting and full-text search.
- **Automatic posters** (from the panel and from IMDb) and **key-free IMDb ratings**.
- **HLS player** with fullscreen, seeking, volume and keyboard shortcuts.
- **EPG** (now / next) for live channels.
- **Continue watching** (local watch progress).
- **German / English** interface with a language switch.
- Remembered login (cleared only when the account is removed).
- Windows installer (**NSIS `.exe`** and **MSI**); macOS and Linux via CI.
- **Automatic updates** from GitHub Releases (Tauri updater).

### Legal
BabyFlix provides no content. It is a player for your own authorized IPTV access.
IMDb data is used for personal, non-commercial purposes only.
