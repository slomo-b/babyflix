# Open items

Things that are investigated or decided but not finished. Kept here so they do not
get lost between sessions.

## Subtitles in German and English

**Status: partially implemented, never verified.**

- **Embedded text tracks** — several languages at once — are extracted to WebVTT and
  offered in the player's subtitle menu (workstream W4 in `PLAYER-RESEARCH.md`).
  Tracks are ordered German first, then English, following the UI language
  (commit `2a4fd82`). **This has never run against a real stream.**
- **Coverage is limited by the source.** If the panel delivers no subtitle track,
  there is nothing to extract. Image-based subtitles (PGS/VOBSUB, typical for
  Blu-ray rips) cannot become WebVTT without OCR.
- **Missing DE/EN subtitles need an external source**: OpenSubtitles API (free
  account + API key), matching by title and year, plus a manual offset control in
  the player (±10 s) because third-party subtitles are almost always shifted.
  That is a 1.6.x feature, not a fix.

**Open questions for the user**

1. Do titles from their panel actually carry DE/EN subtitle tracks? Play a title and
   open the subtitle menu (gear icon → subtitles). This decides whether an external
   source is optional or the only path.
2. Are they willing to create an OpenSubtitles account / API key?

## Live TV hardening (partly done)

Three causes of sporadically hanging live playback were fixed in 1.5.9 (probe
timeout, proxy masking error statuses, 30 s wait on a dead converter). If it still
fails, the next question is: **single channels or all of them?** That separates a
panel-side cause (connection limit, channel offline) from an app-side one.

## "Top rated" row is really "newest"

Some panels put the release year into their `rating` field, so `rating >= 7` accepts
almost everything and sorting by rating sorts by year. The banner and the row are
therefore "the newest films", not "the best rated". A real IMDb ranking needs a
server-side candidate pool enriched once and cached (the local IMDb index maps
IMDb id → rating, title → id needs a network lookup).

## Notes

- Workstreams W4 (subtitles) and W5 (live raw TS) shipped in several releases
  without ever seeing a real stream.
- The local branch `feat/ui-improvements` still exists and matches `main`.
