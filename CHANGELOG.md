# Changelog

## [1.4.0] — 2026-10-12

### Added
- **Native MPV engine (optional).** BabyFlix can hand playback to a real **MPV process** instead of
  the embedded webview player: hardware decoding for every format without re-encoding, HDR tone
  mapping, frame-exact seeking and all audio/subtitle tracks exactly as the provider delivers them.
  Switch in **Settings → Playback → Playback engine**; the default stays *Webview (default)*.
- **MPV remote control.** MPV renders in its own window, the BabyFlix window becomes the remote:
  play/pause, ±10 s, draggable timeline with scrub preview and time tooltip, volume, mute,
  0.5×–2× speed, audio/subtitle track picker, *always on top*, fullscreen, the end-of-episode card
  with auto-next and the full keyboard shortcut set — mirroring the webview player.
- **MPV detection.** The backend reports the MPV binary it found (`/api/health`), and Settings shows
  the path or an install hint (`sudo apt install mpv` · `brew install mpv` · `winget install mpv`).
- If MPV fails to start, the overlay shows the reason and offers a one-click switch back to Webview.

### Changed
- Both engines now start from the same resolved stream URL (single `play_url` helper), so the
  transcode fallback and provider limits apply identically.

### Fixed
- The end-card countdown no longer updates state while rendering (React warning); the automation
  runs from its own timer and the episode switch happens in the tick.

## [1.3.0] — 2026-10-11

### Added
- **End-of-episode card with countdown.** When an episode ends, the player now shows a card with
  the next episode (poster, season/episode, series title), a **10-second countdown** and the
  actions *Play now*, *Stop automatic* and *Close*. For the last episode of a series it offers
  *Replay* instead. The countdown only starts when *Autoplay next episode* is enabled in
  Settings → Playback — otherwise the card simply waits for a click.
- **Rebuilt seek bar.** The timeline is a real slider: drag the handle anywhere (the target time is
  previewed while you scrub), hover for a time tooltip, and the track now shows the filled progress
  plus the buffered part behind it and two quick-jump markers (start / two-thirds). Double-clicking
  the left or right half of the video jumps −10 s / +10 s, with the amount flashed on screen.
- **Playback speed** selection (0.5× to 2×) in the track panel and a **keyboard shortcut overview**
  via `?` (or the keyboard button in the control bar).
- **More keyboard control:** `0`–`9` jump to a tenth of the episode, `Space`/`K` play-pause,
  `←`/`→` 10 s, `Shift`+`←`/`→` 30 s, `↑`/`↓` volume, `M` mute, `F` fullscreen, `Home`/`End`
  start/end, `Esc` close (card › panel › player).

### Fixed
- **Seeking can no longer land in a dead spot.** Every jump is clamped to the range the video
  actually reports as seekable, so seeking near the end no longer leaves the player stuck.
- **The progress bar no longer stays empty** when the remux backend reports no duration: the
  length is now also taken from the video element, so track, handle and tooltip keep working.
- The *Up next* banner hides while the track panel or the shortcut overview is open, and the seek
  bar uses a proper focus ring instead of the browser's default outline.

## [1.2.0] — 2026-10-11

### Added
- **Automatic next episode.** When an episode finishes, BabyFlix now starts the next one
  automatically — including across a season boundary. The player also shows an **Up next**
  banner in the last 20 seconds with *Play now* and *Skip*; the existing *Autoplay next episode*
  setting in Settings → Playback still controls the automatic behaviour.
- **Last watched episode is highlighted.** In a series, the episode list marks the episode you
  watched most recently (accented card, *Last watched* badge, progress bar per episode) and the
  series page opens on that episode's season. The main button becomes
  **Resume: S1 · E2** and continues that episode where you left off; the episode list header
  shows which episode that is.

### Fixed
- **Episodes now start playing on their own when they are chained automatically.** The player
  explicitly starts the source once metadata is ready, so an auto-advanced episode never sits
  there paused.
- **More reliable end-of-episode detection.** Some remuxed streams (FFmpeg HLS) never fire the
  video's `ended` event; playback stalling at the very end is now detected as well, which is what
  used to leave series stuck on the last frame.

## [1.1.0] — 2026-10-09

### Added
- **FFmpeg is provisioned automatically.** If no system FFmpeg is found, BabyFlix downloads a
  static **FFmpeg + FFprobe** for the current platform (Windows/Linux/macOS, x64 + Apple
  Silicon) on first start and stores it in the app data folder (`bin/`), then uses it for VOD
  remux. **macOS users no longer need Homebrew.** A system install (including
  Homebrew/MacPorts paths) is still preferred, and `BABYFLIX_FFMPEG` / `BABYFLIX_FFPROBE`
  override everything. The binaries are GPL FFmpeg, fetched directly from the upstream
  `ffmpeg-static` release at runtime (not redistributed by BabyFlix); the app only invokes it
  as a separate process. One-time download (~18–28 MB per binary), cached afterwards.
- When FFmpeg is not ready yet, playing a title now tells the user it is being set up and
  retries the download in the background instead of failing outright.

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
