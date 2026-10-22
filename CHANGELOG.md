# Changelog

## [1.5.14] — 2026-10-22

### Fixed
- **Live channels with Dolby sound (AC-3/E-AC-3) never started.** hls.js cannot demux E-AC-3 out of
  MPEG-TS and reports exactly that: `Unsupported EC-3 in M2TS`. Those errors are *not* fatal, so the
  player kept loading instead of trying another path — SRF 1 HD (E-AC-3) hung on the spinner while
  Hajduk TV (AAC) played. Such channels now go to FFmpeg, which copies the video and converts the
  audio to AAC. The live remux no longer copies AC-3/E-AC-3 at all, because its playlist is read by
  hls.js again.
- **Live playback stopped and jumped a few seconds back.** Two retry paths caused it: a fatal media
  error called `recoverMediaError()`, which flushes the buffer and restarts at the start of the
  current fragment (up to ~10 s back); and a network error reloaded from scratch, which falls back to
  the live sync point. Live media errors now switch to the FFmpeg path, network retries resume at the
  current position, and low-latency mode is off (these panels are plain HLS with ~10 s segments).
- **German could not be selected in the language menu above the home recommendations.** The list was
  built from the first 20,000 catalogue entries, and DE only appears later (14,235 titles). The whole
  catalogue is scanned now, which costs a few milliseconds.

## [1.5.13] — 2026-10-22

### Fixed
- **Live channels started from the home page or from search played no video.** Live catalog entries
  carry `extension: "ts"`, and opening a channel from a card passed that value on — so the backend
  resolved the channel as a `.ts` URL and handed **raw MPEG-TS** to hls.js, which cannot build a
  playlist from it. The Live tab worked because it passes no extension, which is why the failure
  looked intermittent.

  Measured on the affected panel (Hajduk TV):

  | request | response |
  |---|---|
  | without `ext` | `200` · `application/vnd.apple.mpegurl` · 1.2 KB (playable) |
  | `ext=ts` | `200` · `video/mp2t` · 15 MB (hls.js fails) |

  For live, the `ext` parameter is now ignored and the panel's preferred format is used (HLS); the
  frontend no longer sends an extension for live channels either.

  Side effect of the old behaviour: the open TS stream occupied the panel's single connection
  (`max_connections: 1`) and blocked further requests — one stuck channel could take the app down
  with it.

## [1.5.12] — 2026-10-22

### Added
- **A language picker for the recommendations banner.** Panels list the same title several times with
  a language prefix ("DE - …", "EN - …", "AT| …"), so the banner mixed them. A small selector in the
  top-right corner restricts it to one language and remembers the choice. The available prefixes are
  read from the panel's catalog (sampled), and the filtering happens server-side so the banner always
  has six films — an empty selection falls back to the unfiltered pool. The "Top rated" row stays
  mixed on purpose.

### Fixed
- **"End of series" appeared at the end of an episode that was not the last one.** Starting an episode
  from "Continue watching" on the home page dropped the series id, so the player could not resolve the
  next episode: no up-next banner, no random episode, and an end card claiming the series had ended
  (observed at South Park S25E2 although the panel delivers up to S28). The series id is passed along
  now, and when it is missing the series is looked up by exact title in the catalog, so older history
  entries work too. The chain crosses season boundaries (S25E6 → S26E1), and "End of series" appears
  only at the real end — where a random episode is the remaining choice.

## [1.5.11] — 2026-10-22

### Fixed
- **Live TV works again — and this time the cause is proven.** Panels answer a channel URL with a
  `302` to a CDN, and the delivered HLS playlist addresses its segments with root-relative paths
  (`/hls/<hash>/…`). The streaming proxy resolved those against the **originally requested** URL
  (the panel host) instead of the redirect target, so **every** segment request was answered with
  `403` and live playback failed for every channel.

  Measured on the affected panel (SRF 1 HD):

  | Segment requested from | Response |
  |---|---|
  | panel host | `403` · `text/html` · 0 bytes |
  | CDN host (redirect target) | `200` · `video/mp2t` · 9.6 MB |

  The proxy now resolves playlists against the response's effective URL, with a regression test
  covering root-relative and relative paths.

  This also explains why films and series kept working: FFmpeg follows redirects itself and never
  uses the playlist rewriter. The three hang scenarios fixed in 1.5.9 were real, but not this bug.
  The panel's one-connection limit (`max_connections: 1`) was ruled out: parallel segment fetches
  work fine.

## [1.5.10] — 2026-10-22

### Added
- **"Likes" directly under Home.** The watchlist moved up in the sidebar and is called "Likes" now —
  in the navigation, on the page, in its empty state and on the two detail buttons
  ("Like" / "Liked"). Internal names (route `/watchlist`, store field `favorites`) stay as they
  are; renaming them would touch routing and persisted data for no user-visible gain.
- **The "random episode" option is available wherever the next episode is offered.** It used to
  exist only on the end card; the "Up next" banner shown during the last 20 seconds has it too.

### Fixed
- **The next-episode chain no longer stops after "Play now".** That jump carried neither the series
  id nor the following episode, so the next episode had no up-next banner and no autoplay — and the
  end card claimed the series had ended. The player now resolves the next episode from the series
  when the request does not contain it, and passes the series id along.
- **Subtitle tracks are ordered German, then English**, following the UI language, and are labelled
  with the language name instead of the raw code ("Deutsch" instead of "ger").

## [1.5.9] — 2026-10-22

### Added
- **"Random episode" on the end card.** When an episode ends and BabyFlix offers the next one, there
  is now a third option: play a random other episode of the same series — across all seasons, and
  never the episode that just finished. The normal next-episode chain stays intact, so autoplay
  continues from the randomly picked episode onwards.

### Fixed
- **Live TV that hung instead of failing.** Three concrete causes:
  - The `ffprobe` that precedes the FFmpeg live remux had **no timeout**; a stalling channel could
    block it indefinitely and the player spun forever. It now runs with a 2 MB / 2 s probe window and
    a hard 6 s timeout (20 s for VOD) and is killed when it exceeds it — the conservative copy policy
    applies instead.
  - The streaming proxy **rewrote error responses into playlists**: an HTML 403/404 answering a
    `.m3u8` request came back as a "valid" playlist with status 200, so hls.js parsed garbage and the
    fallback logic could not react. Only successful responses are rewritten now; errors keep their
    status and body.
  - When FFmpeg died while preparing a stream, the segment route kept polling for 30 s for a file
    that would never appear. It now notices the ended process and reports its exit status
    immediately.

## [1.5.8] — 2026-10-20

### Added
- **Search results as a full grid.** Movies and series are no longer shown in a horizontal carousel
  where only a handful were visible and you had to page through with arrows: they are now a
  responsive grid with 60 hits per page, the total count in the header and a "Show more" button.
  Stations stay a carousel — they are channels, not posters.

### Fixed
- **A series or film page opens even when the provider sends no detail data.** If the panel answers
  `get_series_info` / `get_vod_info` with a web page instead of JSON (broken id, blocked
  user-agent, rate limit, expired session), the page used to end in a red error box although the
  title is in the catalog and playable. The route now falls back to the catalog entry and marks the
  response as incomplete; the detail page shows a hint that description and episodes are missing,
  and playback still works.
- **Non-JSON responses are now diagnosable.** The error reports the HTTP status, the content type
  and a 120-character excerpt of the body; before, it only said "not readable". On a parse failure
  the request is retried once with the known alternative user-agents (VLC, IPTV Smarters), because
  many panels block the browser one.

### Changed
- **The release workflow builds macOS first.** The matrix is limited to two parallel jobs, so both
  macOS targets finish before Linux and Windows start.

## [1.5.7] — 2026-10-17

### Fixed
- **Jumping to any position in a film now actually goes there.** Seeking was limited to the part
  FFmpeg had already remuxed, and the jump was silently clamped to the end of that range — asking
  for 2:00:00 could land at 26:00. When the target lies outside the prepared range, the remux is
  now restarted at that position (FFmpeg `-ss`, input seek) and playback continues from there.
  Everything that deals with time — display, timeline, buffer bar, progress saving, the end guard
  and the keyboard jumps — accounts for the offset, and the total length still comes from the
  backend rather than from the remaining part. Resuming from the history now starts the session at
  that position as well. While dragging, no restart happens (it would spawn one FFmpeg run per
  step); the restart happens on release. `clampToSeekable` is gone — it bent the jump instead of
  enabling it.

## [1.5.6] — 2026-10-17

### Changed
- **Dragging the timeline now seeks while you drag.** Previously only the preview moved and the
  player jumped when you let go, which made scrubbing feel sticky. The picture now follows the
  pointer, throttled to one seek every 200 ms — every seek costs a new HLS segment in the remux,
  so unthrottled scrubbing would stall playback. Releasing still seeks to the exact position.

### Removed
- **The two jump markers inside the progress bar** (start and two thirds). The latter was labelled
  "Skip ahead (two thirds)" — a fixed position that fits almost no film. `seekTo` and the
  `player.jumpIntro` / `player.jumpOutro` strings are gone with it.

## [1.5.5] — 2026-10-16

### Changed
- **The banner at the top of the home page now features a different set of films on every load.**
  It used to be the first six of the "Top rated" row — the same films every time. The row is now
  shuffled and a different handful is picked. The 9-second rotation between the featured films
  already existed; it just cycled through an unchanged selection.

### Fixed
- **A release year is no longer shown as an IMDb rating.** Some panels put the year into their
  `rating` field, which BabyFlix rendered as "★ 2016.0" — in the detail view even with a hard-coded
  *IMDb* label next to it. A value now only counts as a rating when it is plausible (0–10);
  otherwise the banner shows the year as a year and the detail view names the source correctly
  ("Panel rating" instead of "IMDb rating"). This affected the banner, the poster cards and the
  detail view.

## [1.5.4] — 2026-10-16

### Changed
- **One player instead of two: the native MPV engine has been removed.** Playback is now FFmpeg
  plus the platform webview, and nothing else. The whole engine is gone — `mpv.rs` (1050 lines),
  `embed.rs` (456), the `PlayerShell` UI (1179), the `/api/mpv/*` routes, the "Playback engine"
  switch in Settings and the `playerEngine` store field (~3500 lines in total). Consequences:
  **nothing has to be installed next to BabyFlix** any more (the "install MPV" hint is gone), the
  macOS always-on-top video window that had to be docked over the app window is gone, and there is
  one player UI instead of two that carried the same controls twice.
- **The copy-vs-transcode decision now follows what the webview can really decode** instead of a
  fixed codec list. The UI probes the running webview once (`MediaSource.isTypeSupported` plus
  `mediaCapabilities.decodingInfo`) and reports the result to the backend, which then copies
  whatever is decodable: AC-3/E-AC-3 audio is passed through instead of being re-encoded to AAC,
  and HEVC is re-encoded only where the platform cannot handle it. Without a usable report the old
  conservative policy applies, so a missing probe can never make playback worse.
- **The categories of movies, series and live TV moved into a collapsible second sidebar**
  (search on top, categories below) instead of a horizontal chip row and a dropdown. The collapsed
  state is persisted.
- **Continue watching lists each series once** — the most recent episode instead of every started
  one. The history itself stays complete, because the detail page needs it for the per-episode
  progress bars. Removing a series card forgets that series as a whole.

### Added
- **Subtitles for VOD.** Text subtitle tracks are extracted to WebVTT in a dedicated FFmpeg run
  and offered in the subtitle menu (previously they were stripped). Image subtitles (PGS/VOBSUB)
  cannot be represented this way and are skipped. A failed extraction leaves playback untouched.
- **Live fallback for panels that only deliver raw MPEG-TS.** When the direct attempt fails, FFmpeg
  converts the channel on the fly and the player follows its rolling HLS playlist. HLS panels are
  unaffected. Live sessions get a 30-minute idle grace instead of 2 minutes.
- **"Random episode" button** on the series detail page, between the play button and the
  trailer/watchlist row. It skips the last watched episode whenever an alternative exists.
- **Adult-content filter** (Settings, on by default): category names such as Adult/XXX/Erotik are
  hidden from the home page, movies, series, live TV, search and the category pickers. Only
  categories are matched, never single titles.
- **Playback diagnostics** in Settings: a collapsible card showing the probed codec/container
  support and the decision of the last remux (copied or re-encoded, and which codec caused it).
- `POST /api/capabilities` (webview report) and `POST /api/subs` (subtitle extraction).

### Fixed
- **Coming back from a detail page keeps your position in the list.** `useScrollMemory` read
  `window.scrollY`, but the app scrolls inside an inner container, so it never worked. It now
  tracks the real container and saves continuously instead of only on unmount — by then the list
  has already shrunk and the browser has clamped the value.
- The MPV IPC test spawned `/bin/false`, which does not exist on macOS (it is `/usr/bin/false`
  there). The test therefore always failed locally while CI on Linux stayed green.

## [1.5.3] — 2026-10-15

### Fixed
- **"MPV could not start" on macOS is now rare — and diagnosable when it happens.** The wait for
  MPV's IPC socket was a hard 6 s, which a cold *first* launch can exceed (Homebrew's binary is
  checked by Gatekeeper the first time it runs). It is now 15 s, and
  `BABYFLIX_MPV_IPC_TIMEOUT` (seconds) raises it without a rebuild.
- **A start that MPV refuses is retried with conservative options.** If the full option set fails
  (`--vo`, `--hwdec`, `--profile=high-quality` — e.g. an MPV build or driver that rejects one of
  them), BabyFlix starts MPV a second time with platform defaults and a short socket path in the
  temp directory (macOS caps socket paths at 104 bytes). Playback therefore survives a refused
  option or an unusable profile directory instead of dying with an error dialog.
- The failure dialog no longer stops at *"mpv IPC endpoint was not reachable"*. It reports every
  attempt — whether MPV **died** during startup (with its exit status) or **kept running** without
  opening a socket — plus the MPV binary, its version and the tail of `mpv.log`, so a screenshot
  pinpoints the cause.

### Added
- MPV writes its own log next to the profile (`mpv.log`); `/api/health` reports `mpv`,
  `mpv_version`, `mpv_log` and `mpv_degraded` (why a start needed the fallback).

## [1.5.1] — 2026-10-12

### Fixed
- Windows build: `RawWindowHandle::Xlib`'s window id is a 32-bit `c_ulong` there, so the
  host-handle match arms produced different integer widths. All arms now cast to `u64`.
  Linux and macOS were unaffected.

## [1.5.0] — 2026-10-12

### Changed
- **MPV is now the default playback engine and renders inside the BabyFlix window** (`mpv --wid`):
  one window, no second player to manage, focus stays where you expect it. Fresh installs and
  existing profiles (store migration v3) both start in MPV; the webview player remains as the
  automatic fallback when MPV is not installed.
- **New player chrome** (replaces the old overlay). An HTML overlay can never sit on top of a
  native surface — the video would always cover it — so the controls now live in a real header and
  transport bar *around* the video stage: poster + title header with an engine badge, fullscreen
  and close, a wide timeline with hover preview and second-precision scrubbing, and a footer with
  skip-back / play / skip-forward, volume slider, speed menu, audio and subtitle pickers, keyboard
  help, always-on-top and fullscreen.
- End-of-episode card reworked for the native engine: the next episode is resolved from the series
  itself (no pre-computed hint needed), 10 s countdown, *Play now*, *Replay*, *Stop auto-play*, and
  the countdown resets per session.
- Playback preferences (volume, speed, muted, always-on-top) persist across sessions via
  `localStorage`; *Reset playback settings* in the shortcut popover restores the defaults.
- Menus stay readable above the native surface: while a popover is open the stage reports a
  narrower rectangle (measured against the popover) so MPV's video is never drawn over it. The
  picture widens back the moment the menu closes, and `H` gives the same space back to the video.
- The end-of-episode card knows the difference between an episode and a live stream: a dropped
  live channel shows *Stream ended* instead of *Episode finished*.

### Added
- `POST /api/mpv/stage` — the UI reports the video rectangle in device pixels and its visibility;
  the backend creates/repositions the native surface, keeps it hidden until playback actually
  starts and follows window move/resize/scale-factor changes.
- Own-window fallback for platforms without native child windows (macOS, Wayland): MPV runs
  borderless and always-on-top, docked onto the stage rectangle via `--geometry`, with a header
  hint that the video lives in its own window.
- Linux: `GDK_BACKEND=x11` is set automatically so Wayland sessions get XWayland and real embedding
  (opt out with `GDK_BACKEND=wayland`). `BABYFLIX_MPV_EMBED=0` disables embedding entirely and
  restores MPV's own OSC.
- New shortcuts for the shell: `H` toggles the chrome, `T` always-on-top, `N` next episode,
  `,` / `.` speed, `0`–`9` jump to the tenths, `Shift` + arrows skip 30 s.

### Fixed
- Timeline scrubbing no longer fights the 250 ms polling loop (local scrub state while dragging,
  seek on release); the hover tooltip shows the exact target time.
- The native surface is destroyed together with the MPV process — no orphan window stays behind
  after closing the player.

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
