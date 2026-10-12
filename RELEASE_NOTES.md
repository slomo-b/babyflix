# BabyFlix

A **Plex-like desktop streaming app** for movies, series and live TV — built on the
**Xtream Codes API** (plus **M3U** playlists) with **automatic posters** and **key-free IMDb
ratings**. Native desktop app for **Windows, macOS and Linux** (Tauri 2 + React + Rust).

## 🆕 What's new in 1.5.1

- 🎬 **The native player now lives *inside* BabyFlix.** MPV renders directly into the app window
  (real embedding), so movies and episodes play in **one window** — no second player, no focus
  games, with hardware decoding and HDR tone mapping for every format and every audio track.
- 🎛️ **All-new control layout around the video.** Poster/title header, a wide timeline with hover
  preview and precise scrubbing, skip-back / play / skip-forward, volume slider, **0.5×–2× speed**,
  audio and subtitle pickers, built-in keyboard help, always-on-top and fullscreen. Menus open
  beside the picture instead of behind it, so they are always readable.
- ⏭️ **Auto-next, everywhere.** At the end of an episode the card finds the following one from the
  series itself, counts down 10 seconds and can be re-armed, replayed or stopped at any time.
- 💾 **Playback preferences stick.** Volume, speed, mute and always-on-top are remembered —
  reset them any time from the shortcut popover.
- 🖥️ **Runs everywhere.** X11 and Windows get true embedding; on macOS and Wayland MPV runs in a
  borderless, always-on-top window docked exactly over the video area. Without MPV installed the
  webview player takes over automatically.
- ⌨️ **Keyboard first:** `Space`/`K` pause · `←`/`→` ±5 s (with `Shift` 30 s) · `J`/`L` ±10 s ·
  `↑`/`↓` volume · `M` mute · `F` fullscreen · `T` on top · `H` header · `N` next · `0`–`9`
  jump to tenths · `Esc` close.

## ✨ Highlights

- 🎬 **Movies / Series / Live TV** with categories, search and sorting
- 🔌 **Two login modes:** Xtream Codes and M3U playlist (fallback)
- 🖼️ **Automatic posters** (panel + IMDb) and ⭐ **real IMDb ratings** — no API key
- ▶️ **HLS player** with fullscreen, seeking, volume and keyboard shortcuts — or the optional
  native **MPV engine** (own window, hardware decoding, all tracks)
- 📺 **Live TV** with channel logos and **EPG** (now / next)
- 📚 **Series** with seasons/episodes and autoplay of the next episode
- ⏱️ **Continue watching** and 🌍 **German / English** UI (switchable)
- 🔄 **Automatic updates** straight from these GitHub releases

## 📦 Downloads

| Platform | File | Notes |
|---|---|---|
| **Windows** | `BabyFlix_*_x64-setup.exe` | Installer (recommended) |
| **Windows** | `BabyFlix_*_x64_en-US.msi` | MSI package |
| **macOS (Apple Silicon)** | `BabyFlix_*_aarch64.dmg` | M1/M2/M3 or newer |
| **macOS (Intel)** | `BabyFlix_*_x64.dmg` | Intel Macs |
| **Linux** | `BabyFlix_*_amd64.AppImage` | Universal, no install |
| **Linux** | `BabyFlix-*_x86_64.rpm` / `BabyFlix_*_amd64.deb` | Package managers |

## 🔄 Automatic updates

Installed apps check this release's `latest.json` on startup and update themselves (signed
updater artifacts). **macOS automatic updates require code signing** (Apple Developer
certificate + notarization); Windows and Linux auto-update work without OS code signing.

## 🔐 Privacy

Your credentials stay on your device. BabyFlix runs a local backend on `127.0.0.1` and talks
directly to your IPTV panel and to IMDb.

## ⚠️ Legal

BabyFlix provides **no content** — you use your **own, authorized** IPTV access. IMDb data is
intended for **personal, non-commercial use only**.

---

See [`CHANGELOG.md`](https://github.com/slomo-b/babyflix/blob/main/CHANGELOG.md) for details.
