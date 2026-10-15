# Player architecture — research & decision

Status: decision accepted, not implemented yet.
Scope: replace the two playback engines (native **mpv** process + **hls.js** webview) with a
single one.

---

## 1. Decision

**One engine: FFmpeg + the platform webview.** The mpv engine is removed entirely.

- FFmpeg (already provisioned) does demux/remux/transcode.
- The webview does the rendering: HLS via `hls.js`/MSE where needed, native HLS playback where
  the platform supports it (WKWebView).
- Which FFmpeg path runs is decided **at runtime from the platform's real capabilities**, never
  from a static guess.

## 2. Why not the alternatives

| Option | Reason to reject |
|---|---|
| `libmpv` in-process (render API) | It *is* mpv. On macOS the render API (Metal/IOSurface) would have to be built by hand. Heavyweight dependency. |
| mpv as an external process (today) | Requires the user to install mpv; cannot embed on macOS (a borderless always-on-top window is docked over the app window); heavyweight. |
| `libvlc` | Technically capable and LGPL, but ~100 MB plugin tree, plugin-path packaging, LGPL-only plugin review, and a full rewrite of all playback control. Not lightweight. |
| GStreamer | Heavyweight, packaging-intensive on Windows/macOS. |
| AVFoundation + Media Foundation directly | Two implementations, no MKV, no multi-track audio in MKV — loses features. |
| WebCodecs | Modern and lean, but MKV/TS still needs a demuxer, so FFmpeg stays. Useful as a later upgrade for the video path, not as a replacement now. |

FFmpeg stays downloadable-at-runtime (not redistributed), so the MIT licence of BabyFlix is
unaffected.

## 3. Requirements

1. **Work with as many panels as possible.** There is no test provider, so nothing may be
   *assumed* about codecs, containers or panel behaviour — it must be *probed*.
2. **No heavyweight dependencies** (no mpv, no VLC, no GStreamer).
3. **MIT stays MIT**: keep FFmpeg out of the distribution.

## 4. Design principles

1. **Probe, don't guess.** One capability check per platform, cached for the session:
   `MediaSource.isTypeSupported()` and `mediaCapabilities.decodingInfo()` for each candidate
   codec/container. The result drives the FFmpeg invocation.
2. **Cheapest path first.** Direct playback → remux with `copy` → transcode only the part that
   is genuinely unsupported.
3. **One upstream connection per playback.** Cheapest is best here too: many panels allow a
   single connection; `ffprobe` on the same URL is a *second* connection.
4. **Never break a page.** A failed optimisation degrades to the next path with a readable
   message, never to a blank screen.

## 5. Target compatibility matrix

Read as: input as delivered by the panel → what the unified engine does.

| Input | macOS (WKWebView) | Windows (WebView2/Chromium) — no HEVC extension | Windows — with HEVC extension |
|---|---|---|---|
| HLS live (`.m3u8`) | direct (native HLS) | direct (`hls.js`, low latency) | direct |
| Live, raw MPEG-TS only | FFmpeg → live HLS | FFmpeg → live HLS | FFmpeg → live HLS |
| MP4/MKV, H.264 + AAC/MP3 | remux `copy` | remux `copy` | remux `copy` |
| MP4/MKV, H.264 + AC-3/E-AC-3 | remux `copy` (audio as-is) | remux `copy` (audio as-is) | remux `copy` |
| MP4/MKV, HEVC + AC-3 | remux `copy` | **video → H.264**, audio `copy` | remux `copy` |
| DTS audio | audio → AAC | audio → AAC | audio → AAC |
| Subtitles (MKV/TS) | convert to WebVTT | convert to WebVTT | convert to WebVTT |
| Exotic video (VC-1, WMV) | video → H.264 | video → H.264 | video → H.264 |

Every "copy" row must be confirmed by the probe at runtime; the table is the *default* the probe
starts from. The Windows HEVC case is the single biggest unknown and the reason the codec must be
detected, not assumed.

## 6. Workstreams

**W1 — Capability probe (web + Rust).** A small module that answers: can this platform play
`video/mp4; codecs="hvc1"`, `…"avc1.640028"`, `audio/mp4; codecs="ac-3"`, `…"ec-3"`, `…"dtsc"`,
`audio/mp4; codecs="mp4a.40.2"`? Result is cached and sent to the backend as the remux request, so
FFmpeg's decision comes from the client's real capability. Also exposed in `/api/diagnose` so a
user can see why a stream was transcoded.

**W2 — Remux: copy-first on fMP4.** Replace unconditional `libx264`/`aac` with the decision from
W1. Switch from MPEG-TS to **fMP4/CMAF** segments: MPEG-TS works only because `hls.js`
transmuxes every segment to fMP4 in JavaScript — that costs CPU in the webview and limits which
audio codecs survive. Real fMP4 segments need no transmuxing, seek sample-accurately and are what
native HLS on macOS prefers. Sketch:

```
ffmpeg -user_agent <UA> -i <URL> \
  -map 0:v:0 -map 0:a \
  -c:v copy                       # or: -c:v libx264 -preset veryfast -crf 23
  -c:a copy                       # or: -c:a aac -ac 2 -b:a 192k
  -f hls -hls_time 4 -hls_playlist_type event \
  -hls_segment_type fmp4 -hls_flags independent_segments+temp_file \
  -hls_segment_filename <dir>/seg_%05d.m4s <dir>/index.m3u8
```

**W3 — Multi-audio without restarting FFmpeg.** Today every audio switch starts a new FFmpeg
session (a new upstream connection). Instead map all audio tracks and publish them as HLS audio
renditions in one master playlist:

```
  -map 0:v:0 -map 0:a:0 -map 0:a:1 -map 0:a:2 \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,agroup:aud,name:video a:0,agroup:aud,name:a0,default:yes a:1,agroup:aud,name:a1 a:2,agroup:aud,name:a2"
```

hls.js then switches tracks instantly; native HLS shows its own audio menu. Keep the existing
"prefer German" auto-pick.

**W4 — Keep subtitles.** Drop `-sn`; extract text subtitles to **WebVTT** (`-c:s webvtt`) and
serve them as a sidecar so MSE and native HLS both get real text tracks. Image subtitles
(PGS/VOBSUB) cannot be shown this way — burn-in only for those, or skip.

**W5 — Live remux for raw MPEG-TS panels.** Today live only works if the panel already serves
HLS (or a `.m3u8` sibling exists). Panels that only offer raw `.ts` were playable **only** with
mpv. Add an FFmpeg live → HLS pass-through:

```
  -f hls -hls_time 2 -hls_list_size 6 -hls_flags delete_segments+omit_endlist \
  -hls_segment_type fmp4 ...
```

**W6 — Fold the probe into the remux (single connection).** `Remux::start` currently runs
`ffprobe` and then `ffmpeg` — two connections to the panel. Panels with a 1-connection limit are
exactly the ones that fail today. Options, in order of preference:

1. Reuse the stream info the panel already gives us (Xtream `get_vod_info` / `get_series_info`
   carry codec info for many panels).
2. Parse FFmpeg's own stream info from its first log lines instead of calling `ffprobe`.
3. Only fall back to `ffprobe` if 1 and 2 give nothing.

**W7 — Delete the mpv path.** `src-tauri/src/mpv.rs` (1050 lines), `src-tauri/src/embed.rs` (456),
`src/components/PlayerShell.tsx` (1179), the `/api/mpv/*` routes, the engine toggle in Settings,
the `playerEngine` store field, and the mpv entries in `/api/health`. Then `Player.tsx` is the
only player. Removes ~2700 lines plus the duplicated UI (~500 lines of the two players were
literally the same controls).

**W8 — Diagnostics.** Extend `/api/diagnose` to report: probed platform capabilities, the chosen
path per stream (`direct` / `copy` / `transcode-video` / `transcode-audio`), and the reason. With
no test provider this is the only way to debug a user's panel.

## 7. Test strategy without a provider

Real panelless testing is possible for everything except panel behaviour:

- Generate the whole input matrix locally with the bundled FFmpeg (`testsrc2`/`sine`):
  MP4/MKV/TS × H.264/HEVC × AAC/AC-3/DTS/MP3, plus a raw-TS "live" loop.
- Serve those files over local HTTP and drive the remux workstream against them.
- Assert the *decision* (copy vs transcode) per combination; assert the produced playlist/segments
  and that seeking lands within one segment.
- The webview part needs a running app; the SDK fix in this environment is still open (see below).

## 8. What is lost

- Frame-exact seeking → sample-accurate via fMP4 (practically equivalent).
- HDR tone-mapping of `gpu-next` quality; the webview tone-maps through the OS.
- The `mpv.log`-based diagnostics; replaced by FFmpeg logs + W8.

## 9. Note on licence posture

Today's transcode fallback uses `libx264`, which is why FFmpeg is a **GPL** build that is
downloaded at runtime and never redistributed. That posture must stay. If FFmpeg should ever be
bundled instead, use the OS encoders (`h264_videotoolbox` on macOS, `h264_mf`/`h264_qsv`/`h264_amf`
on Windows) and drop `libx264` — that yields an LGPL-compatible FFmpeg without the GPL question.

## 10. Phases

| Phase | Content | Status |
|---|---|---|
| 0 | W1 capability probe + W8 diagnostics only — no behaviour change | **done** (`feat(player): Phase 0`) |
| 1 | W2 copy-first + fMP4; W6 single connection | open — the actual win |
| 2 | W3 multi-audio, W4 subtitles, W5 live remux | open — **W4 and W5 are parity gaps** now that mpv is gone |
| 3 | W7 delete the mpv path and unify the UI | **done** (~3500 lines removed) |

Phase 3 landed before Phase 1/2, so on the current branch three capabilities that mpv used to
provide are temporarily missing and must land before a release: subtitles (W4), live streams that
only arrive as raw MPEG-TS (W5), and copy-instead-of-transcode for AC-3/E-AC-3 (W2). Nothing is
released until that is settled.


## 11. Appendix — current architecture (as found)

- Two engines, no shared abstraction: `Player.tsx` (1387 lines) + `remux.rs` for web,
  `PlayerShell.tsx` (1179) + `mpv.rs` (1050) + `embed.rs` (456) for mpv. Selected by
  `playerEngine` in the store, default `"mpv"`, with a silent fallback to web when mpv is missing.
- mpv runs as an external `mpv --idle` process driven over JSON IPC (unix socket /
  Windows named pipe), embedded with `--wid` on X11 and Windows; on **macOS it cannot embed** and
  falls back to its own borderless always-on-top window docked over the stage rectangle.
- Every VOD is remuxed: H.264 is copied, **every other video codec is re-encoded** with
  `libx264 -preset veryfast -crf 23`; AAC/MP3 are copied, everything else becomes `aac 192k`.
  Subtitles are stripped (`-sn`). Live is never remuxed.
- ~80 % of both player components is duplicated UI; only ~245 lines (`Player.tsx`) and
  ~165 lines (`PlayerShell.tsx`) are genuinely engine-specific.
