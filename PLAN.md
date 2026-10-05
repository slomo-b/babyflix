# BabyFlix — Plan & Recherche

Eine Plex-artige Desktop-Streaming-App (Filme / Serien / Live-TV) auf Basis der
**Xtream Codes API** (eigene IPTV-Zugangsdaten), mit automatischen Covern und
IMDb-Ratings — **komplett keyless**.

---

## 1. Recherche-Ergebnisse

### 1.1 Xtream Codes API (IPTV-Panel)
Standard-API fast aller IPTV-Panels (Xtream UI, XUI.one, …).

| Zweck | Request |
|---|---|
| Login / Serverinfo | `GET {base}/player_api.php?username=U&password=P` |
| Live-Kategorien | `…&action=get_live_categories` |
| VOD-Kategorien | `…&action=get_vod_categories` |
| Serien-Kategorien | `…&action=get_series_categories` |
| Live-Sender | `…&action=get_live_streams[&category_id=]` |
| Filme (VOD) | `…&action=get_vod_streams[&category_id=]` |
| Serien | `…&action=get_series[&category_id=]` |
| Film-Details | `…&action=get_vod_info&vod_id=ID` |
| Serien-Details | `…&action=get_series_info&series_id=ID` |
| Kurz-EPG | `…&action=get_short_epg&stream_id=ID&limit=10` |
| Voll-EPG | `…&action=get_simple_data_table&stream_id=ID` |

**Stream-URLs** (ext aus `allowed_output_formats`, meist `ts`/`m3u8`):
- Live:   `{base}/live/{user}/{pass}/{stream_id}.{ext}`
- Film:   `{base}/movie/{user}/{pass}/{stream_id}.{ext}`
- Serie:  `{base}/series/{user}/{pass}/{episode_id}.{ext}`

**Wichtige Antwortfelder**
- Login: `user_info.{username,status,exp_date,is_trial,active_cons,max_connections,allowed_output_formats}`, `server_info.{url_port,https_port,server_protocol,timezone}`.
- VOD-Liste: `stream_id, name, stream_icon, rating, category_id, container_extension, added`.
- VOD-Info: `{ info:{ tmdb_id, movie_image, cover_big, backdrop_path[], plot, cast, director, genre, duration, rating, releasedate, youtube_trailer, … }, movie_data:{ stream_id, name, container_extension, … } }`.
- Serie-Liste: `series_id, name, cover, plot, cast, director, genre, releaseDate, rating, rating_5based, backdrop_path[]`.
- Serien-Info: `{ info:{…}, seasons:[…], episodes:{ "1":[ {id, episode_num, title, container_extension, info:{ tmdb_id, movie_image, plot, rating, duration, releasedate }} ] } }`.
- Live-Liste: `stream_id, name, stream_icon, epg_channel_id, tv_archive, tv_archive_duration, category_id`.
- EPG: `{ epg_listings:[ { title(b64), description(b64), start, end, start_timestamp, stop_timestamp } ] }` (Base64-kodiert!).

### 1.2 Keyless Meta / Cover / IMDb-Ratings
Kein API-Key nötig:

1. **Cover** kommen i.d.R. direkt vom Xtream-Panel (`stream_icon`, `movie_image`, `cover`, `cover_big`, `backdrop_path`).
2. **IMDb-Rating keyless** über die inoffizielle, aber stabile **IMDb GraphQL**:
   - `POST https://caching.graphql.imdb.com/`
   - Header `origin: https://www.imdb.com`, `referer: https://www.imdb.com/`, `content-type: application/json`.
   - Liefert `ratingsSummary.{aggregateRating,voteCount}`, `primaryImage.url` (Cover!), `plot`, `genres`, `runtime`, `principalCredits` (Cast/Regie) — **ohne Key, ohne WAF**.
3. **Titel → IMDb-ID keyless** über die Suggestion-API:
   - `GET https://v3.sg.media-imdb.com/suggestion/titles/x/{query}.json` → `{ d:[ {id:"tt…", l:"Titel", y:Jahr, q:"movie"/"TV series", i:{imageUrl}, s:"Cast"} ] }`.
4. Fallbacks: im Xtream-`rating` oft schon ein IMDb-Wert; optional TMDB-Key (nicht nötig).

> Ergebnis: **kein Key nötig** für Cover + IMDb-Rating. Alles über Xtream + IMDb (GraphQL/Suggestion), aggressiv gecacht.

### 1.3 Toolchain (geprüft)
- Rust 1.98 (`x86_64-pc-windows-gnu`, linkt erfolgreich), MinGW-gcc vorhanden.
- Node 22 / npm 12, WebView2 Runtime 154.x vorhanden.
- => **Tauri v2** baubar.

---

## 2. Architektur

```
┌─────────────────────────────────────────────────────────────┐
│ Tauri Desktop App (Windows)                                  │
│                                                              │
│  ┌────────────────────────┐   invoke / same-origin           │
│  │ React Frontend          │◄──────────────┐                 │
│  │ Vite+TS+Tailwind         │               │                 │
│  │ hls.js Player            │       HTTP 127.0.0.1:4523       │
│  └────────────────────────┘               │                 │
│                                            ▼                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Rust Backend (axum) — im Tauri-Prozess                 │   │
│  │  • Xtream-Client + Katalog-Cache                        │   │
│  │  • IMDb-Enrichment (GraphQL + Suggestion) + Cache       │   │
│  │  • Stream-Proxy mit Range-Support (HLS/TSt)             │   │
│  │  • m3u8-Rewriter, Bild-Proxy                            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
  Xtream-Panel (dein Server)          IMDb (keyless)
```

**Warum lokaler HTTP-Server im Rust-Prozess?** Kein CORS-/Mixed-Content-Problem,
HLS-Playback via hls.js funktioniert, Range-Requests für Seeking, Zugangsdaten
bleiben im Backend (nie im Frontend-Code).

### Rust-Backend Module
- `xtream.rs`  — Client (Login, Kategorien, Listen, Details, EPG, URL-Bau)
- `imdb.rs`    — Suggestion-Auflösung + GraphQL-Details, Disk-Cache
- `proxy.rs`   — Stream-/HLS-/Bild-Proxy (Range, m3u8-Rewrite)
- `state.rs`   — Session/Config (persistiert im App-Data-Ordner)
- `routes.rs`  — axum-Routen
- `lib.rs`/`main.rs` — Tauri-Setup, Serverstart

### Frontend-Struktur
- `pages/Login, Home, Movies, Series, LiveTV, Search, Settings`
- `pages/MovieDetail, SeriesDetail`
- `components/Player, MediaCard, Row, Hero, Sidebar, Topbar, Skeletons, RatingBadge`
- `lib/api.ts, lib/store.ts, lib/format.ts`
- Design: dunkles Plex-Style-Theme, Gradients, Hover-Scale, Skeletons, Framer-artige CSS-Transitions.

---

## 3. Feature-Liste (Scope)

**Kern**
- [x] Login mit Server-URL + User + Passwort, Session-Persistenz
- [x] Filme / Serien / Live-TV Browsen mit Kategorien
- [x] Detailseiten mit Backdrop, Poster, Plot, Cast, Regie, Genres, Laufzeit
- [x] **Automatische Cover** (Xtream + IMDb-Bild, Bild-Proxy)
- [x] **IMDb-Rating + Votes** (keyless), Badge auf Cards & Details
- [x] HLS/TSt-Player (hls.js) mit Fullscreen, Spulen, Lautstärke, Fortschritt
- [x] Serien: Staffeln/Episoden-Auswahl
- [x] Live-TV: Sender-Logos, Kategorien, EPG „Jetzt / Danach“
- [x] Suche über gesamten Katalog
- [x] „Weiterschauen“-Row (localStorage)

**UI/UX**
- [x] Hero-Banner auf Home, Rows, Hover-Effekte, Skeletons
- [x] Responsive Layout, Tastatur-Shortcuts (Space, ←/→, F, Esc)
- [x] Empty-/Error-States, Ladeanimationen

---

## 4. Roadmap / Build-Reihenfolge
1. Tauri-Scaffold (React+TS) + Tailwind + Deps.
2. Rust-Backend: Xtream-Client, Config/State, Routen, Stream-Proxy.
3. IMDb-Enrichment + Caches.
4. Frontend: Shell, Router, Store, API, Login.
5. Home/Movies/Series/Live + Detailseiten + Player.
6. Polish (Skeletons, Animationen, Shortcuts) + Build & Test.

## 5. Rechtlicher Hinweis
BabyFlix wird mit **eigenen, autorisierten** Xtream-Zugangsdaten betrieben. Die App
stellt keine Inhalte bereit. IMDb-Daten: nur für persönliche, nicht-kommerzielle Nutzung.
