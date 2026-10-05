//! Xtream Codes API client: login, catalogs, details, EPG and stream URL building.
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BabyFlix/1.0";
pub const UA_VLC: &str = "VLC/3.0.20 LibVLC/3.0.20";
pub const UA_SMARTERS: &str = "IPTV Smarters/1.0 (Linux; Android 13) ExoPlayerLib/2.18.1";

pub fn ua_label(ua: &str) -> &'static str {
    if ua == UA_VLC {
        "vlc"
    } else if ua == UA_SMARTERS {
        "smarters"
    } else {
        "browser"
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Credentials {
    pub base_url: String,
    pub username: String,
    pub password: String,
}

#[derive(Clone)]
pub struct Session {
    pub creds: Credentials,
    pub user_info: Value,
    pub server_info: Value,
    pub allowed_exts: Vec<String>,
    pub ua: String,
    pub source: String, // "xtream" | "m3u"
    pub m3u_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: String,
    pub kind: String, // movie | series | live
    pub name: String,
    pub cover: Option<String>,
    pub category_id: Option<String>,
    pub extension: Option<String>,
    pub added: Option<i64>,
    pub rating: Option<f64>,
    pub epg_channel_id: Option<String>,
    pub tv_archive: bool,
    /// Direct playback URL (M3U sources only). Never sent to the frontend.
    #[serde(default, skip_serializing)]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
}

/// Normalize a catalog kind to the internal set: `vod` | `series` | `live`.
pub fn norm_kind(kind: &str) -> &'static str {
    match kind {
        "series" | "shows" | "tv" => "series",
        "live" | "channels" => "live",
        _ => "vod",
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub num: i32,
    pub title: String,
    pub plot: Option<String>,
    pub cover: Option<String>,
    pub duration: Option<String>,
    pub rating: Option<f64>,
    pub release_date: Option<String>,
    pub extension: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Season {
    pub number: i32,
    pub name: String,
    pub cover: Option<String>,
    pub episodes: Vec<Episode>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Detail {
    pub plot: Option<String>,
    pub cast: Vec<String>,
    pub director: Option<String>,
    pub genre: Option<String>,
    pub duration: Option<String>,
    pub release_date: Option<String>,
    pub trailer: Option<String>,
    pub backdrop: Option<String>,
    pub rating: Option<f64>,
    pub container_extension: Option<String>,
    pub country: Option<String>,
    pub age: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MovieDetail {
    pub item: MediaItem,
    pub detail: Detail,
    pub seasons: Vec<Season>, // empty for movies
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EpgEntry {
    pub title: String,
    pub description: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub start_ts: Option<i64>,
    pub stop_ts: Option<i64>,
    pub now_playing: bool,
    pub has_archive: i32,
}

// ---------- helpers ----------

pub fn normalize_base(input: &str) -> String {
    let raw = input.trim();
    let has_scheme = raw.starts_with("http://") || raw.starts_with("https://");
    let with_scheme = if has_scheme {
        raw.to_string()
    } else {
        // Heuristic: an explicit non-443 port usually means a plain-HTTP IPTV panel.
        let looks_http = raw.contains(':') && !raw.ends_with(":443");
        format!("{}://{}", if looks_http { "http" } else { "https" }, raw)
    };
    if let Ok(u) = reqwest::Url::parse(&with_scheme) {
        if let Some(host) = u.host_str() {
            let mut base = String::new();
            base.push_str(u.scheme());
            base.push_str("://");
            base.push_str(host);
            if let Some(port) = u.port() {
                base.push(':');
                base.push_str(&port.to_string());
            }
            let mut path = u.path().to_string();
            while path.ends_with('/') {
                path.pop();
            }
            for f in [
                "player_api.php",
                "panel_api.php",
                "get.php",
                "xmltv.php",
                "api.php",
                "enigma2.php",
            ] {
                if let Some(idx) = path.find(f) {
                    path.truncate(idx);
                    break;
                }
            }
            while path.ends_with('/') {
                path.pop();
            }
            if !path.is_empty() && !path.ends_with(".php") {
                base.push_str(&path);
            }
            return base;
        }
    }
    let mut s = raw.trim_end_matches('/').to_string();
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    s
}

pub fn alternate_scheme(base: &str) -> Option<String> {
    if let Some(rest) = base.strip_prefix("https://") {
        Some(format!("http://{rest}"))
    } else if let Some(rest) = base.strip_prefix("http://") {
        Some(format!("https://{rest}"))
    } else {
        None
    }
}

fn loose_str(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(b.to_string()),
        _ => None,
    }
}

fn loose_i64(v: Option<&Value>) -> Option<i64> {
    match v {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok().or_else(|| s.trim().parse::<f64>().ok().map(|f| f as i64)),
        _ => None,
    }
}

fn loose_f64(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => {
            let s = s.trim();
            if s.is_empty() { None } else { s.parse::<f64>().ok() }
        }
        _ => None,
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        Some(Value::String(s)) => !s.is_empty() && s != "0" && s.to_lowercase() != "false",
        _ => false,
    }
}

pub fn build_url(base: &str, user: &str, pass: &str, action: Option<&str>, params: &[(&str, String)]) -> Result<String> {
    let mut url = reqwest::Url::parse(&format!("{base}/player_api.php"))
        .map_err(|e| anyhow!("Ungültige Server-URL: {e}"))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("username", user);
        q.append_pair("password", pass);
        if let Some(a) = action {
            q.append_pair("action", a);
        }
        for (k, v) in params {
            q.append_pair(k, v);
        }
        // Per Xtream standard: some older portals default to XML, force JSON.
        q.append_pair("format", "json");
    }
    Ok(url.to_string())
}

struct AttemptError {
    reached: bool,
    msg: String,
}

async fn try_login(
    client: &reqwest::Client,
    base: &str,
    username: &str,
    password: &str,
    ua: &str,
) -> Result<Session, AttemptError> {
    let url = build_url(base, username, password, None, &[]).map_err(|e| AttemptError {
        reached: false,
        msg: e.to_string(),
    })?;
    let resp = client
        .get(&url)
        .header("User-Agent", ua)
        .header("Accept", "application/json,text/plain,*/*")
        .header("Accept-Language", "de,en-US;q=0.8,en;q=0.6")
        .header("Connection", "keep-alive")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| AttemptError {
            reached: false,
            msg: format!("nicht erreichbar ({e})"),
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let snippet: String = text.chars().take(220).collect::<String>().replace(['\r', '\n'], " ");
    let tail = if snippet.is_empty() {
        String::new()
    } else {
        format!(" – {snippet}")
    };
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => " (nicht autorisiert)",
            403 => " (Zugriff verweigert – oft VPN-/Datacenter-IP oder Geo-Sperre)",
            429 => " (zu viele Anfragen – bitte ~15 Min warten)",
            444 => " (Verbindung ohne Antwort geschlossen – Client/IP gesperrt)",
            511 => " (Netzwerk-Authentifizierung nötig – Captive Portal/VPN/Proxy)",
            513 => " (nicht standardisiert – Panels/Proxies nutzen das als Blockade-Code)",
            520 | 521 | 522 | 523 | 524 => " (CDN/Origin-Fehler)",
            _ => "",
        };
        return Err(AttemptError {
            reached: true,
            msg: format!("HTTP {}{}{}", status.as_u16(), hint, tail),
        });
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| AttemptError {
        reached: true,
        msg: format!("keine gültige Xtream-Antwort (kein JSON){tail}"),
    })?;
    let user_info = v.get("user_info").cloned().unwrap_or(Value::Null);
    if user_info.is_null() {
        return Err(AttemptError {
            reached: true,
            msg: format!("Antwort ohne user_info{tail}"),
        });
    }
    let auth = loose_str(user_info.get("auth"));
    if auth.is_some() && auth.as_deref() != Some("1") {
        return Err(AttemptError {
            reached: true,
            msg: "Zugangsdaten abgelehnt (auth != 1)".into(),
        });
    }
    if let Some(st) = loose_str(user_info.get("status")) {
        if !st.is_empty() && !st.eq_ignore_ascii_case("active") {
            return Err(AttemptError {
                reached: true,
                msg: format!("Konto nicht aktiv (Status: {st})"),
            });
        }
    }

    let mut allowed: Vec<String> = Vec::new();
    if let Some(arr) = user_info.get("allowed_output_formats").and_then(|a| a.as_array()) {
        for e in arr {
            if let Some(s) = e.as_str() {
                allowed.push(s.to_string());
            }
        }
    }
    if allowed.is_empty() {
        allowed = vec!["ts".into(), "m3u8".into()];
    }
    Ok(Session {
        creds: Credentials {
            base_url: base.to_string(),
            username: username.to_string(),
            password: password.to_string(),
        },
        user_info,
        server_info: v.get("server_info").cloned().unwrap_or(Value::Null),
        allowed_exts: allowed,
        ua: ua.to_string(),
        source: "xtream".to_string(),
        m3u_url: None,
    })
}

pub async fn login(client: &reqwest::Client, creds: &Credentials) -> Result<Session> {
    let base = normalize_base(&creds.base_url);
    let mut bases = vec![base.clone()];
    if let Some(alt) = alternate_scheme(&base) {
        if alt != base {
            bases.push(alt);
        }
    }

    let mut attempts: Vec<String> = Vec::new();
    let mut reached_any = false;

    // Phase 1: try both schemes with a browser user agent.
    for b in &bases {
        match try_login(client, b, &creds.username, &creds.password, UA).await {
            Ok(s) => return Ok(s),
            Err(e) => {
                reached_any |= e.reached;
                attempts.push(format!("  • {} [browser] → {}", b, e.msg));
            }
        }
    }

    // Phase 2: if the host is reachable but rejected the browser UA, try player UAs.
    if reached_any {
        for ua in [UA_VLC, UA_SMARTERS] {
            match try_login(client, &base, &creds.username, &creds.password, ua).await {
                Ok(s) => return Ok(s),
                Err(e) => attempts.push(format!("  • {} [{}] → {}", base, ua_label(ua), e.msg)),
            }
        }
    }

    Err(anyhow!(
        "Login fehlgeschlagen. Alle Versuche:\n{}\n\nBitte Server-URL, Benutzer und Passwort prüfen. \
Läuft der Server evtl. auf einem anderen Port oder nur über HTTPS?",
        attempts.join("\n")
    ))
}

#[derive(Clone)]
pub struct Probe {
    pub status: Option<u16>,
    pub ok: bool,
    pub content_type: Option<String>,
    pub snippet: String,
    pub elapsed_ms: u128,
    pub error: Option<String>,
}

pub async fn probe(client: &reqwest::Client, url: &str, ua: &str) -> Probe {
    let start = std::time::Instant::now();
    match client
        .get(url)
        .header("User-Agent", ua)
        .header("Accept", "*/*")
        .timeout(Duration::from_secs(12))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let text = resp.text().await.unwrap_or_default();
            Probe {
                status: Some(status.as_u16()),
                ok: status.is_success(),
                content_type,
                snippet: text.chars().take(240).collect::<String>().replace(['\r', '\n'], " "),
                elapsed_ms: start.elapsed().as_millis(),
                error: None,
            }
        }
        Err(e) => Probe {
            status: None,
            ok: false,
            content_type: None,
            snippet: String::new(),
            elapsed_ms: start.elapsed().as_millis(),
            error: Some(e.to_string()),
        },
    }
}

async fn api(
    client: &reqwest::Client,
    session: &Session,
    action: &str,
    params: &[(&str, String)],
) -> Result<Value> {
    let url = build_url(
        &session.creds.base_url,
        &session.creds.username,
        &session.creds.password,
        Some(action),
        params,
    )?;
    let text = client
        .get(&url)
        .header("User-Agent", &session.ua)
        .timeout(Duration::from_secs(60))
        .send()
        .await?
        .text()
        .await?;
    if text.trim().is_empty() {
        return Ok(Value::Array(vec![]));
    }
    serde_json::from_str(&text).map_err(|e| anyhow!("Antwort von '{action}' nicht lesbar: {e}"))
}

pub async fn categories(client: &reqwest::Client, session: &Session, kind: &str) -> Result<Vec<Category>> {
    let action = match norm_kind(kind) {
        "live" => "get_live_categories",
        "series" => "get_series_categories",
        _ => "get_vod_categories",
    };
    let v = api(client, session, action, &[]).await?;
    let mut out = Vec::new();
    if let Some(arr) = v.as_array() {
        for c in arr {
            let id = loose_str(c.get("category_id")).unwrap_or_default();
            let name = loose_str(c.get("category_name")).unwrap_or_default();
            if !id.is_empty() {
                out.push(Category { id, name });
            }
        }
    }
    Ok(out)
}

pub async fn list(client: &reqwest::Client, session: &Session, kind: &str) -> Result<Vec<MediaItem>> {
    let nk = norm_kind(kind);
    let action = match nk {
        "live" => "get_live_streams",
        "series" => "get_series",
        _ => "get_vod_streams",
    };
    let item_kind = match nk {
        "series" => "series",
        "live" => "live",
        _ => "movie",
    };
    let v = api(client, session, action, &[]).await?;
    let mut out = Vec::new();
    let arr = match v.as_array() {
        Some(a) => a,
        None => return Ok(out),
    };
    for it in arr {
        let (id, cover, ext) = if nk == "series" {
            (
                loose_str(it.get("series_id")),
                loose_str(it.get("cover")),
                None,
            )
        } else if nk == "live" {
            (
                loose_str(it.get("stream_id")),
                loose_str(it.get("stream_icon")),
                Some("ts".to_string()),
            )
        } else {
            (
                loose_str(it.get("stream_id")),
                loose_str(it.get("stream_icon")).or_else(|| loose_str(it.get("movie_image"))),
                loose_str(it.get("container_extension")),
            )
        };
        let Some(id) = id else { continue };
        let name = loose_str(it.get("name")).unwrap_or_else(|| format!("Unbenannt #{id}"));
        let rating = {
            let r = loose_f64(it.get("rating"));
            r.filter(|x| *x > 0.0)
        };
        out.push(MediaItem {
            id,
            kind: item_kind.to_string(),
            name,
            cover,
            category_id: loose_str(it.get("category_id")),
            extension: ext,
            added: loose_i64(it.get("added")),
            rating,
            epg_channel_id: loose_str(it.get("epg_channel_id")),
            tv_archive: truthy(it.get("tv_archive")),
            url: None,
        });
    }
    Ok(out)
}

pub async fn movie_detail(client: &reqwest::Client, session: &Session, id: &str) -> Result<MovieDetail> {
    let v = api(client, session, "get_vod_info", &[("vod_id", id.to_string())]).await?;
    let info = v.get("info").cloned().unwrap_or(Value::Null);
    let movie_data = v.get("movie_data").cloned().unwrap_or(Value::Null);

    let name = loose_str(movie_data.get("name"))
        .or_else(|| loose_str(info.get("name")))
        .or_else(|| loose_str(info.get("o_name")))
        .unwrap_or_else(|| format!("Film #{id}"));
    let cover = loose_str(info.get("movie_image"))
        .or_else(|| loose_str(info.get("cover_big")))
        .or_else(|| loose_str(movie_data.get("stream_icon")));
    let backdrop = info
        .get("backdrop_path")
        .and_then(|b| b.as_array())
        .and_then(|a| a.first())
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    let ext = loose_str(movie_data.get("container_extension"))
        .or_else(|| loose_str(info.get("container_extension")))
        .unwrap_or_else(|| "mp4".to_string());

    let detail = Detail {
        plot: loose_str(info.get("plot")).or_else(|| loose_str(info.get("description"))),
        cast: split_cast(loose_str(info.get("cast"))),
        director: loose_str(info.get("director")),
        genre: loose_str(info.get("genre")),
        duration: loose_str(info.get("duration")),
        release_date: loose_str(info.get("releasedate")).or_else(|| loose_str(info.get("releaseDate"))),
        trailer: loose_str(info.get("youtube_trailer")),
        backdrop,
        rating: loose_f64(info.get("rating")).filter(|x| *x > 0.0),
        container_extension: Some(ext.clone()),
        country: loose_str(info.get("country")),
        age: loose_str(info.get("age")),
    };

    let item = MediaItem {
        id: id.to_string(),
        kind: "movie".into(),
        name,
        cover,
        category_id: loose_str(movie_data.get("category_id")).or_else(|| loose_str(info.get("category_id"))),
        extension: Some(ext),
        added: loose_i64(movie_data.get("added")),
        rating: detail.rating,
        epg_channel_id: None,
        tv_archive: false,
        url: None,
    };
    Ok(MovieDetail { item, detail, seasons: vec![] })
}

pub async fn series_detail(client: &reqwest::Client, session: &Session, id: &str) -> Result<MovieDetail> {
    let v = api(client, session, "get_series_info", &[("series_id", id.to_string())]).await?;
    let info = v.get("info").cloned().unwrap_or(Value::Null);

    let name = loose_str(info.get("name")).unwrap_or_else(|| format!("Serie #{id}"));
    let cover = loose_str(info.get("cover"));
    let backdrop = info
        .get("backdrop_path")
        .and_then(|b| b.as_array())
        .and_then(|a| a.first())
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    let rating = loose_f64(info.get("rating"))
        .filter(|x| *x > 0.0)
        .or_else(|| loose_f64(info.get("rating_5based")).map(|r| r * 2.0));

    let detail = Detail {
        plot: loose_str(info.get("plot")),
        cast: split_cast(loose_str(info.get("cast"))),
        director: loose_str(info.get("director")),
        genre: loose_str(info.get("genre")),
        duration: loose_str(info.get("episode_run_time")),
        release_date: loose_str(info.get("releaseDate")),
        trailer: loose_str(info.get("youtube_trailer")),
        backdrop,
        rating,
        container_extension: None,
        country: loose_str(info.get("country")),
        age: loose_str(info.get("age")),
    };

    // seasons metadata (names/covers) if present
    let mut season_meta: std::collections::HashMap<i32, (String, Option<String>)> = Default::default();
    if let Some(arr) = v.get("seasons").and_then(|s| s.as_array()) {
        for s in arr {
            let num = loose_i64(s.get("season_number")).unwrap_or(0) as i32;
            let sname = loose_str(s.get("name")).unwrap_or_else(|| format!("Staffel {num}"));
            let scover = loose_str(s.get("cover")).or_else(|| loose_str(s.get("cover_big")));
            season_meta.insert(num, (sname, scover));
        }
    }

    let mut seasons: Vec<Season> = Vec::new();
    if let Some(map) = v.get("episodes").and_then(|e| e.as_object()) {
        for (season_key, eps) in map {
            let season_num: i32 = season_key.parse().unwrap_or(0);
            let mut list: Vec<Episode> = Vec::new();
            if let Some(arr) = eps.as_array() {
                for ep in arr {
                    let einfo = ep.get("info").cloned().unwrap_or(Value::Null);
                    let eid = loose_str(ep.get("id")).unwrap_or_default();
                    if eid.is_empty() {
                        continue;
                    }
                    let num = loose_i64(ep.get("episode_num"))
                        .or_else(|| loose_i64(einfo.get("episode_num")))
                        .unwrap_or(0) as i32;
                    let title = loose_str(ep.get("title"))
                        .or_else(|| loose_str(einfo.get("name")))
                        .unwrap_or_else(|| format!("Episode {num}"));
                    let eext = loose_str(ep.get("container_extension"))
                        .or_else(|| loose_str(einfo.get("container_extension")))
                        .unwrap_or_else(|| "mp4".to_string());
                    list.push(Episode {
                        id: eid,
                        num,
                        title,
                        plot: loose_str(einfo.get("plot")).or_else(|| loose_str(einfo.get("overview"))),
                        cover: loose_str(einfo.get("movie_image")).or_else(|| loose_str(einfo.get("cover_big"))),
                        duration: loose_str(einfo.get("duration")),
                        rating: loose_f64(einfo.get("rating")).filter(|x| *x > 0.0),
                        release_date: loose_str(einfo.get("releasedate")),
                        extension: eext,
                    });
                }
            }
            list.sort_by_key(|e| e.num);
            let (sname, scover) = season_meta
                .get(&season_num)
                .cloned()
                .unwrap_or_else(|| (format!("Staffel {season_num}"), cover.clone()));
            seasons.push(Season { number: season_num, name: sname, cover: scover, episodes: list });
        }
    }
    seasons.sort_by_key(|s| s.number);

    let item = MediaItem {
        id: id.to_string(),
        kind: "series".into(),
        name,
        cover,
        category_id: loose_str(info.get("category_id")),
        extension: None,
        added: None,
        rating,
        epg_channel_id: None,
        tv_archive: false,
        url: None,
    };
    Ok(MovieDetail { item, detail, seasons })
}

pub async fn short_epg(client: &reqwest::Client, session: &Session, stream_id: &str, limit: usize) -> Result<Vec<EpgEntry>> {
    let v = api(
        client,
        session,
        "get_short_epg",
        &[("stream_id", stream_id.to_string()), ("limit", limit.to_string())],
    )
    .await?;
    Ok(parse_epg(&v))
}

pub async fn full_epg(client: &reqwest::Client, session: &Session, stream_id: &str) -> Result<Vec<EpgEntry>> {
    let v = api(client, session, "get_simple_data_table", &[("stream_id", stream_id.to_string())]).await?;
    Ok(parse_epg(&v))
}

fn parse_epg(v: &Value) -> Vec<EpgEntry> {
    let now = now_unix();
    let mut out = Vec::new();
    if let Some(arr) = v.get("epg_listings").and_then(|e| e.as_array()) {
        for e in arr {
            let title = decode_b64(loose_str(e.get("title")).unwrap_or_default());
            let description = decode_b64(loose_str(e.get("description")).unwrap_or_default());
            let start_ts = loose_i64(e.get("start_timestamp")).or_else(|| loose_i64(e.get("start")));
            let stop_ts = loose_i64(e.get("stop_timestamp")).or_else(|| loose_i64(e.get("end")));
            let now_playing = match (start_ts, stop_ts) {
                (Some(s), Some(en)) => s <= now && now < en,
                _ => false,
            };
            out.push(EpgEntry {
                title,
                description,
                start: loose_str(e.get("start")),
                end: loose_str(e.get("end")),
                start_ts,
                stop_ts,
                now_playing,
                has_archive: loose_i64(e.get("has_archive")).unwrap_or(0) as i32,
            });
        }
    }
    out.sort_by_key(|e| e.start_ts.unwrap_or(0));
    out
}

fn decode_b64(s: String) -> String {
    use base64::Engine;
    if s.is_empty() {
        return s;
    }
    base64::engine::general_purpose::STANDARD
        .decode(s.as_bytes())
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or(s)
}

pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn stream_url(session: &Session, kind: &str, id: &str, ext: &str) -> String {
    let c = &session.creds;
    let path = match kind {
        "live" => "live",
        "series" => "series",
        _ => "movie",
    };
    format!(
        "{}/{}/{}/{}/{}.{}",
        c.base_url, path, c.username, c.password, id, ext
    )
}

pub fn preferred_ext(session: &Session, kind: &str, item_ext: Option<&str>) -> String {
    if kind == "live" {
        if session.allowed_exts.iter().any(|e| e == "m3u8") {
            "m3u8".to_string()
        } else {
            "ts".to_string()
        }
    } else {
        item_ext
            .filter(|e| !e.is_empty())
            .map(|e| e.to_string())
            .unwrap_or_else(|| "mp4".to_string())
    }
}

fn split_cast(raw: Option<String>) -> Vec<String> {
    match raw {
        Some(s) => s
            .split([',', ';'])
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .take(24)
            .collect(),
        None => vec![],
    }
}
