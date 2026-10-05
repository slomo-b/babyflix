# Xtream Codes API — Standard Reference

Summary of the de-facto standard that IPTV panels (Xtream UI, XUI.one, Xtream-Masters, …)
expose through `player_api.php`. Sources: various client implementations (Go/Dart/Rust/Python)
and the panels themselves.

## 1. Transport & authentication
- **A single entry point:** `{base}/player_api.php` (GET).
- **Auth:** `username` + `password` as query parameters. **No API key, no token.**
- `{base}` = `http(s)://host:port` — **without** a path, **without** `/get.php` or `/player_api.php`.

## 2. Login response (`player_api.php?username=&password=`)
A **compliant** server answers with **HTTP 200** and JSON:

```json
{
  "user_info": {
    "username": "USER", "password": "PASS",
    "auth": 1,                       // 1 = ok, 0 = rejected
    "status": "Active",              // Active | Expired | Disabled | Banned | Trial
    "exp_date": "1767225600",        // Unix timestamp
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

**Error semantics (important):**
- Wrong credentials → **HTTP 200**, `user_info.auth = 0` (not 401/403!).
- Expired/blocked → **HTTP 200**, `status = Expired|Disabled|Banned`.
- A **non-200** status (401/403/444/511/513/5xx) is **not** an Xtream auth error but an
  upstream infrastructure (proxy/WAF/CDN) or a panel block.
- Older portals may return **XML** → force JSON with `&format=json`.

## 3. Actions (`&action=…`)

| Action | Parameters | Returns |
|---|---|---|
| `get_live_categories` | – | Live categories |
| `get_live_streams` | `category_id?` | Live channels |
| `get_vod_categories` | – | Movie categories |
| `get_vod_streams` | `category_id?` | Movies |
| `get_vod_info` | `vod_id` | Movie details (`info` + `movie_data`) |
| `get_series_categories` | – | Series categories |
| `get_series` | `category_id?` | Series |
| `get_series_info` | `series_id` | Seasons/episodes (`seasons`, `episodes`, `info`) |
| `get_short_epg` | `stream_id`, `limit?` | Short EPG (Base64 titles!) |
| `get_simple_data_table` | `stream_id` | Full EPG (legacy) |
| `get_all_epg` / `get_epg` | `stream_id` | Full EPG (newer) |

## 4. Stream URLs
```
Live:     {base}/live/{user}/{pass}/{stream_id}.{ext}
VOD:      {base}/movie/{user}/{pass}/{stream_id}.{ext}
Series:   {base}/series/{user}/{pass}/{episode_id}.{ext}
```
`ext` ∈ `allowed_output_formats` (`ts`, `m3u8`, `rtmp`). VOD `ext` comes from
`container_extension` (`mp4`, `mkv`, `avi`, …).

## 5. M3U & EPG (convenience)
```
Playlist: {base}/get.php?username={u}&password={p}&type=m3u_plus&output=ts|hls
EPG:      {base}/xmltv.php?username={u}&password={p}
```

## 6. Raw fields (selection)
- Live item: `num, name, stream_id, stream_icon, epg_channel_id, category_id, tv_archive, tv_archive_duration, added`.
- VOD info `info`: `tmdb_id, movie_image, cover_big, backdrop_path[], plot, cast, director, genre, duration, rating, releasedate, youtube_trailer, country, age`.
- Series info `info`: `name, cover, plot, cast, director, genre, releaseDate, rating, rating_5based, backdrop_path[]`.
- Episode: `id, episode_num, title, container_extension, info{tmdb_id, movie_image, plot, rating, duration, releasedate}`.
- EPG: `title`/`description` **Base64**, `start_timestamp`/`stop_timestamp`, `now_playing`, `has_archive`.

## 7. Common pitfalls
- Missing port / wrong scheme (`http` vs `https`) → no connection.
- Pasting the whole M3U URL into the server field → `…/get.php?…/player_api.php` → 404/HTML.
- **VPN/datacenter IPs** and **geo-blocks** → often 403/444/511/513.
- **Rate limiting** after several failed attempts → codes change, wait a bit.
- Some panels serve EPG only via `epg_channel_id` instead of `stream_id`.
- Some panels are additionally **Stalker/MAG portals** (`/c/`, `portal.php`, `server/load.php`).
