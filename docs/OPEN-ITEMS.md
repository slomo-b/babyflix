# Open items

Things that are investigated or decided but not finished. Kept here so they do not
get lost between sessions.

## Parked: subtitles in German and English

**Status: parked on the user's request (2026-10-22). Not pursued for now.**

Reason: the user has no external subtitle source they can provide (no OpenSubtitles
account / API key), and the panel does not reliably deliver subtitle tracks. Without
a source there is nothing to fill in for titles that ship without one, so the
external-source path is dropped for the moment.

What exists and stays in the code:

- **Embedded text tracks** — several languages at once — are extracted to WebVTT and
  offered in the player's subtitle menu (workstream W4 in `PLAYER-RESEARCH.md`).
  Tracks are ordered German first, then English, following the UI language
  (commit `2a4fd82`).
- **Coverage is limited by the source.** No track in the file means no subtitle.
  Image-based subtitles (PGS/VOBSUB, typical for Blu-ray rips) would need OCR.

If the topic comes back, the missing piece is still the same: an OpenSubtitles API key
plus a manual offset control in the player (±10 s).

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
