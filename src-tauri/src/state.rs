//! Shared application state: session, catalog cache, IMDb enrichment cache.
use crate::imdb::{self, ImdbInfo};
use crate::m3u;
use crate::ratings::RatingStore;
use crate::xtream::{self, Credentials, MediaItem, Session};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Config {
    pub base_url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub m3u_url: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Catalog {
    #[allow(dead_code)]
    pub fetched_at: i64,
    pub items: Arc<Vec<MediaItem>>,
}

pub struct App {
    pub client: reqwest::Client,
    pub dir: PathBuf,
    pub session: RwLock<Option<Session>>,
    pub catalog: RwLock<HashMap<String, Catalog>>,
    pub imdb_cache: RwLock<HashMap<String, Option<ImdbInfo>>>,
    pub ratings: RwLock<RatingStore>,
    pub ratings_started: AtomicBool,
    pub locks: RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl App {
    pub fn new(dir: PathBuf) -> Arc<Self> {
        let client = reqwest::Client::builder()
            .user_agent(xtream::UA)
            .connect_timeout(std::time::Duration::from_secs(20))
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("http client");
        let _ = std::fs::create_dir_all(&dir);
        Arc::new(App {
            client,
            dir,
            session: RwLock::new(None),
            catalog: RwLock::new(HashMap::new()),
            imdb_cache: RwLock::new(HashMap::new()),
            ratings: RwLock::new(RatingStore::default()),
            ratings_started: AtomicBool::new(false),
            locks: RwLock::new(HashMap::new()),
        })
    }

    fn config_path(&self) -> PathBuf {
        self.dir.join("config.json")
    }

    pub fn load_config(&self) -> Config {
        std::fs::read_to_string(self.config_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_config(&self, cfg: &Config) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        std::fs::write(self.config_path(), serde_json::to_string_pretty(cfg)?)?;
        Ok(())
    }

    pub async fn set_session(&self, session: Session) {
        *self.session.write().await = Some(session);
    }

    pub async fn session(&self) -> Option<Session> {
        self.session.read().await.clone()
    }

    pub async fn is_logged_in(&self) -> bool {
        self.session.read().await.is_some()
    }

    /// Auto-login from saved config (called at startup).
    pub async fn autologin(&self) -> Result<()> {
        let cfg = self.load_config();
        if let Some(u) = cfg.m3u_url.clone() {
            if !u.trim().is_empty() {
                return self.login_m3u(&u).await;
            }
        }
        let (Some(base), Some(user), Some(pass)) = (cfg.base_url, cfg.username, cfg.password) else {
            return Ok(());
        };
        let creds = Credentials { base_url: base, username: user, password: pass };
        let session = xtream::login(&self.client, &creds).await?;
        self.set_session(session).await;
        Ok(())
    }

    /// Log in with an M3U / M3U Plus playlist URL (alternative to Xtream).
    pub async fn login_m3u(&self, url: &str) -> Result<()> {
        let url = url.trim().to_string();
        self.load_m3u(&url).await?;
        let origin = url.split('?').next().unwrap_or(&url).to_string();
        let cfg = Config {
            base_url: None,
            username: None,
            password: None,
            m3u_url: Some(url.clone()),
        };
        let _ = self.save_config(&cfg);
        let counts = {
            let c = self.catalog.read().await;
            (
                c.get("live").map(|x| x.items.len()).unwrap_or(0),
                c.get("vod").map(|x| x.items.len()).unwrap_or(0),
                c.get("series").map(|x| x.items.len()).unwrap_or(0),
            )
        };
        self.set_session(Session {
            creds: Credentials { base_url: origin.clone(), username: String::new(), password: String::new() },
            user_info: json!({
                "username": "M3U-Playlist",
                "status": "Active",
                "live": counts.0,
                "movies": counts.1,
                "series": counts.2,
            }),
            server_info: json!({ "url": origin, "server_protocol": "m3u" }),
            allowed_exts: vec!["m3u8".into(), "ts".into(), "mp4".into(), "mkv".into(), "avi".into()],
            ua: xtream::UA.to_string(),
            source: "m3u".to_string(),
            m3u_url: Some(url),
        })
        .await;
        Ok(())
    }

    async fn load_m3u(&self, url: &str) -> Result<()> {
        let text = m3u::fetch(&self.client, url, xtream::UA).await?;
        let lower = text.to_lowercase();
        if !lower.contains("#extm3u") && !lower.contains("#extinf") {
            let snippet: String = text.chars().take(180).collect::<String>().replace(['\r', '\n'], " ");
            return Err(anyhow!(
                "Keine gültige M3U-Playlist (kein #EXTM3U gefunden). Antwort: {snippet}"
            ));
        }
        let parsed = m3u::parse(&text);
        let now = xtream::now_unix();
        let mut cat = self.catalog.write().await;
        cat.clear();
        cat.insert("live".into(), Catalog { fetched_at: now, items: Arc::new(parsed.live) });
        cat.insert("vod".into(), Catalog { fetched_at: now, items: Arc::new(parsed.movie) });
        cat.insert("series".into(), Catalog { fetched_at: now, items: Arc::new(parsed.series) });
        Ok(())
    }

    /// Re-download and re-parse the current M3U playlist.
    pub async fn refresh_m3u(&self) -> Result<()> {
        let url = self
            .session
            .read()
            .await
            .as_ref()
            .and_then(|s| s.m3u_url.clone())
            .ok_or_else(|| anyhow!("Keine M3U-Quelle aktiv"))?;
        self.load_m3u(&url).await
    }

    pub async fn is_m3u(&self) -> bool {
        matches!(
            self.session.read().await.as_ref().map(|s| s.source.as_str()),
            Some("m3u")
        )
    }

    /// Find a catalog item by id (used for M3U playback).
    pub async fn find_item(&self, id: &str) -> Option<MediaItem> {
        let cat = self.catalog.read().await;
        for c in cat.values() {
            if let Some(it) = c.items.iter().find(|i| i.id == id) {
                return Some(it.clone());
            }
        }
        None
    }

    fn catalog_path(&self, kind: &str) -> PathBuf {
        self.dir.join("catalog").join(format!("{kind}.json"))
    }

    async fn kind_lock(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.locks.write().await;
        m.entry(key.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// Return the catalog for a kind, fetching from Xtream (and caching) as needed.
    pub async fn ensure_catalog(&self, kind: &str, force: bool) -> Result<Arc<Vec<MediaItem>>> {
        let key = xtream::norm_kind(kind);
        if !force {
            if let Some(c) = self.catalog.read().await.get(key) {
                return Ok(c.items.clone());
            }
            if let Some(items) = self.load_disk_catalog(key) {
                return Ok(items);
            }
        }
        // M3U sources never hit the Xtream API; catalogs are loaded at login.
        if self.is_m3u().await {
            return Ok(self
                .catalog
                .read()
                .await
                .get(key)
                .map(|c| c.items.clone())
                .unwrap_or_else(|| Arc::new(Vec::new())));
        }
        // serialize concurrent fetches of the same catalog
        let lock = self.kind_lock(key).await;
        let _guard = lock.lock().await;
        if !force {
            if let Some(c) = self.catalog.read().await.get(key) {
                return Ok(c.items.clone());
            }
        }
        let session = self
            .session()
            .await
            .ok_or_else(|| anyhow!("not logged in"))?;
        let items = xtream::list(&self.client, &session, key).await?;
        let items = Arc::new(items);
        self.save_disk_catalog(key, &items);
        let mut cat = self.catalog.write().await;
        cat.insert(
            key.to_string(),
            Catalog { fetched_at: xtream::now_unix(), items: items.clone() },
        );
        Ok(items)
    }

    fn load_disk_catalog(&self, kind: &str) -> Option<Arc<Vec<MediaItem>>> {
        let path = self.catalog_path(kind);
        let text = std::fs::read_to_string(&path).ok()?;
        let items: Vec<MediaItem> = serde_json::from_str(&text).ok()?;
        if items.is_empty() {
            return None;
        }
        let items = Arc::new(items);
        // keep in memory
        let items2 = items.clone();
        let key = kind.to_string();
        let fetched_at = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or_else(xtream::now_unix);
        if let Ok(mut cat) = self.catalog.try_write() {
            cat.insert(key, Catalog { fetched_at, items: items2 });
        }
        Some(items)
    }

    fn save_disk_catalog(&self, kind: &str, items: &[MediaItem]) {
        let dir = self.dir.join("catalog");
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        if let Ok(json) = serde_json::to_string(items) {
            let _ = std::fs::write(dir.join(format!("{kind}.json")), json);
        }
    }

    pub async fn invalidate_catalog(&self) {
        self.catalog.write().await.clear();
    }

    /// Kick off background download/parse of the IMDb ratings dataset (keyless).
    pub fn ensure_ratings(self: &Arc<Self>) {
        if self.ratings_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let me = self.clone();
        tokio::spawn(async move {
            let cache = me.dir.join("cache");
            let _ = std::fs::create_dir_all(&cache);
            let mut store = me.ratings.write().await;
            if let Err(e) = store.ensure(&me.client, &cache).await {
                eprintln!("[babyflix] imdb ratings dataset not loaded: {e}");
            } else {
                eprintln!("[babyflix] imdb ratings dataset loaded");
            }
        });
    }

    /// Enrich a title with keyless IMDb data (cached, in-flight-safe enough for desktop).
    pub async fn imdb_enrich(self: &Arc<Self>, title: &str, year: Option<i32>, kind: &str) -> Option<ImdbInfo> {
        let key = format!(
            "{}|{}|{}",
            title.to_lowercase(),
            year.map(|y| y.to_string()).unwrap_or_default(),
            if kind == "series" { "s" } else { "m" }
        );
        if let Some(hit) = self.imdb_cache.read().await.get(&key) {
            return hit.clone();
        }
        let sug = imdb::resolve(&self.client, title, year, kind).await;
        let info = match sug {
            Some(s) => {
                let (rating, votes) = {
                    let store = self.ratings.read().await;
                    store
                        .lookup(&s.id)
                        .map(|(r, v)| (Some(r as f64), Some(v as u64)))
                        .unwrap_or((None, None))
                };
                Some(ImdbInfo {
                    imdb_id: Some(s.id.clone()),
                    title: Some(s.title.clone()),
                    year: s.year.or(year),
                    rating,
                    votes,
                    image: s.image.clone(),
                    cast: s.cast.clone(),
                    kind: Some(if s.is_series { "series" } else { "movie" }.to_string()),
                    ..Default::default()
                })
            }
            None => None,
        };
        self.imdb_cache.write().await.insert(key, info.clone());
        info
    }
}
