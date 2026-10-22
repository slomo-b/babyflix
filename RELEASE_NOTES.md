# BabyFlix

A **Plex-like desktop streaming app** for movies, series and live TV — built on the
**Xtream Codes API** (plus **M3U** playlists) with **automatic posters** and **key-free IMDb
ratings**. Native desktop app for **Windows, macOS and Linux** (Tauri 2 + React + Rust).

## 🆕 What's new in 1.5.15

- 🎬 **Series no longer show the end card mid-episode.** If the provider's length information is too
  short, the player used to think the episode was over while it was still running — now the card only
  appears when really nothing is coming any more.
- 🔁 **Stalls heal themselves.** If the preparation of a film or episode breaks off, playback
  continues from the current spot instead of dropping into the error screen.
- 🧹 **6,856 dead "NO EVENT STREAMING" entries are gone** from the live list and the search. They are
  placeholders without a stream behind them.

## 🆕 What's new in 1.5.14

- 🔊 **Live channels with Dolby sound now play.** SRF 1 HD and other stations with AC-3/E-AC-3 audio
  could not be opened at all — the player cannot read that audio format out of a live transport
  stream. Those channels now run through FFmpeg, which converts the sound to AAC. Hajduk TV and other
  AAC channels are unaffected.
- ⏯ **No more "stops and jumps back a few seconds" on live TV.** Both retry paths used to restart
  playback at an earlier point; they now continue where you are. Low-latency mode is off, which fits
  these channels' long segments.
- 🇩🇪 **German is selectable again** in the language menu above the recommendations. It was missing
  because the list was built from only part of the catalogue.

## 🆕 What's new in 1.5.13

- 📺 **Live channels now start from everywhere.** Opening a channel from the home page or from search
  handed the backend the catalog's `ts` extension, so it requested **raw MPEG-TS** — which the player
  cannot read. Channels opened from the Live tab worked, because that path sends no extension; that
  is why the failure looked random. For live, the format is now always chosen by the backend (HLS).
  A stuck raw-TS stream also occupied the panel's single connection; that is gone too.

## 🆕 What's new in 1.5.12

- 🌍 **Pick the language of the recommendations.** Panels list the same title several times with a
  language prefix ("DE - …", "EN - …", "AT| …"), so the banner used to mix them. A small selector in
  the top-right corner restricts it to one language and remembers your choice. The list is read from
  your own catalog, so only languages you actually have are offered.
- 🔗 **"End of series" no longer appears too early.** Starting an episode from "Continue watching"
  dropped the series id, so the player could not find the next episode — no up-next banner, no random
  episode, and an end card claiming the series had ended (e.g. South Park S25E2 although the panel
  has S28). The chain now crosses seasons (S25E6 → S26E1); only at the real end does the random
  episode remain the choice.

## 🆕 What's new in 1.5.11

- 📺 **Live TV works again — with a proven cause.** Panels hand live streams over to a CDN via a
  redirect, and the playlist addresses its segments with root-relative paths. BabyFlix resolved
  those against the *original panel address* instead of the redirect target, so **every** segment
  request was answered with `403` — for every channel. Measured: `403` from the panel host, `200`
  and 9.6 MB from the CDN. Fixed, plus a regression test.
  Films and series were unaffected because FFmpeg follows redirects itself.

## 🆕 What's new in 1.5.10

- ❤️ **"Likes" sits right under Home.** Your watchlist moved up in the sidebar and has a clearer
  name — "Likes" in the navigation, on the page, and on the two detail buttons ("Like" / "Liked").
- 🎲 **Random episode wherever the next one is offered.** Besides the end card, the "Up next" banner
  during the last 20 seconds now has the button too.
- 🔗 **Playback keeps chaining.** After "Play now", the next episode had no up-next banner and no
  autoplay, and the end card even claimed the series had ended. The player now resolves the next
  episode itself.
- 🔤 **Subtitles: German first, then English**, labelled with the language name.

## 🆕 What's new in 1.5.9

- 🎲 **"Random episode" on the end card.** At the end of an episode you can now pick a random other
  episode of the same series instead of only the next one — across all seasons, and never the episode
  that just finished. The next-episode chain still works, so autoplay carries on from there.
- 📺 **Live TV no longer hangs indefinitely.** Three causes were fixed: the probe before the FFmpeg
  conversion had no timeout (a stalling channel could block it forever), the proxy turned error pages
  into "valid" playlists (so the player could not react), and a converter that died kept the player
  waiting 30 seconds for segments that never came. Failures now surface quickly instead of spinning.

## 🆕 What's new in 1.5.8

- 🔎 **Search results as a full grid.** Movies and series are no longer squeezed into a horizontal
  carousel where only a handful were visible and you had to page through with arrows — you now get a
  responsive grid, **60 hits per page**, the total count in the header and a "Show more" button.
- 🩹 **A title opens even when the provider sends no details.** If a panel answers with a web page
  instead of data (broken id, blocked request, rate limit), the page now falls back to what the
  catalog knows and tells you that description and episodes are missing — instead of a red error
  box. Playback still works.
- 🔍 **Better error messages.** When a panel returns something unreadable, the message now names the
  HTTP status, the content type and an excerpt of what actually came back, and the request is
  retried once with an alternative user-agent (many panels block browsers).

## 🆕 What's new in 1.5.7

- ⏭️ **You can now jump to any position in a film.** Seeking used to be limited to the part FFmpeg
  had already prepared — asking for 2:00:00 could silently land you at 26:00. If the target is not
  prepared yet, the conversion now restarts at that position and playback picks up right there: a
  short loading moment instead of a wrong jump. Resuming a film from the history starts at that
  position directly, too.

## 🆕 What's new in 1.5.6

- ⏩ **Scrubbing the timeline now seeks while you drag.** Before, only the preview moved and the
  player jumped when you let go — scrubbing felt sticky. The picture now follows the pointer,
  throttled to one seek every 200 ms so the remux can keep up, and releasing lands exactly on the
  target position.
- 🧹 **The two jump markers inside the progress bar are gone.** One of them sat at exactly two
  thirds of the film, labelled "Skip ahead (two thirds)" — a fixed position that fits almost no
  film.

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
