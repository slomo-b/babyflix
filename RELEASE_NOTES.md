# BabyFlix

A **Plex-like desktop streaming app** for movies, series and live TV — built on the
**Xtream Codes API** (plus **M3U** playlists) with **automatic posters** and **key-free IMDb
ratings**. Native desktop app for **Windows, macOS and Linux** (Tauri 2 + React + Rust).

## 🆕 What's new in 1.5.5

- 🔀 **The banner at the top of the home page now shows a different set of films on every load.**
  It used to be the same first six of the "Top rated" row, in the same order. The row is now
  shuffled and a different handful is featured. The 9-second rotation between the featured films
  was already there — it simply cycled through an unchanged selection.
- ⭐ **A release year is no longer shown as an IMDb rating.** Some panels put the year into their
  `rating` field, which BabyFlix rendered as "★ 2016.0" — in the detail view even with a
  hard-coded *IMDb* label next to it. A value now only counts as a rating when it is plausible
  (0–10); otherwise the banner shows the year as a year, and the detail view names the source
  correctly ("Panel rating" instead of "IMDb rating"). This affects the banner, the poster cards
  and the detail view.

## 🆕 What's new in 1.5.4

- 🎬 **One player instead of two — and nothing to install any more.** The native MPV engine is
  gone; playback is **FFmpeg plus the platform webview**, and nothing else. The "install MPV"
  hint, the engine switch in Settings and the borderless video window that had to be docked over
  the app window on macOS are all gone — along with ~3 500 lines of code and a second set of
  playback controls that duplicated the first. **Upgrading needs no action**: the settings entry
  simply disappears.
- 🔊 **Far less re-encoding.** BabyFlix now asks the running webview what it can actually decode
  and copies whatever it can. **AC-3 / E-AC-3 audio is passed through** instead of being re-encoded
  to AAC, and **HEVC is only re-encoded where the platform genuinely cannot decode it** (e.g.
  Windows without the HEVC Video Extensions). Less CPU, less fan noise, no needless quality loss.
- 📺 **Live channels that only arrive as raw MPEG-TS play again.** Many panels serve live TV as a
  bare transport stream rather than HLS. Those could previously be played by MPV alone. Now, if the
  direct attempt fails, FFmpeg converts the channel on the fly and the player follows its rolling
  playlist — HLS panels are untouched and start exactly as before.
- 💬 **Subtitles are back.** Text subtitles are converted to WebVTT and offered in the subtitle
  menu instead of being discarded. If the conversion fails, the film simply continues without them.
- 🗂️ **A real category sidebar for movies, series and live TV.** Search on top, categories listed
  below, and it stays put while you scroll. It can be collapsed to a narrow handle, and the state
  is remembered — replacing the old chip row and the live-TV dropdown.
- 🚫 **Adult content can be hidden** (Settings → *Hide adult content*, on by default). Category
  names like Adult/XXX/Erotik are filtered out of the home page, movies, series, live TV, search
  and the category pickers. Only categories are matched — never single titles — so a legitimate
  film such as "Sex and the City" stays visible.
- 🎲 **"Random episode" for series.** A new button on the detail page starts a random episode and
  skips the one you watched last whenever there is an alternative.
- ⏱️ **Continue watching lists each series once.** Only the most recent episode appears, instead of
  every episode you ever started. Removing a card now forgets that series as a whole.
- 🔙 **Your place is kept.** Returning from a detail page drops you back where you were in the list
  instead of at the top.
- 🩺 **Playback diagnostics.** Settings has a collapsible *Playback capabilities* card showing what
  the webview can decode (video, audio, containers, hardware decoding) and what the last film
  needed — copied or re-encoded, and because of which codec. Replaces guesswork when a title looks
  wrong.

## ✨ Highlights

- 🎬 **Movies / Series / Live TV** with categories, search and sorting
- 🔌 **Two login modes:** Xtream Codes and M3U playlist (fallback)
- 🖼️ **Automatic posters** (panel + IMDb) and ⭐ **real IMDb ratings** — no API key
- ▶️ **One playback engine** (FFmpeg + webview) with hardware decoding, every audio track and
  subtitles — it copies instead of re-encoding wherever the platform allows
- 🗂️ **Collapsible category sidebar** and 🚫 **adult-content filter**
- 📺 **Live TV** with channel logos and **EPG** (now / next)
- 📚 **Series** with seasons/episodes, autoplay of the next episode and 🎲 random episode
- ⏱️ **Continue watching** (one card per series) and 🌍 **German / English** UI (switchable)
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
