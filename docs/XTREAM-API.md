# Xtream Codes API — Standard-Referenz

Zusammenfassung des de-facto-Standards, den IPTV-Panels (Xtream UI, XUI.one, Xtream-Masters, …)
über `player_api.php` anbieten. Quelle: diverse Client-Implementierungen (gos/dart/rust/python)
und Panels selbst.

## 1. Transport & Authentifizierung
- **Ein Einstiegspunkt:** `{base}/player_api.php` (GET).
- **Auth:** `username` + `password` als Query-Parameter. **Kein API-Key, kein Token.**
- `{base}` = `http(s)://host:port` — **ohne** Pfad, **ohne** `/get.php` oder `/player_api.php`.

## 2. Login-Antwort (`player_api.php?username=&password=`)
Ein **standardkonformer** Server antwortet mit **HTTP 200** und JSON:

```json
{
  "user_info": {
    "username": "USER", "password": "PASS",
    "auth": 1,                       // 1 = ok, 0 = abgelehnt
    "status": "Active",              // Active | Expired | Disabled | Banned | Trial
    "exp_date": "1767225600",        // Unix-Timestamp
    "is_trial": "0",
    "active_cons": "1",
    "created_at": "1712000000",
    "max_connections": "2",
    "allowed_output_formats": ["m3u8", "ts"]
  },
  "server_info": {
    "url": "provider.example", "port": "8080",
    "https_port": "8443", "server_protocol": "http",
    "timezone": "Europe/Berlin", "timestamp_now": 1670000000
  }
}
```

**Fehler-Semantik (wichtig):**
- Falsche Zugangsdaten → **HTTP 200**, `user_info.auth = 0` (kein 401/403!).
- Abgelaufen/gesperrt → **HTTP 200**, `status = Expired|Disabled|Banned`.
- Ein **Nicht-200-Status** (401/403/444/511/513/5xx) ist **kein Xtream-Auth-Fehler**, sondern
  eine vorgelagerte Infrastruktur (Proxy/WAF/CDN) oder ein Panel-Block.
- Ältere Portale liefern evtl. **XML** → mit `&format=json` JSON erzwingen.

## 3. Actions (`&action=…`)

| Action | Parameter | Liefert |
|---|---|---|
| `get_live_categories` | – | Live-Kategorien |
| `get_live_streams` | `category_id?` | Live-Sender |
| `get_vod_categories` | – | Film-Kategorien |
| `get_vod_streams` | `category_id?` | Filme |
| `get_vod_info` | `vod_id` | Film-Details (`info` + `movie_data`) |
| `get_series_categories` | – | Serien-Kategorien |
| `get_series` | `category_id?` | Serien |
| `get_series_info` | `series_id` | Staffeln/Episoden (`seasons`, `episodes`, `info`) |
| `get_short_epg` | `stream_id`, `limit?` | Kurz-EPG (Base64-Titel!) |
| `get_simple_data_table` | `stream_id` | Voll-EPG (Legacy) |
| `get_all_epg` / `get_epg` | `stream_id` | Voll-EPG (neuer) |

## 4. Stream-URLs
```
Live:   {base}/live/{user}/{pass}/{stream_id}.{ext}
VOD:    {base}/movie/{user}/{pass}/{stream_id}.{ext}
Serie:  {base}/series/{user}/{pass}/{episode_id}.{ext}
```
`ext` ∈ `allowed_output_formats` (`ts`, `m3u8`, `rtmp`). VOD-`ext` aus `container_extension`
(`mp4`, `mkv`, `avi`, …).

## 5. M3U & EPG (Konvenienz)
```
Playlist: {base}/get.php?username={u}&password={p}&type=m3u_plus&output=ts|hls
EPG:      {base}/xmltv.php?username={u}&password={p}
```

## 6. Rohfelder (Auswahl)
- Live-Item: `num, name, stream_id, stream_icon, epg_channel_id, category_id, tv_archive, tv_archive_duration, added`.
- VOD-Info `info`: `tmdb_id, movie_image, cover_big, backdrop_path[], plot, cast, director, genre, duration, rating, releasedate, youtube_trailer, country, age`.
- Serien-Info `info`: `name, cover, plot, cast, director, genre, releaseDate, rating, rating_5based, backdrop_path[]`.
- Episode: `id, episode_num, title, container_extension, info{tmdb_id, movie_image, plot, rating, duration, releasedate}`.
- EPG: `title`/`description` **Base64**, `start_timestamp`/`stop_timestamp`, `now_playing`, `has_archive`.

## 7. Typische Stolperfallen
- Port fehlt / falsches Schema (`http` vs `https`) → keine Verbindung.
- Ganze M3U-URL ins Server-Feld kopiert → `…/get.php?…/player_api.php` → 404/HTML.
- **VPN/Datacenter-IPs** und **Geo-Sperren** → oft 403/444/511/513.
- **Rate-Limit** nach mehreren Fehlversuchen → Codes wechseln, kurz warten.
- Manche Panels liefern EPG nur über `epg_channel_id` statt `stream_id`.
- Manche Panels sind zusätzlich **Stalker/MAG-Portale** (`/c/`, `portal.php`, `server/load.php`).
