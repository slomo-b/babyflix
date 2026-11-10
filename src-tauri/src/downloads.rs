//! Downloads of films and episodes for offline playback.
//!
//! The provider's file is stored as delivered - no re-encoding, so a download is
//! as fast as the connection allows and nothing changes in quality. One folder per
//! item, plus an `index.json` so the list survives a restart. Playback then runs
//! through the normal remux path with a local file as input (see `remux.rs`).

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

/// One downloaded (or downloading) item, as shown in the UI.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DownloadInfo {
    /// Stable id: `<kind>-<source id>` (e.g. `movie-351626`).
    pub id: String,
    /// Source kind: `movie` or `series`.
    pub kind: String,
    /// Id at the provider (film id or episode id).
    pub source_id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub poster: Option<String>,
    /// Series id, so the player can continue with the next episode.
    pub series_id: Option<String>,
    pub ext: String,
    pub total: u64,
    pub done: u64,
    /// `running` | `done` | `stopped` | `error`
    pub state: String,
    pub error: Option<String>,
    /// File name inside the item folder (only when `done`).
    pub file: Option<String>,
    #[serde(default)]
    pub created: u64,
}

pub struct Downloads {
    root: PathBuf,
    items: Mutex<Vec<DownloadInfo>>,
    cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Downloads {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        let items: Vec<DownloadInfo> = std::fs::read_to_string(root.join("index.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        // Anything still marked as running was interrupted by a restart: the
        // partial file is on disk but nobody is writing it any more.
        let items: Vec<DownloadInfo> = items
            .into_iter()
            .map(|mut i| {
                if i.state == "running" {
                    i.state = "stopped".into();
                }
                i
            })
            .collect();
        Downloads { root, items: Mutex::new(items), cancel: Mutex::new(HashMap::new()) }
    }

    pub fn dir(&self) -> &Path {
        &self.root
    }

    fn save_locked(&self, items: &[DownloadInfo]) {
        let text = match serde_json::to_string_pretty(items) {
            Ok(t) => t,
            Err(_) => return,
        };
        let _ = std::fs::write(self.root.join("index.json"), text);
    }

    fn save(&self) {
        let items = self.items.lock().unwrap();
        self.save_locked(&items);
    }

    /// All items, running downloads first, then newest.
    pub fn list(&self) -> Vec<DownloadInfo> {
        let mut items = self.items.lock().unwrap().clone();
        items.sort_by(|a, b| {
            let running = (b.state == "running").cmp(&(a.state == "running"));
            running.then(b.created.cmp(&a.created))
        });
        items
    }

    pub fn get(&self, id: &str) -> Option<DownloadInfo> {
        self.items.lock().unwrap().iter().find(|i| i.id == id).cloned()
    }

    /// Local file of a finished download - what the remux reads instead of a URL.
    pub fn local_file(&self, id: &str) -> Option<PathBuf> {
        let item = self.get(id)?;
        if item.state != "done" {
            return None;
        }
        let name = item.file?;
        let path = self.root.join(&item.id).join(name);
        path.exists().then_some(path)
    }

    pub fn stop(&self, id: &str) {
        if let Some(flag) = self.cancel.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        self.stop(id);
        {
            let mut items = self.items.lock().unwrap();
            items.retain(|i| i.id != id);
            self.save_locked(&items);
        }
        let dir = self.root.join(id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        Ok(())
    }

    fn upsert(&self, entry: DownloadInfo) -> DownloadInfo {
        let mut items = self.items.lock().unwrap();
        if let Some(existing) = items.iter_mut().find(|i| i.id == entry.id) {
            *existing = entry.clone();
        } else {
            items.push(entry.clone());
        }
        entry
    }

    /// Start (or report) a download. Returns the entry the UI should show.
    pub fn start(
        self: &Arc<Self>,
        client: reqwest::Client,
        url: String,
        mut info: DownloadInfo,
    ) -> Result<DownloadInfo> {
        if let Some(existing) = self.get(&info.id) {
            if existing.state == "running" || existing.state == "done" {
                return Ok(existing);
            }
        }
        let dir = self.root.join(&info.id);
        std::fs::create_dir_all(&dir)?;

        info.state = "running".into();
        info.done = 0;
        info.error = None;
        info.file = None;
        if info.created == 0 {
            info.created = crate::xtream::now_unix() as u64;
        }
        let entry = self.upsert(info);
        self.save();

        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel.lock().unwrap().insert(entry.id.clone(), cancel.clone());

        let me = self.clone();
        let id = entry.id.clone();
        let ext = entry.ext.clone();
        let part = dir.join(format!("source.{ext}.part"));
        let finished = dir.join(format!("source.{ext}"));

        tokio::spawn(async move {
            let result = stream_to_file(&client, &url, &part, &cancel, &me, &id).await;
            let cancelled = cancel.load(Ordering::Relaxed);
            let mut moved = false;
            if result.is_ok() {
                moved = std::fs::rename(&part, &finished).is_ok();
            } else {
                let _ = std::fs::remove_file(&part);
            }
            {
                let mut items = me.items.lock().unwrap();
                if let Some(it) = items.iter_mut().find(|i| i.id == id) {
                    match &result {
                        Ok(total) => {
                            it.total = (*total).max(it.total);
                            it.done = it.total;
                            it.state = "done".into();
                            it.file = Some(
                                finished
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default(),
                            );
                            it.error = None;
                        }
                        Err(e) => {
                            it.state = if cancelled { "stopped".into() } else { "error".into() };
                            if !cancelled {
                                it.error = Some(e.to_string());
                            }
                        }
                    }
                }
                me.save_locked(&items);
            }
            if !moved && result.is_ok() {
                eprintln!("[babyflix] download could not be finalized");
            }
            me.cancel.lock().unwrap().remove(&id);
        });

        Ok(entry)
    }
}

/// Copy the response body to `part`, reporting progress into the shared list.
async fn stream_to_file(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    cancel: &Arc<AtomicBool>,
    me: &Arc<Downloads>,
    id: &str,
) -> Result<u64> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| anyhow!("Verbindung fehlgeschlagen: {e}"))?;
    if !resp.status().is_success() {
        return Err(anyhow!("Anbieter antwortet mit HTTP {}", resp.status()));
    }
    let hint = resp.content_length().unwrap_or(0);
    {
        let mut items = me.items.lock().unwrap();
        if let Some(it) = items.iter_mut().find(|i| i.id == id) {
            it.total = hint;
        }
    }

    let mut file = tokio::fs::File::create(part).await?;
    let mut resp = resp;
    let mut done: u64 = 0;
    let mut last_save = Instant::now();
    while let Some(chunk) = resp.chunk().await? {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("abgebrochen"));
        }
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        {
            let mut items = me.items.lock().unwrap();
            if let Some(it) = items.iter_mut().find(|i| i.id == id) {
                it.done = done;
                if it.total == 0 {
                    it.total = hint;
                }
            }
        }
        // Writing the index on every chunk would hammer the disk; the in-memory
        // value is what the UI polls anyway.
        if last_save.elapsed() >= Duration::from_secs(5) {
            me.save();
            last_save = Instant::now();
        }
    }
    file.flush().await?;
    Ok(done)
}

/// Open a folder in the platform's file manager.
pub fn open_folder(path: &Path) -> Result<()> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| anyhow!("{e}"))
}

#[cfg(test)]
mod tests {
    use super::{DownloadInfo, Downloads};

    fn info(id: &str) -> DownloadInfo {
        DownloadInfo {
            id: id.into(),
            kind: "movie".into(),
            source_id: "1".into(),
            title: "Test".into(),
            subtitle: None,
            poster: None,
            series_id: None,
            ext: "mkv".into(),
            total: 0,
            done: 0,
            state: "done".into(),
            error: None,
            file: Some(format!("source.mkv")),
            created: 1,
        }
    }

    /// A running download that was interrupted by a restart must not look active.
    #[test]
    fn interrupted_downloads_become_stopped() {
        let dir = std::env::temp_dir().join(format!("babyflix-dl-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut running = info("movie-1");
        running.state = "running".into();
        std::fs::write(
            dir.join("index.json"),
            serde_json::to_string(&vec![running]).unwrap(),
        )
        .unwrap();

        let dl = Downloads::new(dir.clone());
        let list = dl.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].state, "stopped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// End to end: HTTP response -> file on disk -> done. Uses a throwaway server
    /// so the whole path (reqwest stream, progress, rename) is covered.
    #[test]
    fn a_download_is_written_to_disk_and_marked_done() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::Arc;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = b"hello babyflix downloads".to_vec();
        let served = body.clone();
        std::thread::spawn(move || {
            for _ in 0..2 {
                if let Ok((mut sock, _)) = listener.accept() {
                    let mut buf = [0u8; 1024];
                    let _ = sock.read(&mut buf);
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        served.len()
                    );
                    let _ = sock.write_all(head.as_bytes());
                    let _ = sock.write_all(&served);
                }
            }
        });

        let dir = std::env::temp_dir().join(format!("babyflix-dl-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dl = Arc::new(Downloads::new(dir.clone()));
        let mut entry = info("movie-9");
        entry.state = "running".into();

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            dl.start(
                reqwest::Client::new(),
                format!("http://{addr}/file.mkv"),
                entry,
            )
            .expect("start");
            for _ in 0..200 {
                if dl.get("movie-9").map(|i| i.state) == Some("done".to_string()) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });

        let done = dl.get("movie-9").expect("entry");
        assert_eq!(done.state, "done", "download must finish: {:?}", done.error);
        assert_eq!(done.done as usize, body.len());
        assert_eq!(done.total as usize, body.len());
        let file = dl.local_file("movie-9").expect("local file");
        assert_eq!(std::fs::read(&file).unwrap(), body);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A local file is only usable when the download finished.
    #[test]
    fn local_file_requires_a_finished_download() {
        let dir = std::env::temp_dir().join(format!("babyflix-dl-test2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dl = Downloads::new(dir.clone());
        let mut entry = info("movie-2");
        entry.state = "stopped".into();
        dl.upsert(entry.clone());
        assert!(dl.local_file("movie-2").is_none());

        entry.state = "done".into();
        dl.upsert(entry);
        std::fs::create_dir_all(dir.join("movie-2")).unwrap();
        std::fs::write(dir.join("movie-2/source.mkv"), b"x").unwrap();
        assert!(dl.local_file("movie-2").is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
