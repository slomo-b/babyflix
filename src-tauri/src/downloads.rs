//! Downloads of films and episodes for offline playback.
//!
//! The provider's file is stored as delivered - no re-encoding, so a download is
//! as fast as the connection allows and nothing changes in quality. One folder per
//! item, plus an `index.json` so the list survives a restart. Playback then runs
//! through the normal remux path with a local file as input (see `remux.rs`).

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

/// Ab dieser Groesse lohnt sich das Aufteilen; darunter ist eine Verbindung schneller.
const PARALLEL_FROM: u64 = 16 * 1024 * 1024;
/// Mehr Verbindungen bringen kaum mehr (gemessen: 1 -> 1,6 MB/s, 4 -> 10,3 MB/s).
const PARALLEL_PARTS: u64 = 4;

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
    /// Staffel/Nummer, damit die Oberfläche Folgen einer Serie gruppieren kann.
    #[serde(default)]
    pub season: Option<i64>,
    #[serde(default)]
    pub episode: Option<i64>,
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
            // The provider throttles per connection (measured: 1.6 MB/s on one,
            // 10.3 MB/s on four), so large files are fetched in parallel ranges.
            // If that is unsupported or fails, one stream takes over.
            let probed = probe_source(&client, &url).await;
            let total_hint = probed.map(|(t, _)| t).unwrap_or(0);
            let mut result = Err(anyhow!("nicht gestartet"));
            match probed {
                Some((total, true)) if total >= PARALLEL_FROM => {
                    {
                        let mut items = me.items.lock().unwrap();
                        if let Some(it) = items.iter_mut().find(|i| i.id == id) {
                            it.total = total;
                        }
                    }
                    result = segmented(&client, &url, &part, total, &cancel, &me, &id).await;
                    if result.is_err() && !cancel.load(Ordering::Relaxed) {
                        // Some providers refuse several connections: start over with one.
                        // The parallel file is pre-allocated to full size, so it has to
                        // go - otherwise a resume would think it was complete.
                        let _ = std::fs::remove_file(&part);
                        result =
                            stream_to_file(&client, &url, &part, total_hint, &cancel, &me, &id)
                                .await;
                    }
                }
                // Everything else - including an unknown size or a failed probe -
                // goes straight to the single stream. Dropping the attempt here is
                // what produced "nicht gestartet".
                _ => {
                    result =
                        stream_to_file(&client, &url, &part, total_hint, &cancel, &me, &id).await;
                }
            }
            let cancelled = cancel.load(Ordering::Relaxed);
            let mut moved = false;
            if result.is_ok() {
                moved = std::fs::rename(&part, &finished).is_ok();
            }
            // On failure the partial file stays: starting the download again
            // continues at that byte instead of fetching everything anew.
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
                                it.error = Some(format!(
                                    "{e} - erneut starten setzt an dieser Stelle fort"
                                ));
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

/// Size of the source and whether it honours byte ranges.
///
/// The range check is empirical - a ranged request answered with `206` - because
/// panels send non-standard `Accept-Ranges` values (this one says
/// `0-3225776938`), which made a perfectly range-capable source look incapable.
async fn probe_source(client: &reqwest::Client, url: &str) -> Option<(u64, bool)> {
    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .ok()?;
    let ranged = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let total = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|n| n.trim().parse::<u64>().ok())
        .or_else(|| resp.content_length())
        .unwrap_or(0);
    (total > 0).then_some((total, ranged))
}

/// Fetch the file in `PARALLEL_PARTS` ranges into one pre-allocated file.
///
/// Each task seeks to its own offset and writes sequentially, so nothing has to be
/// concatenated afterwards and only one copy of the file exists on disk.
async fn segmented(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    total: u64,
    cancel: &Arc<AtomicBool>,
    me: &Arc<Downloads>,
    id: &str,
) -> Result<u64> {
    let parts = PARALLEL_PARTS.min((total / (4 * 1024 * 1024)).max(2));
    let chunk = total.div_ceil(parts);
    {
        let f = tokio::fs::File::create(part).await?;
        f.set_len(total).await?;
    }

    let mut handles = Vec::new();
    for i in 0..parts {
        let start = i * chunk;
        if start >= total {
            break;
        }
        let end = (start + chunk - 1).min(total - 1);
        let client = client.clone();
        let url = url.to_string();
        let path = part.to_path_buf();
        let cancel = cancel.clone();
        let me = me.clone();
        let id = id.to_string();
        handles.push(tokio::spawn(async move {
            range_to_file(&client, &url, &path, start, end, &cancel, &me, &id).await
        }));
    }

    let mut done: u64 = 0;
    for h in handles {
        match h.await {
            Ok(Ok(n)) => done += n,
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(anyhow!("{e}")),
        }
    }
    if done != total {
        bail!("unvollstaendig: {done} von {total} Bytes");
    }
    Ok(total)
}

async fn range_to_file(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    start: u64,
    end: u64,
    cancel: &Arc<AtomicBool>,
    me: &Arc<Downloads>,
    id: &str,
) -> Result<u64> {
    let mut written: u64 = 0;
    let mut attempts = 0u32;
    let mut idle = 0u32;
    loop {
        let from = start + written;
        if from > end {
            return Ok(written);
        }
        let before = written;
        let resp = client
            .get(url)
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .header(reqwest::header::RANGE, format!("bytes={from}-{end}"))
            .send()
            .await;
        let mut resp = match resp {
            Ok(r) if r.status() == reqwest::StatusCode::PARTIAL_CONTENT => r,
            Ok(r) => bail!("Bereich {from}-{end} abgelehnt (HTTP {})", r.status()),
            Err(e) => {
                attempts += 1;
                idle += 1;
                if idle > 5 || attempts > 40 {
                    bail!("Bereich {}: {e}", from);
                }
                tokio::time::sleep(Duration::from_millis(700)).await;
                continue;
            }
        };
        let mut file = tokio::fs::OpenOptions::new().write(true).open(path).await?;
        file.seek(std::io::SeekFrom::Start(from)).await?;
        let mut failed: Option<anyhow::Error> = None;
        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    if cancel.load(Ordering::Relaxed) {
                        bail!("abgebrochen");
                    }
                    file.write_all(&chunk).await?;
                    written += chunk.len() as u64;
                    let mut items = me.items.lock().unwrap();
                    if let Some(it) = items.iter_mut().find(|i| i.id == id) {
                        it.done += chunk.len() as u64;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    failed = Some(anyhow!("{e}"));
                    break;
                }
            }
        }
        file.flush().await?;
        drop(file);
        if written > before {
            idle = 0;
        } else {
            idle += 1;
        }
        if failed.is_none() && start + written > end {
            return Ok(written);
        }
        attempts += 1;
        if idle > 5 || attempts > 40 {
            return Err(failed.unwrap_or_else(|| anyhow!("Bereich brach wiederholt ab")));
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

/// Copy the response body to `part`, reporting progress into the shared list.
///
/// Panels drop connections mid-file (that is what `error decoding response body`
/// was: an aborted body, not data corruption). Each drop reopens the file at the
/// byte reached and continues. Long downloads can be interrupted dozens of times,
/// so the limit counts attempts *without* progress, not attempts in total.
async fn stream_to_file(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    total: u64,
    cancel: &Arc<AtomicBool>,
    me: &Arc<Downloads>,
    id: &str,
) -> Result<u64> {
    {
        let mut items = me.items.lock().unwrap();
        if let Some(it) = items.iter_mut().find(|i| i.id == id) {
            if it.total == 0 {
                it.total = total;
            }
        }
    }

    // A previous run may have left bytes behind - continue there.
    let mut done = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if total > 0 && done >= total {
        return Ok(done);
    }

    let mut attempts = 0u32;
    let mut idle = 0u32;
    let mut last_save = Instant::now();
    loop {
        let before = done;
        let mut request = client
            .get(url)
            // Never let the HTTP layer decode: a video file is not gzip, and a
            // mislabelled Content-Encoding aborts the body mid-transfer.
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
        if done > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={done}-"));
        }
        let resp = match request.send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) if done > 0 && r.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE => {
                return Ok(done)
            }
            Ok(r) => return Err(anyhow!("Anbieter antwortet mit HTTP {}", r.status())),
            Err(e) => {
                attempts += 1;
                idle += 1;
                if idle > 5 || attempts > 80 {
                    return Err(anyhow!("Verbindung fehlgeschlagen: {e}"));
                }
                tokio::time::sleep(Duration::from_millis(700)).await;
                continue;
            }
        };
        if done > 0 && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            // The provider ignores ranges: start over instead of appending twice.
            let _ = std::fs::remove_file(part);
            done = 0;
            continue;
        }

        let mut file = if done > 0 {
            tokio::fs::OpenOptions::new().append(true).open(part).await?
        } else {
            tokio::fs::File::create(part).await?
        };
        let mut body = resp;
        let mut failed: Option<anyhow::Error> = None;
        loop {
            match body.chunk().await {
                Ok(Some(chunk)) => {
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
                                it.total = total;
                            }
                        }
                    }
                    if last_save.elapsed() >= Duration::from_secs(5) {
                        me.save();
                        last_save = Instant::now();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    failed = Some(anyhow!("{e}"));
                    break;
                }
            }
        }
        file.flush().await?;
        drop(file);

        if done > before {
            idle = 0;
        } else {
            idle += 1;
        }
        let finished = failed.is_none() && (total == 0 || done >= total);
        if finished {
            return Ok(done);
        }
        attempts += 1;
        if idle > 5 || attempts > 80 {
            return Err(failed.unwrap_or_else(|| anyhow!("Verbindung brach wiederholt ab")));
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
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
            season: None,
            episode: None,
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
            for _ in 0..6 {
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

    /// The parallel path must assemble the ranges byte-exactly. Uses a local
    /// server that honours Range requests and a file big enough to be split.
    #[test]
    fn parallel_ranges_are_assembled_correctly() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::Arc;

        // 20 MB, deterministic content.
        let data: Arc<Vec<u8>> = Arc::new((0..20_000_000u32).map(|i| (i % 251) as u8).collect());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let served = data.clone();
        std::thread::spawn(move || {
            for _ in 0..32 {
                let Ok((mut sock, _)) = listener.accept() else { continue };
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let mut start = 0u64;
                let mut end = served.len() as u64 - 1;
                for line in req.lines() {
                    if line.to_ascii_lowercase().starts_with("range:") {
                        let v = line.split('=').nth(1).unwrap_or("").trim().to_string();
                        let mut it = v.split('-');
                        start = it.next().unwrap_or("0").parse().unwrap_or(0);
                        if let Some(e) = it.next() {
                            if !e.is_empty() {
                                end = e.parse().unwrap_or(end);
                            }
                        }
                    }
                }
                let end = end.min(served.len() as u64 - 1);
                let slice = &served[start as usize..=end as usize];
                let head = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                    slice.len(), start, end, served.len()
                );
                let _ = sock.write_all(head.as_bytes());
                let _ = sock.write_all(slice);
            }
        });

        let dir = std::env::temp_dir().join(format!("babyflix-dl-par-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dl = Arc::new(Downloads::new(dir.clone()));
        let mut entry = info("movie-77");
        entry.state = "running".into();

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            dl.start(reqwest::Client::new(), format!("http://{addr}/f.mkv"), entry)
                .expect("start");
            for _ in 0..600 {
                if dl.get("movie-77").map(|i| i.state) == Some("done".to_string()) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });

        let done = dl.get("movie-77").expect("entry");
        assert_eq!(done.state, "done", "download failed: {:?}", done.error);
        assert_eq!(done.total, data.len() as u64);
        let file = dl.local_file("movie-77").expect("local file");
        let got = std::fs::read(&file).expect("read");
        assert_eq!(got.len(), data.len(), "size");
        assert!(got == *data, "content must match byte for byte");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A body that ends early (the provider drops the connection - this is what
    /// "error decoding response body" was) must be resumed, not restarted.
    #[test]
    fn a_dropped_connection_is_resumed() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::Arc;

        let data: Arc<Vec<u8>> = Arc::new((0..6_000_000u32).map(|i| (i / 7 % 251) as u8).collect());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let served = data.clone();

        std::thread::spawn(move || {
            for _ in 0..8 {
                let Ok((mut sock, _)) = listener.accept() else { continue };
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let mut range: Option<(u64, u64)> = None;
                for line in req.lines() {
                    if line.to_ascii_lowercase().starts_with("range:") {
                        let v = line.split('=').nth(1).unwrap_or("").trim().to_string();
                        let mut it = v.split('-');
                        let a = it.next().unwrap_or("0").parse().unwrap_or(0);
                        let b = it
                            .next()
                            .filter(|x| !x.is_empty())
                            .and_then(|x| x.parse().ok())
                            .unwrap_or(served.len() as u64 - 1);
                        range = Some((a, b.min(served.len() as u64 - 1)));
                    }
                }
                match range {
                    Some((a, b)) => {
                        let slice = &served[a as usize..=b as usize];
                        let head = format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                            slice.len(), a, b, served.len()
                        );
                        let _ = sock.write_all(head.as_bytes());
                        let _ = sock.write_all(slice);
                    }
                    None => {
                        // First full request: promise everything, deliver 2 MB, cut.
                        let head = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                            served.len()
                        );
                        let _ = sock.write_all(head.as_bytes());
                        let _ = sock.write_all(&served[..2_000_000]);
                        // drop the socket without finishing the body
                    }
                }
            }
        });

        let dir = std::env::temp_dir().join(format!("babyflix-dl-resume-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dl = Arc::new(Downloads::new(dir.clone()));
        let mut entry = info("movie-88");
        entry.state = "running".into();

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            dl.start(reqwest::Client::new(), format!("http://{addr}/f.mkv"), entry)
                .expect("start");
            for _ in 0..400 {
                if dl.get("movie-88").map(|i| i.state) == Some("done".to_string()) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });

        let done = dl.get("movie-88").expect("entry");
        assert_eq!(done.state, "done", "download failed: {:?}", done.error);
        let file = dl.local_file("movie-88").expect("local file");
        let got = std::fs::read(&file).expect("read");
        assert_eq!(got.len(), data.len(), "size after resume");
        assert!(got == *data, "content must survive the dropped connection");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Without a Content-Length the probe cannot tell the size. That used to abort
    /// the whole download ("nicht gestartet"); it has to stream from zero instead.
    #[test]
    fn a_source_without_length_still_downloads() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::sync::Arc;

        let body = b"no content length here".to_vec();
        let served = body.clone();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for _ in 0..6 {
                let Ok((mut sock, _)) = listener.accept() else { continue };
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf);
                // chunked: no Content-Length at all
                let head = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
                let _ = sock.write_all(head.as_bytes());
                let _ = sock.write_all(format!("{:x}\r\n", served.len()).as_bytes());
                let _ = sock.write_all(&served);
                let _ = sock.write_all(b"\r\n0\r\n\r\n");
            }
        });

        let dir = std::env::temp_dir().join(format!("babyflix-dl-nolen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let dl = Arc::new(Downloads::new(dir.clone()));
        let mut entry = info("movie-99");
        entry.state = "running".into();

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            dl.start(reqwest::Client::new(), format!("http://{addr}/f.mkv"), entry)
                .expect("start");
            for _ in 0..200 {
                if dl.get("movie-99").map(|i| i.state) == Some("done".to_string()) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });

        let done = dl.get("movie-99").expect("entry");
        assert_eq!(done.state, "done", "download failed: {:?}", done.error);
        let file = dl.local_file("movie-99").expect("local file");
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
