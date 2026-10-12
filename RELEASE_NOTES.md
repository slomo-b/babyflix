# BabyFlix

A **Plex-like desktop streaming app** for movies, series and live TV — built on the
**Xtream Codes API** (plus **M3U** playlists) with **automatic posters** and **key-free IMDb
ratings**. Native desktop app for **Windows, macOS and Linux** (Tauri 2 + React + Rust).

## 🆕 What's new in 1.4.0

- 🎞️ **Native MPV engine (optional).** BabyFlix can play through a real **MPV process** in its own
  window: hardware decoding for every format **without re-encoding**, HDR tone mapping, frame-exact
  seeking and all audio/subtitle tracks as your provider delivers them. Enable it in
  **Settings → Playback → Playback engine** (default stays *Webview*).
- 🎛️ **The BabyFlix window becomes the remote.** Full control for the MPV window: play/pause,
  ±10 s, draggable timeline with preview, volume, mute, **0.5×–2× speed**, audio/subtitle tracks,
  *always on top*, fullscreen and the end-of-episode card with **auto-next** — plus all keyboard
  shortcuts (`Space`, `←`/`→`, `↑`/`↓`, `M`, `F`, `0`–`9`, `?`, `Esc`).
- 🔍 **MPV check with install help.** Settings shows the detected MPV path — or the exact command
  for your system (`sudo apt install mpv` · `brew install mpv` · `winget install mpv`); if MPV fails
  to start, one click takes you back to the webview player.

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
