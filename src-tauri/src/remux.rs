//! On-the-fly FFmpeg remux to HLS for VOD playback.
//! Used for every movie/series so that: containers the webview cannot play (MKV, AVI, …) work,
//! audio codecs are normalised (e.g. DTS/AC3 -> AAC) and all audio tracks are selectable.
use anyhow::{anyhow, Result};
use flate2::read::GzDecoder;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::xtream::UA;

/// Static FFmpeg/FFprobe builds that are provisioned automatically when the system has
/// none. They are fetched straight from the upstream release at runtime, so BabyFlix
/// itself does not redistribute FFmpeg (which is GPL).
const FFMPEG_RELEASE: &str = "b6.1.1";

struct Session {
    child: Child,
    dir: PathBuf,
    key: String,
    last: Instant,
}

pub struct RemuxStart {
    pub token: String,
    pub duration: Option<f64>,
    pub streams: Value,
}

pub struct Remux {
    root: PathBuf,
    /// Folder for auto-provisioned binaries (`<appdata>/bin`).
    bin_dir: PathBuf,
    ffmpeg: RwLock<Option<PathBuf>>,
    ffprobe: RwLock<Option<PathBuf>>,
    sessions: Mutex<HashMap<String, Session>>,
    keys: Mutex<HashMap<String, String>>,
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn hidden(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// File name of an executable on this platform (`ffmpeg` vs `ffmpeg.exe`).
fn exe_file(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Directories that ship together with the app itself (bundled FFmpeg / sidecar).
fn beside_app() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            dirs.push(dir.join("bin"));
            dirs.push(dir.join("ffmpeg"));
            #[cfg(target_os = "macos")]
            if let Some(contents) = dir.parent() {
                // BabyFlix.app/Contents/{MacOS,Resources,Frameworks}
                dirs.push(contents.join("Resources"));
                dirs.push(contents.join("Resources").join("bin"));
                dirs.push(contents.join("Frameworks"));
            }
        }
    }
    dirs
}

/// Well-known install locations.
///
/// An app started from Finder (macOS) or Explorer (Windows) inherits a minimal PATH -
/// on macOS it is only `/usr/bin:/bin:/usr/sbin:/sbin`, so Homebrew's
/// `/opt/homebrew/bin` is invisible to a plain PATH lookup. That is why the app has to
/// look in the usual install directories itself.
fn well_known_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.extend([
            PathBuf::from("/opt/homebrew/bin"), // Apple Silicon Homebrew
            PathBuf::from("/usr/local/bin"),    // Intel Homebrew
            PathBuf::from("/opt/local/bin"),    // MacPorts
            PathBuf::from("/usr/bin"),
        ]);
    }
    #[cfg(target_os = "linux")]
    {
        dirs.extend([
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/snap/bin"),
            PathBuf::from("/var/lib/flatpak/exports/bin"),
        ]);
    }
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Microsoft").join("WinGet").join("Links"));
            dirs.push(PathBuf::from(&local).join("Programs").join("ffmpeg").join("bin"));
        }
        dirs.extend([
            PathBuf::from(r"C:\ffmpeg\bin"),
            PathBuf::from(r"C:\Program Files\ffmpeg\bin"),
        ]);
    }
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(&home).join("bin"));
        dirs.push(PathBuf::from(&home).join(".local").join("bin"));
    }
    dirs
}

fn from_env(env_var: &str, name: &str) -> Option<PathBuf> {
    let raw = std::env::var_os(env_var)?;
    let path = PathBuf::from(raw);
    if path.is_file() {
        return Some(path);
    }
    if path.is_dir() {
        let candidate = path.join(exe_file(name));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Look the binary up on PATH: `where` exists only on Windows, `which` on macOS/Linux.
/// The old implementation called `where` on every platform, which is why FFmpeg was
/// never found on macOS (and every movie/series failed to start there).
fn on_path(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    const FINDER: &str = "where";
    #[cfg(not(windows))]
    const FINDER: &str = "which";

    let out = Command::new(FINDER).arg(name).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|line| PathBuf::from(line.trim()))
        .find(|p| p.is_file())
}

/// Find `name` (ffmpeg / ffprobe):
/// 1. the env override (file *or* directory), 2. next to the app, 3. PATH, 4. usual dirs.
fn find_exe(name: &str, env_var: &str) -> Option<PathBuf> {
    let file = exe_file(name);
    if let Some(p) = from_env(env_var, name) {
        return Some(p);
    }
    for dir in beside_app() {
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(p) = on_path(&file) {
        return Some(p);
    }
    for dir in well_known_dirs() {
        let candidate = dir.join(&file);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Look for a previously auto-provisioned tool in `bin_dir`.
fn cached_bin(bin_dir: &Path, name: &str) -> Option<PathBuf> {
    let p = bin_dir.join(exe_file(name));
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

/// Upstream asset platform/arch tag for the current system.
fn asset_tag() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("win32-x64"),
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        _ => None,
    }
}

/// Download a gzip-compressed static binary and install it (executable) at `dest`.
async fn download_gunzip(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> {
    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(anyhow!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await?;
    // Decompress + write off the async runtime (large buffers, blocking I/O).
    let dest = dest.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut decoder = GzDecoder::new(&bytes[..]);
        let mut out = Vec::new();
        decoder.read_to_end(&mut out)?;
        if out.len() < 1_000_000 {
            return Err(anyhow!("downloaded file looks truncated ({} bytes)", out.len()));
        }
        let tmp = dest.with_extension("part");
        std::fs::write(&tmp, &out)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
        }
        if dest.exists() {
            let _ = std::fs::remove_file(&dest);
        }
        std::fs::rename(&tmp, &dest)?;
        Ok(())
    })
    .await??;
    Ok(())
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn streams_from(v: &Value) -> Value {
    let mut audio = Vec::new();
    let mut video = Vec::new();
    let mut subtitle = Vec::new();
    if let Some(streams) = v.get("streams").and_then(|s| s.as_array()) {
        for s in streams {
            let ty = s.get("codec_type").and_then(|x| x.as_str()).unwrap_or("");
            let entry = serde_json::json!({
                "index": s.get("index").and_then(|x| x.as_i64()),
                "codec": s.get("codec_name").and_then(|x| x.as_str()),
                "lang": s.get("tags").and_then(|t| t.get("language")).and_then(|x| x.as_str()),
                "title": s.get("tags").and_then(|t| t.get("title")).and_then(|x| x.as_str()),
                "channels": s.get("channels").and_then(|x| x.as_i64()),
                "width": s.get("width").and_then(|x| x.as_i64()),
                "height": s.get("height").and_then(|x| x.as_i64()),
            });
            match ty {
                "audio" => audio.push(entry),
                "video" => video.push(entry),
                "subtitle" => subtitle.push(entry),
                _ => {}
            }
        }
    }
    serde_json::json!({ "audio": audio, "video": video, "subtitle": subtitle })
}

fn duration_of(v: &Value) -> Option<f64> {
    v.get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|s| s.trim().parse::<f64>().ok())
}

fn stream_codec(list: &Value, idx: usize) -> Option<String> {
    list.as_array()?
        .get(idx)?
        .get("codec")?
        .as_str()
        .map(|s| s.to_lowercase())
}

impl Remux {
    pub fn new(root: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&root);
        let bin_dir = root
            .parent()
            .map(|p| p.join("bin"))
            .unwrap_or_else(|| root.join("bin"));
        let _ = std::fs::create_dir_all(&bin_dir);
        // Prefer a previously auto-provisioned binary, then any system install.
        let ffmpeg = cached_bin(&bin_dir, "ffmpeg").or_else(|| find_exe("ffmpeg", "BABYFLIX_FFMPEG"));
        let ffprobe = cached_bin(&bin_dir, "ffprobe").or_else(|| find_exe("ffprobe", "BABYFLIX_FFPROBE"));
        match (&ffmpeg, &ffprobe) {
            (Some(f), Some(p)) => {
                eprintln!("[babyflix] ffmpeg: {} | ffprobe: {}", f.display(), p.display())
            }
            _ => eprintln!("[babyflix] FFmpeg not found yet - will be provisioned automatically"),
        }
        Remux {
            root,
            bin_dir,
            ffmpeg: RwLock::new(ffmpeg),
            ffprobe: RwLock::new(ffprobe),
            sessions: Mutex::new(HashMap::new()),
            keys: Mutex::new(HashMap::new()),
        }
    }

    /// Path of the FFmpeg binary in use (surfaced by `/api/health` for diagnostics).
    pub fn ffmpeg_path(&self) -> Option<String> {
        self.ffmpeg.read().unwrap().as_ref().map(|p| p.display().to_string())
    }

    /// Path of the FFprobe binary in use (surfaced by `/api/health` for diagnostics).
    pub fn ffprobe_path(&self) -> Option<String> {
        self.ffprobe.read().unwrap().as_ref().map(|p| p.display().to_string())
    }

    pub fn available(&self) -> bool {
        self.ffmpeg.read().unwrap().is_some()
    }

    fn ffmpeg_bin(&self) -> Option<PathBuf> {
        self.ffmpeg.read().unwrap().clone()
    }

    /// Download and install FFmpeg/FFprobe into `bin_dir` if none is available (system
    /// install or a previous download). Returns immediately when nothing needs doing.
    pub async fn ensure_binaries(&self, client: &reqwest::Client) {
        let Some(tag) = asset_tag() else {
            eprintln!(
                "[babyflix] no prebuilt FFmpeg for {}/{}",
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            return;
        };
        for (tool, slot) in [("ffmpeg", &self.ffmpeg), ("ffprobe", &self.ffprobe)] {
            if slot.read().unwrap().is_some() {
                continue;
            }
            if let Some(p) = cached_bin(&self.bin_dir, tool) {
                *slot.write().unwrap() = Some(p);
                continue;
            }
            let url = format!(
                "https://github.com/eugeneware/ffmpeg-static/releases/download/{FFMPEG_RELEASE}/{tool}-{tag}.gz"
            );
            let dest = self.bin_dir.join(exe_file(tool));
            match download_gunzip(client, &url, &dest).await {
                Ok(()) => {
                    eprintln!("[babyflix] provisioned {tool}: {}", dest.display());
                    *slot.write().unwrap() = Some(dest);
                }
                Err(e) => {
                    // Most likely offline; skip the second tool as well.
                    eprintln!("[babyflix] could not provision {tool}: {e}");
                    return;
                }
            }
        }
    }

    fn probe_json(&self, url: &str) -> Option<Value> {
        let ffprobe = self.ffprobe.read().unwrap().clone()?;
        let mut cmd = Command::new(ffprobe);
        cmd.arg("-v")
            .arg("error")
            .arg("-show_streams")
            .arg("-show_format")
            .arg("-of")
            .arg("json")
            .arg("-user_agent")
            .arg(UA)
            .arg(url);
        hidden(&mut cmd);
        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        serde_json::from_slice(&out.stdout).ok()
    }

    pub fn probe_streams(&self, url: &str) -> Result<Value> {
        let v = self.probe_json(url).ok_or_else(|| anyhow!("ffprobe failed"))?;
        let mut out = streams_from(&v);
        out["duration"] = serde_json::json!(duration_of(&v));
        Ok(out)
    }

    /// Start (or reuse) a remux session; returns the token, duration and stream info.
    pub fn start(&self, key: &str, url: &str, audio: Option<usize>) -> Result<RemuxStart> {
        let ffmpeg = self.ffmpeg_bin().ok_or_else(|| anyhow!("ffmpeg not found"))?;

        // Reuse an existing session for the exact key.
        {
            let keys = self.keys.lock().unwrap();
            if let Some(tok) = keys.get(key) {
                let mut s = self.sessions.lock().unwrap();
                if let Some(sess) = s.get_mut(tok) {
                    sess.last = Instant::now();
                    let tok2 = tok.clone();
                    drop(s);
                    let info = self.probe_json(url);
                    let streams = info
                        .as_ref()
                        .map(streams_from)
                        .unwrap_or_else(|| serde_json::json!({"audio":[],"video":[],"subtitle":[]}));
                    let duration = info.as_ref().and_then(duration_of);
                    return Ok(RemuxStart { token: tok2, duration, streams });
                }
            }
        }

        // Stop other sessions for the same media (e.g. a different audio track).
        let media_prefix = {
            let parts: Vec<&str> = key.split(':').collect();
            if parts.len() >= 2 {
                format!("{}:{}:", parts[0], parts[1])
            } else {
                key.to_string()
            }
        };
        let stale: Vec<String> = {
            let s = self.sessions.lock().unwrap();
            s.iter()
                .filter(|(_, v)| v.key.starts_with(&media_prefix))
                .map(|(k, _)| k.clone())
                .collect()
        };
        for t in stale {
            self.stop(&t);
        }

        let info = self.probe_json(url);
        let streams = info
            .as_ref()
            .map(streams_from)
            .unwrap_or_else(|| serde_json::json!({"audio":[],"video":[],"subtitle":[]}));
        let duration = info.as_ref().and_then(duration_of);
        let vcodec = stream_codec(&streams["video"], 0).unwrap_or_else(|| "h264".into());
        let acodec = stream_codec(&streams["audio"], audio.unwrap_or(0));

        let token = format!("{:x}{:x}", std::process::id(), now_nanos());
        let dir = self.root.join(&token);
        std::fs::create_dir_all(&dir)?;

        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-user_agent")
            .arg(UA)
            .arg("-i")
            .arg(url)
            .arg("-map")
            .arg("0:v:0")
            .arg("-map")
            .arg(format!("0:a:{}", audio.unwrap_or(0)));
        if vcodec == "h264" {
            cmd.arg("-c:v").arg("copy");
        } else {
            cmd.args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]);
        }
        match acodec.as_deref() {
            Some("aac") | Some("mp3") => {
                cmd.arg("-c:a").arg("copy");
            }
            _ => {
                cmd.args(["-c:a", "aac", "-ac", "2", "-b:a", "192k"]);
            }
        }
        cmd.arg("-sn")
            .args([
                "-f",
                "hls",
                "-hls_time",
                "4",
                "-hls_playlist_type",
                "event",
                "-hls_segment_type",
                "mpegts",
                "-hls_flags",
                "independent_segments+temp_file",
            ])
            .arg("-hls_segment_filename")
            .arg(dir.join("seg_%05d.ts"))
            .arg(dir.join("index.m3u8"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hidden(&mut cmd);
        let child = cmd.spawn().map_err(|e| anyhow!("ffmpeg spawn failed: {e}"))?;

        self.sessions.lock().unwrap().insert(
            token.clone(),
            Session {
                child,
                dir,
                key: key.to_string(),
                last: Instant::now(),
            },
        );
        self.keys.lock().unwrap().insert(key.to_string(), token.clone());
        Ok(RemuxStart { token, duration, streams })
    }

    pub fn touch(&self, token: &str) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(token) {
            s.last = Instant::now();
        }
    }

    pub fn dir(&self, token: &str) -> Option<PathBuf> {
        self.sessions.lock().unwrap().get(token).map(|s| s.dir.clone())
    }

    pub fn stop(&self, token: &str) {
        let removed = self.sessions.lock().unwrap().remove(token);
        if let Some(mut s) = removed {
            let _ = s.child.kill();
            let _ = std::fs::remove_dir_all(&s.dir);
        }
        self.keys.lock().unwrap().retain(|_, v| v != token);
    }

    /// Kill sessions idle for more than 2 minutes.
    pub fn reap(&self) {
        let now = Instant::now();
        let dead: Vec<String> = {
            let s = self.sessions.lock().unwrap();
            s.iter()
                .filter(|(_, v)| now.duration_since(v.last) > Duration::from_secs(120))
                .map(|(k, _)| k.clone())
                .collect()
        };
        for t in dead {
            self.stop(&t);
        }
    }
}
