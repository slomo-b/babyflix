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

## Live TV

**Root cause of "live TV generally does not work" found on 2026-10-22.** The panel
answers a channel URL with a `302` to a CDN, and the HLS playlist contains
root-relative segment paths (`/hls/<hash>/…`). The proxy resolved them against the
**originally requested** URL (the panel host) instead of the redirect target, so
every segment request got a `403`. Fixed by using the response's effective URL as
the base, plus a regression test.

Measured against the user's panel (SRF 1 HD):

| Segment requested from | Result |
|---|---|
| panel host | `403` · `text/html` · 0 bytes |
| CDN host (redirect target) | `200` · `video/mp2t` · 9.6 MB |

This is why VOD kept working (FFmpeg follows redirects itself and never uses the
playlist rewriter) while live was broken for every channel.

Side note: that panel allows only **one** connection (`max_connections: 1`), but
parallel segment fetches work, so the limit is not the cause.

Earlier, 1.5.9 fixed three different hang scenarios (probe timeout, proxy masking
error statuses, 30 s wait on a dead converter). Those were real but not the cause.

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

## Live TV: the real codec failure (measured 2026-10-22/23)

Everything up to 1.5.13 was about *how* the stream was requested. The actual reason
some channels never played is the **audio codec**:

| channel | video | audio | result in a real WKWebView |
|---|---|---|---|
| Hajduk TV (`1880539`) | H.264 High | AAC LC | 90 s clean, no errors |
| SRF 1 HD (`188226`) | H.264 Main | **E-AC-3** | never reaches `t > 0` |

hls.js cannot demux AC-3/E-AC-3 out of MPEG-TS and says so:

```
mediaError/fragParsingError  fatal=false  reason=Unsupported EC-3 in M2TS found
```

The error is **not fatal**, so before 1.5.14 the player kept loading forever instead
of taking another path. Such channels now go to FFmpeg (video copy, audio → AAC),
and the live remux never copies AC-3/E-AC-3 itself, because its playlist is read by
hls.js again.

The "stops and jumps a few seconds back" symptom had two separate causes, both
retry paths: `recoverMediaError()` (flushes the buffer, restarts at the fragment
start) and `startLoad()` without a position (falls back to the live sync point).

### Catalogue survey (250 sampled of 52,782)

Live entries were probed through the app's own `/api/player` (ffprobe with
`-extension_picky false`, because the proxy URLs have no file extension). **The first
run used `-probesize 3M -analyzeduration 4M` and reported working channels as broken**
(e.g. `LT| 3PLUS`); with default probing it plays. Always probe with the defaults.

Final numbers (sequential re-checks confirmed the timeouts are real — 8 of 8 returned
"Invalid data" after 11 s even without parallel load):

| | count |
|---|---|
| playable | 157 (63 %) |
| dead upstream / event placeholder | 93 (37 %) |
| H.264 + AAC | 139 of the 157 |
| HEVC + AAC | 6 |
| H.264 + MP2 | 4 |
| H.264 + AC-3/E-AC-3 | 5 |
| HEVC + AC-3 | 1 |

The dead third is not fixable client-side: those entries carry no stream at all
(`NO EVENT STREAMING`, `(FLSP 123) | hockey: …`, `:TeliaPlay SE 93`, radio links that
answer 5xx). The codec exceptions are covered by the generic rules — parse error on
live → FFmpeg path; `copy_actions` decides VOD by the webview's own report. MP2 is
accepted by hls.js but WebKit cannot decode it, which surfaces as a fatal media error
and therefore takes the same FFmpeg path.

Duplicate names (1,587) are not a systematic problem and were not exploited for
fallbacks.
