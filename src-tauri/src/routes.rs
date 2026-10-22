//! Local HTTP API (axum): catalog browsing, detail enrichment, streaming proxy.
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;

use crate::adult;
use crate::m3u;
use crate::proxy;
use crate::remux::DecodeCaps;
use crate::state::{App, Config};
use crate::xtream::{self, Credentials, MediaItem};

pub struct ApiError(pub String);

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError(e.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_GATEWAY, Json(json!({ "error": self.0 }))).into_response()
    }
}

type ApiResult = Result<Json<Value>, ApiError>;

fn parse_year(s: Option<&str>) -> Option<i32> {
    let s = s?;
    if s.len() >= 4 {
        s[..4].parse::<i32>().ok()
    } else {
        None
    }
}

fn cmp_rating(a: &MediaItem, b: &MediaItem) -> Ordering {
    b.rating
        .unwrap_or(0.0)
        .partial_cmp(&a.rating.unwrap_or(0.0))
        .unwrap_or(Ordering::Equal)
}

/// Language prefix some panels put in front of a title ("DE - …", "AT| …",
/// "US (Paramount 062) | …"). Only two uppercase letters followed by a separator
/// count, so ordinary titles are not mistaken for a language.
fn name_lang(name: &str) -> Option<String> {
    let head = name
        .split(|c: char| c == '-' || c == '|')
        .next()?
        .trim();
    let mut chars = head.chars();
    let a = chars.next()?;
    let b = chars.next()?;
    if !(a.is_ascii_uppercase() && b.is_ascii_uppercase()) {
        return None;
    }
    match chars.next() {
        None => Some(format!("{a}{b}")),
        Some(c) if c == ' ' || c == '(' => Some(format!("{a}{b}")),
        _ => None,
    }
}

/// Seed for the banner shuffle - it only has to differ between requests.
fn seed_from_clock() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15)
}

/// Fisher-Yates with a xorshift64 generator. Avoids pulling in `rand` for what
/// only exists to make the banner show a different set of films each time.
fn shuffle<T>(items: &mut [T], seed: u64) {
    let mut s = seed | 1;
    for i in (1..items.len()).rev() {
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        let j = (s.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 33) as usize % (i + 1);
        items.swap(i, j);
    }
}

// ---------------- system ----------------

async fn health(State(app): State<Arc<App>>) -> Json<Value> {
    let counts = {
        let c = app.catalog.read().await;
        let m: HashMap<String, usize> = c.iter().map(|(k, v)| (k.clone(), v.items.len())).collect();
        m
    };
    let ratings_loaded = app.ratings.read().await.loaded();
    Json(json!({
        "ok": true,
        "logged_in": app.is_logged_in().await,
        "catalog": counts,
        "ratings_loaded": ratings_loaded,
        "ffmpeg": app.remux.ffmpeg_path(),
        "ffprobe": app.remux.ffprobe_path(),
        "capabilities": app.capabilities.read().await.clone(),
        "last_remux": app.remux.last_decision(),
    }))
}

/// Capability report of the running webview. The probe has to happen in the UI,
/// because only the webview knows what its platform can actually decode.
async fn capabilities_put(State(app): State<Arc<App>>, Json(v): Json<Value>) -> ApiResult {
    *app.capabilities.write().await = v;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct LoginReq {
    base_url: String,
    username: String,
    password: String,
}

async fn login(State(app): State<Arc<App>>, Json(req): Json<LoginReq>) -> ApiResult {
    let username = req.username.trim().to_string();
    let password = req.password.trim().to_string();
    if username.is_empty() || password.is_empty() {
        return Err(ApiError("Username and password required.".into()));
    }
    let creds = Credentials {
        base_url: xtream::normalize_base(&req.base_url),
        username,
        password,
    };
    let session = xtream::login(&app.client, &creds).await?;
    let cfg = Config {
        base_url: Some(creds.base_url.clone()),
        username: Some(creds.username.clone()),
        password: Some(creds.password.clone()),
        m3u_url: None,
    };
    let _ = app.save_config(&cfg);
    let user_info = session.user_info.clone();
    let server_info = session.server_info.clone();
    let allowed_exts = session.allowed_exts.clone();
    app.set_session(session).await;
    app.invalidate_catalog().await;
    app.ensure_ratings();
    let me = app.clone();
    tokio::spawn(async move {
        for k in ["vod", "series", "live"] {
            if let Err(e) = me.ensure_catalog(k, false).await {
                eprintln!("[babyflix] prefetch {k} failed: {e}");
            }
        }
    });
    Ok(Json(json!({
        "ok": true,
        "user_info": user_info,
        "server_info": server_info,
        "allowed_exts": allowed_exts,
    })))
}

async fn logout(State(app): State<Arc<App>>) -> Json<Value> {
    *app.session.write().await = None;
    let _ = app.save_config(&Config::default());
    Json(json!({ "ok": true }))
}

async fn session_info(State(app): State<Arc<App>>) -> Json<Value> {
    match app.session().await {
        Some(s) => Json(json!({
            "logged_in": true,
            "source": s.source,
            "m3u_url": s.m3u_url,
            "user_info": s.user_info,
            "server_info": s.server_info,
            "allowed_exts": s.allowed_exts,
        })),
        None => Json(json!({ "logged_in": false })),
    }
}

#[derive(Deserialize)]
struct M3uReq {
    url: String,
}

async fn login_m3u(State(app): State<Arc<App>>, Json(req): Json<M3uReq>) -> ApiResult {
    let url = req.url.trim().to_string();
    if url.is_empty() {
        return Err(ApiError("M3U URL required.".into()));
    }
    app.login_m3u(&url).await?;
    app.ensure_ratings();
    let counts = {
        let c = app.catalog.read().await;
        json!({
            "live": c.get("live").map(|x| x.items.len()).unwrap_or(0),
            "movies": c.get("vod").map(|x| x.items.len()).unwrap_or(0),
            "series": c.get("series").map(|x| x.items.len()).unwrap_or(0),
        })
    };
    Ok(Json(json!({ "ok": true, "source": "m3u", "counts": counts })))
}

// ---------------- catalog ----------------

/// Category list for `kind`: from the panel (Xtream) or derived from the
/// catalog (M3U, where the group name doubles as the category id).
async fn all_categories(app: &Arc<App>, kind: &str) -> Result<Vec<xtream::Category>, ApiError> {
    if app.is_m3u().await {
        let items = app.ensure_catalog(kind, false).await?;
        return Ok(m3u::categories_from(items.as_slice()));
    }
    let s = app.session().await.ok_or(ApiError("Not signed in.".into()))?;
    Ok(xtream::categories(&app.client, &s, kind).await?)
}

/// Ids of the categories that count as adult content for `kind`.
///
/// Never fails a request: when the category list cannot be loaded, nothing is
/// filtered - the page keeps working instead of returning an error.
async fn adult_category_ids(app: &Arc<App>, kind: &str) -> HashSet<String> {
    match all_categories(app, kind).await {
        Ok(cats) => cats
            .into_iter()
            .filter(|c| adult::is_adult_category(&c.name))
            .map(|c| c.id)
            .collect(),
        Err(_) => HashSet::new(),
    }
}

/// Does the item belong to one of the given (adult) category ids?
fn in_categories(it: &MediaItem, ids: &HashSet<String>) -> bool {
    !ids.is_empty() && it.category_id.as_deref().is_some_and(|c| ids.contains(c))
}

#[derive(Deserialize)]
struct KindQ {
    kind: String,
    #[serde(default)]
    hide_adult: Option<bool>,
}

async fn categories(State(app): State<Arc<App>>, Query(q): Query<KindQ>) -> ApiResult {
    let mut cats = all_categories(&app, &q.kind).await?;
    if q.hide_adult.unwrap_or(true) {
        cats.retain(|c| !adult::is_adult_category(&c.name));
    }
    Ok(Json(json!({ "categories": cats })))
}

#[derive(Deserialize)]
struct BrowseQ {
    kind: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    page: Option<usize>,
    #[serde(default)]
    page_size: Option<usize>,
    #[serde(default)]
    hide_adult: Option<bool>,
}

async fn browse(State(app): State<Arc<App>>, Query(bq): Query<BrowseQ>) -> ApiResult {
    let items = app.ensure_catalog(&bq.kind, false).await?;
    let adult_ids = if bq.hide_adult.unwrap_or(true) {
        adult_category_ids(&app, &bq.kind).await
    } else {
        HashSet::new()
    };
    let q = bq.q.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    let mut list: Vec<&MediaItem> = items
        .iter()
        .filter(|it| {
            if in_categories(it, &adult_ids) {
                return false;
            }
            if let Some(c) = &bq.category {
                if it.category_id.as_deref() != Some(c.as_str()) {
                    return false;
                }
            }
            if let Some(q) = &q {
                if !it.name.to_lowercase().contains(q) {
                    return false;
                }
            }
            true
        })
        .collect();
    match bq.sort.as_deref() {
        Some("name") => list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
        Some("rating") => list.sort_by(|a, b| cmp_rating(a, b)),
        Some("added") | None => list.sort_by(|a, b| b.added.unwrap_or(0).cmp(&a.added.unwrap_or(0))),
        _ => {}
    }
    let total = list.len();
    let page = bq.page.unwrap_or(1).max(1);
    let ps = bq.page_size.unwrap_or(60).clamp(1, 300);
    let start = (page - 1) * ps;
    let slice: Vec<&MediaItem> = list.into_iter().skip(start).take(ps).collect();
    Ok(Json(json!({
        "items": slice,
        "total": total,
        "page": page,
        "page_size": ps,
    })))
}

#[derive(Deserialize)]
struct HomeQ {
    #[serde(default)]
    hide_adult: Option<bool>,
    /// Restrict the banner to one language prefix ("DE", "EN", …).
    #[serde(default)]
    lang: Option<String>,
}

async fn home(State(app): State<Arc<App>>, Query(q): Query<HomeQ>) -> ApiResult {
    // Looked up in parallel: the filter then costs roughly one extra panel
    // round-trip instead of three.
    let (vod_adult, series_adult, live_adult) = if q.hide_adult.unwrap_or(true) {
        tokio::join!(
            adult_category_ids(&app, "vod"),
            adult_category_ids(&app, "series"),
            adult_category_ids(&app, "live")
        )
    } else {
        (HashSet::new(), HashSet::new(), HashSet::new())
    };

    let vod = app.ensure_catalog("vod", false).await?;
    let series = app.ensure_catalog("series", false).await?;
    let live = app.ensure_catalog("live", false).await?;

    let mut recent: Vec<&MediaItem> = vod
        .iter()
        .filter(|i| i.cover.is_some() && !in_categories(i, &vod_adult))
        .collect();
    recent.sort_by(|a, b| b.added.unwrap_or(0).cmp(&a.added.unwrap_or(0)));
    let recent: Vec<&MediaItem> = recent.into_iter().take(30).collect();

    let mut top: Vec<&MediaItem> = vod
        .iter()
        .filter(|i| {
            i.rating.unwrap_or(0.0) >= 7.0 && i.cover.is_some() && !in_categories(i, &vod_adult)
        })
        .collect();
    top.sort_by(|a, b| cmp_rating(a, b));
    let top: Vec<&MediaItem> = top.iter().copied().take(30).collect();
    // The banner shows a *different* handful of the "top rated" row on every load
    // instead of always the same first six films - optionally restricted to one
    // language prefix. The row itself stays mixed.
    let want_lang = q
        .lang
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    let mut pool: Vec<&MediaItem> = match want_lang {
        Some(lang) => top
            .iter()
            .copied()
            .filter(|i| name_lang(&i.name).as_deref() == Some(lang))
            .collect(),
        None => top.clone(),
    };
    if pool.is_empty() {
        // Nothing of that language in the row - never leave the banner empty.
        pool = top.clone();
    }
    shuffle(&mut pool, seed_from_clock());
    let hero: Vec<&MediaItem> = pool.into_iter().take(6).collect();

    // Language prefixes the panel uses ("DE - …", "AT| …"), sampled from the
    // catalog so the selector only offers what actually exists.
    let langs: Vec<Value> = {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for it in vod.iter().take(20_000) {
            if let Some(l) = name_lang(&it.name) {
                *counts.entry(l).or_insert(0) += 1;
            }
        }
        let mut list: Vec<(String, usize)> = counts.into_iter().collect();
        list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        list.into_iter()
            .take(24)
            .map(|(code, count)| json!({ "code": code, "count": count }))
            .collect()
    };

    let mut s: Vec<&MediaItem> = series
        .iter()
        .filter(|i| i.cover.is_some() && !in_categories(i, &series_adult))
        .collect();
    s.sort_by(|a, b| cmp_rating(a, b));
    let series_row: Vec<&MediaItem> = s.into_iter().take(30).collect();

    let live_row: Vec<&MediaItem> = live
        .iter()
        .filter(|i| !in_categories(i, &live_adult))
        .take(30)
        .collect();

    let mut rows: Vec<Value> = vec![];
    if !recent.is_empty() {
        rows.push(json!({ "title": "Neu hinzugefügt", "kind": "movie", "items": recent }));
    }
    if !top.is_empty() {
        rows.push(json!({ "title": "Top bewertet – Filme", "kind": "movie", "items": top }));
    }
    if !series_row.is_empty() {
        rows.push(json!({ "title": "Serien-Highlights", "kind": "series", "items": series_row }));
    }
    if !live_row.is_empty() {
        rows.push(json!({ "title": "Live-TV", "kind": "live", "items": live_row }));
    }

    // category rows for movies
    let mut counts: HashMap<String, usize> = HashMap::new();
    for it in vod.iter() {
        if it.cover.is_none() || in_categories(it, &vod_adult) {
            continue;
        }
        if let Some(c) = &it.category_id {
            *counts.entry(c.clone()).or_insert(0) += 1;
        }
    }
    let mut cats: Vec<(String, usize)> = counts.into_iter().collect();
    cats.sort_by(|a, b| b.1.cmp(&a.1));
    for (cid, count) in cats.into_iter().take(5) {
        if count < 12 {
            continue;
        }
        let mut items: Vec<&MediaItem> = vod
            .iter()
            .filter(|i| {
                i.category_id.as_deref() == Some(cid.as_str())
                    && i.cover.is_some()
                    && !in_categories(i, &vod_adult)
            })
            .collect();
        items.sort_by(|a, b| b.added.unwrap_or(0).cmp(&a.added.unwrap_or(0)));
        items.truncate(24);
        rows.push(json!({ "title": null, "category_id": cid, "kind": "movie", "items": items }));
    }

    Ok(Json(json!({ "hero": hero, "rows": rows, "langs": langs })))
}

// ---------------- detail ----------------

#[derive(Deserialize)]
struct DetailQ {
    kind: String,
    id: String,
}

async fn detail(State(app): State<Arc<App>>, Query(q): Query<DetailQ>) -> ApiResult {
    if app.is_m3u().await {
        return m3u_detail(&app, &q).await;
    }
    let s = app.session().await.ok_or(ApiError("Not signed in.".into()))?;
    // A panel that answers a detail request with a web page (broken id, blocked
    // request, rate limit, expired session) must not turn the page into a dead
    // end. Fall back to what the catalog already knows and mark the result as
    // incomplete, so the UI can say that the detail data is missing.
    let mut incomplete = false;
    let mut md = if q.kind == "series" {
        match xtream::series_detail(&app.client, &s, &q.id).await {
            Ok(md) => md,
            Err(e) => match app.find_item(&q.id).await {
                Some(item) => {
                    eprintln!("[babyflix] series detail unavailable for {}: {e}", q.id);
                    incomplete = true;
                    xtream::MovieDetail {
                        item,
                        detail: Default::default(),
                        seasons: Vec::new(),
                    }
                }
                None => return Err(ApiError::from(e)),
            },
        }
    } else {
        match xtream::movie_detail(&app.client, &s, &q.id).await {
            Ok(md) => md,
            Err(e) => match app.find_item(&q.id).await {
                Some(item) => {
                    eprintln!("[babyflix] movie detail unavailable for {}: {e}", q.id);
                    incomplete = true;
                    xtream::MovieDetail {
                        item,
                        detail: Default::default(),
                        seasons: Vec::new(),
                    }
                }
                None => return Err(ApiError::from(e)),
            },
        }
    };
    // enrich with keyless IMDb (rating/votes/poster/cast)
    let year = parse_year(md.detail.release_date.as_deref());
    let imdb = app.imdb_enrich(&md.item.name, year, &q.kind).await;
    if let Some(i) = &imdb {
        if md.item.cover.is_none() {
            md.item.cover = i.image.clone();
        }
        if md.detail.plot.is_none() {
            md.detail.plot = i.plot.clone();
        }
        if md.detail.cast.is_empty() && !i.cast.is_empty() {
            md.detail.cast = i.cast.clone();
        }
        if md.detail.director.is_none() {
            md.detail.director = i.director.clone();
        }
        if md.detail.rating.is_none() {
            md.detail.rating = i.rating;
        }
    }
    Ok(Json(json!({
        "item": md.item,
        "detail": md.detail,
        "seasons": md.seasons,
        "imdb": imdb,
        "incomplete": incomplete,
    })))
}

/// Detail for M3U-sourced items: metadata from the playlist + keyless IMDb enrichment.
async fn m3u_detail(app: &Arc<App>, q: &DetailQ) -> Result<Json<Value>, ApiError> {
    let item = app
        .find_item(&q.id)
        .await
        .ok_or(ApiError("Item not found.".into()))?;
    let kind = if item.kind == "series" { "series" } else { "movie" };
    let imdb = app.imdb_enrich(&item.name, None, kind).await;

    let mut detail = xtream::Detail::default();
    let mut cover = item.cover.clone();
    if let Some(i) = &imdb {
        detail.plot = i.plot.clone();
        detail.cast = i.cast.clone();
        detail.director = i.director.clone();
        detail.rating = i.rating;
        detail.backdrop = i.image.clone();
        if !i.genres.is_empty() {
            detail.genre = Some(i.genres.join(", "));
        }
        if cover.is_none() {
            cover = i.image.clone();
        }
    }
    if detail.rating.is_none() {
        detail.rating = item.rating;
    }

    let mut it = item.clone();
    it.cover = cover.clone();

    let seasons = if it.kind == "series" {
        vec![xtream::Season {
            number: 1,
            name: "Staffel 1".to_string(),
            cover: cover.clone(),
            episodes: vec![xtream::Episode {
                id: it.id.clone(),
                num: 1,
                title: it.name.clone(),
                plot: detail.plot.clone(),
                cover: cover.clone(),
                duration: None,
                rating: detail.rating,
                release_date: None,
                extension: it.extension.clone().unwrap_or_else(|| "m3u8".to_string()),
            }],
        }]
    } else {
        vec![]
    };

    Ok(Json(json!({ "item": it, "detail": detail, "seasons": seasons, "imdb": imdb, "incomplete": false })))
}

#[derive(Deserialize)]
struct EpgQ {
    stream_id: String,
    #[serde(default)]
    channel_id: Option<String>,
    #[serde(default)]
    full: Option<bool>,
    #[serde(default)]
    limit: Option<usize>,
}

async fn epg(State(app): State<Arc<App>>, Query(q): Query<EpgQ>) -> ApiResult {
    let s = app.session().await.ok_or(ApiError("Not signed in.".into()))?;
    let full = q.full.unwrap_or(false);
    let mut list = if full {
        xtream::full_epg(&app.client, &s, &q.stream_id).await?
    } else {
        xtream::short_epg(&app.client, &s, &q.stream_id, q.limit.unwrap_or(12)).await?
    };
    // Some portals only serve EPG by epg_channel_id, not stream_id.
    if list.is_empty() {
        if let Some(ch) = q.channel_id.as_ref().filter(|c| !c.is_empty() && **c != q.stream_id) {
            list = if full {
                xtream::full_epg(&app.client, &s, ch).await?
            } else {
                xtream::short_epg(&app.client, &s, ch, q.limit.unwrap_or(12)).await?
            };
        }
    }
    Ok(Json(json!({ "epg": list })))
}

// ---------------- imdb enrichment ----------------

#[derive(Deserialize)]
struct EnrichQ {
    title: String,
    #[serde(default)]
    year: Option<i32>,
    #[serde(default)]
    kind: Option<String>,
}

async fn enrich(State(app): State<Arc<App>>, Query(q): Query<EnrichQ>) -> Json<Value> {
    let info = app
        .imdb_enrich(&q.title, q.year, q.kind.as_deref().unwrap_or("movie"))
        .await;
    Json(json!({ "imdb": info }))
}

#[derive(Deserialize)]
struct BatchItem {
    title: String,
    #[serde(default)]
    year: Option<i32>,
    #[serde(default)]
    kind: Option<String>,
}

async fn enrich_batch(State(app): State<Arc<App>>, Json(items): Json<Vec<BatchItem>>) -> Json<Value> {
    let sem = Arc::new(tokio::sync::Semaphore::new(5));
    let mut handles = Vec::new();
    for (idx, it) in items.into_iter().take(60).enumerate() {
        let app = app.clone();
        let sem = sem.clone();
        handles.push(tokio::spawn(async move {
            let _p = sem.acquire().await.ok();
            let info = app
                .imdb_enrich(&it.title, it.year, it.kind.as_deref().unwrap_or("movie"))
                .await;
            (idx, info)
        }));
    }
    let mut out: Vec<(usize, Option<crate::imdb::ImdbInfo>)> = Vec::new();
    for h in handles {
        if let Ok(v) = h.await {
            out.push(v);
        }
    }
    out.sort_by_key(|(i, _)| *i);
    let list: Vec<Value> = out
        .into_iter()
        .map(|(_, info)| serde_json::to_value(info).unwrap_or(Value::Null))
        .collect();
    Json(json!({ "results": list }))
}

// ---------------- refresh ----------------

async fn refresh(State(app): State<Arc<App>>) -> ApiResult {
    if app.is_m3u().await {
        app.refresh_m3u().await?;
        return Ok(Json(json!({ "ok": true })));
    }
    app.invalidate_catalog().await;
    for k in ["vod", "series", "live"] {
        app.ensure_catalog(k, true).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

// ---------------- streaming ----------------

#[derive(Deserialize)]
struct PlayerQ {
    kind: String,
    id: String,
    #[serde(default)]
    ext: Option<String>,
}

async fn player(
    State(app): State<Arc<App>>,
    Query(q): Query<PlayerQ>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let s = app.session().await.ok_or(ApiError("Not signed in.".into()))?;
    let url = play_url(&app, &s, &q.kind, &q.id, q.ext.clone()).await?;
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    proxy::proxy(&app.client, &proxy::origin(), &url, range, Some(s.ua.as_str()))
        .await
        .map_err(Into::into)
}

/// Resolve the playable URL for an item - identical for every playback engine.
async fn play_url(
    app: &Arc<App>,
    s: &xtream::Session,
    kind: &str,
    id: &str,
    ext: Option<String>,
) -> Result<String, ApiError> {
    if s.source == "m3u" {
        let item = app
            .find_item(id)
            .await
            .ok_or(ApiError("Item not found.".into()))?;
        let raw = item
            .url
            .clone()
            .ok_or(ApiError("No stream URL available for this item.".into()))?;
        Ok(m3u::hls_candidate(&app.client, &raw, &item.kind, &s.ua)
            .await
            .unwrap_or(raw))
    } else {
        let ext = ext
            .filter(|e| !e.is_empty())
            .unwrap_or_else(|| xtream::preferred_ext(s, kind, None));
        Ok(xtream::stream_url(s, kind, id, &ext))
    }
}



#[derive(Deserialize)]
struct UrlQ {
    u: String,
}

async fn proxy_h(
    State(app): State<Arc<App>>,
    Query(q): Query<UrlQ>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let url = proxy::decode_url(&q.u);
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let ua = app.session().await.map(|s| s.ua);
    proxy::proxy(&app.client, &proxy::origin(), &url, range, ua.as_deref())
        .await
        .map_err(Into::into)
}

async fn img_h(State(app): State<Arc<App>>, Query(q): Query<UrlQ>) -> Result<Response, ApiError> {
    let ua = app.session().await.map(|s| s.ua);
    proxy::proxy_image(&app.client, &proxy::decode_url(&q.u), ua.as_deref())
        .await
        .map_err(Into::into)
}

#[derive(Deserialize)]
struct DiagReq {
    base_url: String,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

async fn diagnose(State(app): State<Arc<App>>, Json(req): Json<DiagReq>) -> Json<Value> {
    let base = xtream::normalize_base(&req.base_url);
    let mut results = Vec::new();
    for ua in [xtream::UA, xtream::UA_VLC, xtream::UA_SMARTERS] {
        let url = match (&req.username, &req.password) {
            (Some(u), p) => xtream::build_url(&base, u, p.as_deref().unwrap_or(""), None, &[])
                .unwrap_or_else(|_| format!("{base}/player_api.php")),
            _ => format!("{base}/player_api.php"),
        };
        let p = xtream::probe(&app.client, &url, ua).await;
        results.push(json!({
            "base": &base,
            "ua": xtream::ua_label(ua),
            "url": url,
            "status": p.status,
            "ok": p.ok,
            "content_type": p.content_type,
            "snippet": p.snippet,
            "elapsed_ms": p.elapsed_ms,
            "error": p.error,
        }));
    }
    Json(json!({ "normalized_base": base, "results": results }))
}

#[derive(Deserialize)]
struct RemuxQ {
    kind: String,
    id: String,
    #[serde(default)]
    ext: Option<String>,
    #[serde(default)]
    audio: Option<usize>,
    /// Live pass-through for panels that only deliver raw MPEG-TS.
    #[serde(default)]
    live: Option<bool>,
    /// Restart the remux at this source second (seek beyond the prepared range).
    #[serde(default)]
    seek: Option<f64>,
}

async fn remux_start(State(app): State<Arc<App>>, Query(q): Query<RemuxQ>) -> ApiResult {
    let s = app.session().await.ok_or(ApiError("Not signed in.".into()))?;
    if !app.remux.available() {
        // First run may still be downloading FFmpeg; if the initial attempt failed
        // (e.g. offline at startup), retry it in the background.
        let app2 = app.clone();
        tokio::spawn(async move {
            app2.remux.ensure_binaries(&app2.client).await;
        });
        return Err(ApiError(
            "FFmpeg is being set up automatically - please try again in a moment. \
             If it keeps failing, install it (macOS: brew install ffmpeg, Windows: \
             winget install Gyan.FFmpeg, Linux: apt install ffmpeg) or set BABYFLIX_FFMPEG."
                .into(),
        ));
    }
    let ext = q
        .ext
        .clone()
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| xtream::preferred_ext(&s, &q.kind, None));
    let url = xtream::stream_url(&s, &q.kind, &q.id, &ext);
    let caps = {
        let report = app.capabilities.read().await;
        DecodeCaps::from_report(&report).unwrap_or_else(DecodeCaps::conservative)
    };
    let seek = q.seek.filter(|s| *s > 1.0);
    // The seek offset is part of the key: a jump to a new position is a new
    // session, while a repeat of the same position reuses it.
    let key = format!(
        "{}:{}:{}:{}:{}",
        q.kind,
        q.id,
        ext,
        q.audio.unwrap_or(0),
        seek.map(|s| s as u64).unwrap_or(0)
    );
    let audio = q.audio;
    let live = q.live.unwrap_or(false);
    let app2 = app.clone();
    let res =
        tokio::task::spawn_blocking(move || app2.remux.start(&key, &url, audio, &caps, live, seek))
            .await
            .map_err(|e| ApiError(e.to_string()))?
            .map_err(ApiError::from)?;
    Ok(Json(json!({
        "token": res.token,
        "playlist": format!("/api/hls/{}/index.m3u8", res.token),
        "duration": res.duration,
        "offset": res.offset,
        "audio": res.streams.get("audio").cloned().unwrap_or(Value::Null),
        "video": res.streams.get("video").cloned().unwrap_or(Value::Null),
        "subtitle": res.streams.get("subtitle").cloned().unwrap_or(Value::Null),
        "decision": res.decision,
    })))
}

#[derive(Deserialize)]
struct StopQ {
    token: String,
}

async fn remux_stop(State(app): State<Arc<App>>, Query(q): Query<StopQ>) -> Json<Value> {
    app.remux.stop(&q.token);
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct SubsReq {
    /// Token of the running remux session; the WebVTT files are written next to
    /// its segments so they disappear together with the session.
    token: String,
    /// Subtitle stream indices to extract (text codecs only).
    indices: Vec<usize>,
}

/// Extract text subtitle streams of a running session to WebVTT (workstream W4).
async fn subs_start(State(app): State<Arc<App>>, Json(q): Json<SubsReq>) -> ApiResult {
    let token = q.token;
    let indices = q.indices;
    let app2 = app.clone();
    let t2 = token.clone();
    let tracks = tokio::task::spawn_blocking(move || app2.remux.extract_subs(&t2, &indices))
        .await
        .map_err(|e| ApiError(e.to_string()))?
        .map_err(ApiError::from)?;
    let tracks: Vec<Value> = tracks
        .into_iter()
        .map(|t| {
            json!({
                "index": t.index,
                "url": format!("/api/hls/{}/{}", token, t.file),
            })
        })
        .collect();
    Ok(Json(json!({ "tracks": tracks })))
}

#[derive(Deserialize)]
struct StreamsQ {
    kind: String,
    id: String,
    #[serde(default)]
    ext: Option<String>,
}

async fn streams(State(app): State<Arc<App>>, Query(q): Query<StreamsQ>) -> ApiResult {
    let s = app.session().await.ok_or(ApiError("Not signed in.".into()))?;
    let ext = q
        .ext
        .clone()
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| xtream::preferred_ext(&s, &q.kind, None));
    let url = xtream::stream_url(&s, &q.kind, &q.id, &ext);
    let app2 = app.clone();
    let is_live = q.kind == "live";
    let info = tokio::task::spawn_blocking(move || app2.remux.probe_streams(&url, is_live))
        .await
        .map_err(|e| ApiError(e.to_string()))?
        .map_err(ApiError::from)?;
    Ok(Json(info))
}

async fn hls_file(
    State(app): State<Arc<App>>,
    Path((token, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err(ApiError("Invalid file.".into()));
    }
    let dir = app.remux.dir(&token).ok_or(ApiError("Unknown stream.".into()))?;
    app.remux.touch(&token);
    let path = dir.join(&file);
    let mut found = false;
    for _ in 0..300 {
        if path.exists() {
            found = true;
            break;
        }
        // Ist FFmpeg schon gestorben, kommt das Segment nie - dann lieber sofort
        // melden, statt 30 Sekunden zu warten.
        if let Some(reason) = app.remux.ended(&token) {
            return Err(ApiError(format!("Aufbereitung abgebrochen: {reason}")));
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    if !found {
        return Err(ApiError("Segment not ready yet.".into()));
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| ApiError(e.to_string()))?;
    let ct = if file.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if file.ends_with(".ts") {
        "video/mp2t"
    } else {
        "application/octet-stream"
    };
    let cache = if file.ends_with(".m3u8") {
        "no-store"
    } else {
        "public, max-age=3600"
    };
    Response::builder()
        .header(header::CONTENT_TYPE, ct)
        .header(header::CACHE_CONTROL, cache)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(bytes))
        .map_err(|e| ApiError(e.to_string()))
}

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/capabilities", post(capabilities_put))
        .route("/api/login", post(login))
        .route("/api/login_m3u", post(login_m3u))
        .route("/api/logout", post(logout))
        .route("/api/session", get(session_info))
        .route("/api/diagnose", post(diagnose))
        .route("/api/categories", get(categories))
        .route("/api/browse", get(browse))
        .route("/api/home", get(home))
        .route("/api/detail", get(detail))
        .route("/api/epg", get(epg))
        .route("/api/enrich", get(enrich))
        .route("/api/enrich_batch", post(enrich_batch))
        .route("/api/refresh", post(refresh))
        .route("/api/player", get(player))
        .route("/api/remux", get(remux_start))
        .route("/api/remux/stop", get(remux_stop))
        .route("/api/subs", post(subs_start))
        .route("/api/streams", get(streams))
        .route("/api/hls/{token}/{file}", get(hls_file))
        .route("/api/proxy", get(proxy_h))
        .route("/api/img", get(img_h))
        .layer(CorsLayer::permissive())
        .with_state(app)
}

#[cfg(test)]
mod tests {
    use super::{name_lang, shuffle};

    /// The banner picks a random subset, so the shuffle must be a real
    /// permutation - never lose or duplicate an entry.
    #[test]
    fn language_prefixes_are_recognised_only_at_the_front() {
        assert_eq!(name_lang("DE - South Park (1997) (US)").as_deref(), Some("DE"));
        assert_eq!(name_lang("EN - A Make or Break Holiday (2025)").as_deref(), Some("EN"));
        assert_eq!(name_lang("AT| DAS ERSTE HD").as_deref(), Some("AT"));
        assert_eq!(name_lang("US (Paramount 062) | Hajduk Split").as_deref(), Some("US"));
        assert_eq!(name_lang("SW| SRF 1 FHD").as_deref(), Some("SW"));
        // Ordinary titles must not look like a language.
        assert_eq!(name_lang("The Matrix (1999)"), None);
        assert_eq!(name_lang("Up - Above"), None);
        assert_eq!(name_lang(""), None);
    }

    #[test]
    fn shuffle_is_a_permutation() {
        let base: Vec<u32> = (0..30).collect();
        let mut a = base.clone();
        shuffle(&mut a, 12345);
        let mut sorted = a.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, base, "every element must survive the shuffle");
        assert_ne!(a, base, "the order must actually change");
    }

    #[test]
    fn shuffle_handles_degenerate_input() {
        let mut empty: Vec<u32> = Vec::new();
        shuffle(&mut empty, 1);
        assert!(empty.is_empty());

        let mut one = vec![7u32];
        shuffle(&mut one, 1);
        assert_eq!(one, vec![7]);
    }
}
