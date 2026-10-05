# BabyFlix — Plan & Research

A Plex-like desktop streaming app (movies / series / live TV) built on the **Xtream Codes API**
(your own IPTV access), with automatic posters and IMDb ratings — **completely key-free**.

---

## 1. Research results

### 1.1 Xtream Codes API (IPTV panel)
The standard API of almost all IPTV panels (Xtream UI, XUI.one, …).

| Purpose | Request |
|---|---|
| Login / server info | `GET {base}/player_api.php?username=U&password=P` |
| Live categories | `…&action=get_live_categories` |
| VOD categories | `…&action=get_vod_categories` |
| Series categories | `…&action=get_series_categories` |
| Live streams | `…&action=get_live_streams[&category_id=]` |
| Movies (VOD) | `…&action=get_vod_streams[&category_id=]` |
| Series | `…&action=get_series[&category_id=]` |
| Movie details | `…&action=get_vod_info&vod_id=ID` |
| Series details | `…&action=get_series_info&series_id=ID` |
| Short EPG | `…&action=get_short_epg&stream_id=ID&limit=10` |
| Full EPG | `…&action=get_simple_data_table&stream_id=ID` |

**Stream URLs** (`ext` from `allowed_output_formats`, usually `ts`/`m3u8`):
- Live:  `{base}/live/{user}/{pass}/{stream_id}.{ext}`
- Movie: `{base}/movie/{user}/{pass}/{stream_id}.{ext}`
- Series:`{base}/series/{user}/{pass}/{episode_id}.{ext}`

See `docs/XTREAM-API.md` for the full reference.

### 1.2 Key-free metadata / posters / IMDb ratings
No API key required:

1. **Posters** usually come directly from the Xtream panel.
2. **Title → IMDb id / poster / cast** via the public IMDb suggestion API.
3. **Real IMDb rating + votes** from the official IMDb dataset `title.ratings.tsv.gz`
   (downloaded once, cached as a compact local index).

### 1.3 Toolchain
- Rust (GNU toolchain on Windows), Node 22, WebView2.
- => **Tauri v2** is buildable; desktop-only `crate-type = ["rlib"]`.

---

## 2. Architecture

```
Tauri window
 ├─ React + Vite + Tailwind   UI, router, player (hls.js)
 └─ Rust backend (axum)       local HTTP server on :4523
     xtream.rs, m3u.rs, imdb.rs, ratings.rs, proxy.rs, state.rs, routes.rs
```

Reasons for a local server inside the Rust process: no CORS/mixed-content issues, reliable HLS
playback, HTTP-Range seeking, and credentials stay in the backend.

---

## 3. Roadmap / status

- [x] Tauri scaffold (React + TS) + Tailwind
- [x] Rust backend: Xtream client, config/state, routes, stream proxy
- [x] Key-free IMDb enrichment + caches
- [x] Frontend: shell, router, store, API, login
- [x] Home / movies / series / live + detail pages + player
- [x] M3U playlist login (fallback source)
- [x] German/English UI with language switch
- [x] Installers (Windows NSIS/MSI) + macOS/Linux via CI
- [x] Automatic updates (Tauri updater, signed releases)

## 4. Legal notice
BabyFlix is operated with **your own, authorized** Xtream credentials. The app provides no
content. IMDb data: personal, non-commercial use only.
