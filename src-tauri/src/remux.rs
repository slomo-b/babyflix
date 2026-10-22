//! On-the-fly FFmpeg remux to HLS for VOD playback.
//! Used for every movie/series so that: containers the webview cannot play (MKV, AVI, …) work,
//! audio codecs are normalised (e.g. DTS/AC3 -> AAC) and all audio tracks are selectable.
use anyhow::{anyhow, Result};
use flate2::read::GzDecoder;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
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
    /// Live sessions keep running while the user watches, so they may idle much
    /// longer than a VOD session without being reaped.
    live: bool,
    /// Source URL - reused by the subtitle extraction (W4), so it never has to
    /// open a second connection just to resolve the stream again.
    url: String,
    /// Source position this session starts at (`-ss`). Subtitle extraction uses
    /// the same offset, so the WebVTT cues stay aligned with the video.
    offset: f64,
}

pub struct RemuxStart {
    pub token: String,
    pub duration: Option<f64>,
    pub streams: Value,
    /// What FFmpeg was actually told to do (copy vs transcode) and why.
    pub decision: Value,
    /// Source position (seconds) where this HLS starts. Non-zero after a seek
    /// beyond the already prepared range: the player adds it to its own
    /// timeline, so the film keeps its absolute time.
    pub offset: f64,
}

pub struct Remux {
    root: PathBuf,
    /// Folder for auto-provisioned binaries (`<appdata>/bin`).
    bin_dir: PathBuf,
    ffmpeg: RwLock<Option<PathBuf>>,
    ffprobe: RwLock<Option<PathBuf>>,
    sessions: Mutex<HashMap<String, Session>>,
    keys: Mutex<HashMap<String, String>>,
    /// Decision of the most recently started session - surfaced as a diagnostic
    /// so a user can see why a stream was transcoded instead of copied.
    last_decision: RwLock<Option<Value>>,
}

/// Only relevant on Windows: spawn child processes without a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn hidden(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Which parts of a stream FFmpeg may **copy** instead of re-encoding.
///
/// This is the single place holding the copy-vs-transcode policy. The codec
/// lists come from the webview's own probe (`/api/capabilities`), so the decision
/// follows what the platform can really decode instead of a fixed assumption -
/// e.g. AC-3/E-AC-3 can be copied on both macOS and Windows.
pub(crate) fn copy_actions(
    vcodec: &str,
    acodec: Option<&str>,
    caps: &DecodeCaps,
) -> (bool, bool) {
    let video = caps.video.contains(codec_key(vcodec));
    let audio = acodec.is_some_and(|a| caps.audio.contains(codec_key(a)));
    (video, audio)
}

/// Normalises FFmpeg codec names to the keys the webview probe uses.
fn codec_key(codec: &str) -> &str {
    match codec {
        "h265" => "hevc",
        "avc1" => "h264",
        other => other,
    }
}

/// Audio codecs hls.js can demux out of MPEG-TS.
///
/// The live remux feeds its playlist back into hls.js (not into the webview's
/// native player), and hls.js refuses AC-3/E-AC-3 in MPEG-TS with
/// "Unsupported EC-3 in M2TS" - even when the platform could decode it. For live
/// these have to be converted to AAC, otherwise the channel shows a spinner
/// forever. (Measured on SRF 1 HD, which carries E-AC-3.)
fn hls_js_compatible_audio(codec: Option<&str>) -> bool {
    matches!(codec, Some("aac") | Some("mp3") | Some("opus") | Some("vorbis"))
}

/// What the running webview reported it can decode.
///
/// Built from the report the UI posts to `/api/capabilities` (see
/// `docs/PLAYER-RESEARCH.md`, workstream W1). A codec counts as supported when
/// MSE accepts it, because that is the path playback actually takes.
#[derive(Clone, Debug, Default)]
pub struct DecodeCaps {
    pub video: HashSet<String>,
    pub audio: HashSet<String>,
}

impl DecodeCaps {
    /// The policy used before the UI has reported, or when the report is
    /// unusable: copy H.264 and AAC/MP3 only - exactly what the app did before
    /// the probe existed, so a missing report can never make things worse.
    pub fn conservative() -> Self {
        DecodeCaps {
            video: HashSet::from(["h264".to_string()]),
            audio: HashSet::from(["aac".to_string(), "mp3".to_string()]),
        }
    }

    /// Parse the webview report. `None` when there is nothing usable in it -
    /// an empty report must never turn every codec into "transcode".
    pub fn from_report(report: &Value) -> Option<Self> {
        let obj = report.as_object()?;
        let group = |name: &str| -> HashSet<String> {
            obj.get(name)
                .and_then(|g| g.as_object())
                .map(|g| {
                    g.iter()
                        .filter(|(_, c)| c.get("mse").and_then(Value::as_bool).unwrap_or(false))
                        .map(|(k, _)| k.clone())
                        .collect()
                })
                .unwrap_or_default()
        };
        let video = group("video");
        let audio = group("audio");
        if video.is_empty() {
            return None;
        }
        Some(DecodeCaps { video, audio })
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
pub(crate) fn find_exe(name: &str, env_var: &str) -> Option<PathBuf> {
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
            last_decision: RwLock::new(None),
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

    /// Runs a command and gives up after `secs`.
    ///
    /// `Command::output()` alone can block forever on a stalled stream - exactly
    /// what a slow live channel does - and with it the whole request that started
    /// playback.
    fn output_with_timeout(cmd: &mut Command, secs: u64) -> Option<std::process::Output> {
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let deadline = Instant::now() + Duration::from_secs(secs);
        loop {
            match child.try_wait().ok()? {
                Some(status) => {
                    let mut stdout = Vec::new();
                    if let Some(mut pipe) = child.stdout.take() {
                        let _ = pipe.read_to_end(&mut stdout);
                    }
                    return Some(std::process::Output {
                        status,
                        stdout,
                        stderr: Vec::new(),
                    });
                }
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                None => std::thread::sleep(Duration::from_millis(50)),
            }
        }
    }

    fn probe_json(&self, url: &str, live: bool) -> Option<Value> {
        let ffprobe = self.ffprobe.read().unwrap().clone()?;
        let mut cmd = Command::new(ffprobe);
        cmd.arg("-v")
            .arg("error")
            .arg("-show_streams")
            .arg("-show_format")
            .arg("-of")
            .arg("json");
        if live {
            // A live stream never ends, so ffprobe would keep reading. A small
            // probe window plus a hard timeout keeps the start fast; if it gives
            // up, the conservative copy policy applies instead.
            cmd.args(["-probesize", "2000000", "-analyzeduration", "2000000"]);
        }
        cmd.arg("-user_agent").arg(UA).arg(url);
        hidden(&mut cmd);
        let out = Self::output_with_timeout(&mut cmd, if live { 6 } else { 20 })?;
        if !out.status.success() {
            return None;
        }
        serde_json::from_slice(&out.stdout).ok()
    }

    pub fn probe_streams(&self, url: &str, live: bool) -> Result<Value> {
        let v = self.probe_json(url, live).ok_or_else(|| anyhow!("ffprobe failed"))?;
        let mut out = streams_from(&v);
        out["duration"] = serde_json::json!(duration_of(&v));
        Ok(out)
    }

    /// Start (or reuse) a remux session; returns the token, duration and stream info.
    ///
    /// `seek` restarts the FFmpeg input at that source second - the only way to
    /// reach a position the already prepared playlist does not cover yet. The
    /// resulting HLS starts at 0, so `offset` tells the player where that is in
    /// the film.
    pub fn start(
        &self,
        key: &str,
        url: &str,
        audio: Option<usize>,
        caps: &DecodeCaps,
        live: bool,
        seek: Option<f64>,
    ) -> Result<RemuxStart> {
        let offset = seek.filter(|t| *t > 1.0).unwrap_or(0.0);
        let ffmpeg = self.ffmpeg_bin().ok_or_else(|| anyhow!("ffmpeg not found"))?;

        // Reuse an existing session for the exact key.
        {
            let keys = self.keys.lock().unwrap();
            if let Some(tok) = keys.get(key) {
                let mut s = self.sessions.lock().unwrap();
                if let Some(sess) = s.get_mut(tok) {
                    sess.last = Instant::now();
                    let tok2 = tok.clone();
                    let offset = sess.offset;
                    drop(s);
                    let info = self.probe_json(url, live);
                    let streams = info
                        .as_ref()
                        .map(streams_from)
                        .unwrap_or_else(|| serde_json::json!({"audio":[],"video":[],"subtitle":[]}));
                    let duration = info.as_ref().and_then(duration_of);
                    // The session was started with this exact key, so the recorded
                    // decision applies to it.
                    let decision = self
                        .last_decision
                        .read()
                        .unwrap()
                        .clone()
                        .unwrap_or(Value::Null);
                    return Ok(RemuxStart { token: tok2, duration, streams, decision, offset });
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

        let info = self.probe_json(url, live);
        let streams = info
            .as_ref()
            .map(streams_from)
            .unwrap_or_else(|| serde_json::json!({"audio":[],"video":[],"subtitle":[]}));
        let duration = if live {
            // A live stream has no meaningful duration; the UI hides the timeline.
            None
        } else {
            info.as_ref().and_then(duration_of)
        };
        let vcodec = stream_codec(&streams["video"], 0).unwrap_or_else(|| "h264".into());
        let acodec = stream_codec(&streams["audio"], audio.unwrap_or(0));

        // What FFmpeg will be told to do. Recorded for diagnostics: without a test
        // provider this is the only way to see whether a stream was copied or
        // re-encoded - and which codec forced the re-encode.
        let (video_copy, mut audio_copy) = copy_actions(&vcodec, acodec.as_deref(), caps);
        // Live goes back through hls.js, so only codecs it can demux are copied.
        if live && audio_copy && !hls_js_compatible_audio(acodec.as_deref()) {
            audio_copy = false;
        }
        let decision = json!({
            "key": key,
            "video_codec": vcodec,
            "video": if video_copy { "copy" } else { "transcode" },
            "audio_codec": acodec,
            "audio": if audio_copy { "copy" } else { "transcode" },
            "segments": "mpegts",
            "probed": !caps.video.is_empty(),
        });
        *self.last_decision.write().unwrap() = Some(decision.clone());

        let token = format!("{:x}{:x}", std::process::id(), now_nanos());
        let dir = self.root.join(&token);
        std::fs::create_dir_all(&dir)?;

        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-user_agent")
            .arg(UA);
        if offset > 0.0 {
            // Input seek: FFmpeg jumps inside the source instead of reading up to
            // there, which is what makes an arbitrary jump immediate.
            cmd.arg("-ss").arg(format!("{offset:.3}"));
        }
        cmd.arg("-i")
            .arg(url)
            .arg("-map")
            .arg("0:v:0")
            .arg("-map")
            .arg(format!("0:a:{}", audio.unwrap_or(0)));
        if video_copy {
            cmd.arg("-c:v").arg("copy");
        } else {
            cmd.args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]);
        }
        if audio_copy {
            cmd.arg("-c:a").arg("copy");
        } else {
            cmd.args(["-c:a", "aac", "-ac", "2", "-b:a", "192k"]);
        }
        cmd.arg("-sn");
        if live {
            // Live has no end: a rolling window instead of an event playlist, and
            // old segments are deleted so a long session cannot fill the disk.
            cmd.args([
                "-f",
                "hls",
                "-hls_time",
                "2",
                "-hls_list_size",
                "6",
                "-hls_segment_type",
                "mpegts",
                "-hls_flags",
                "delete_segments+omit_endlist+temp_file",
            ]);
        } else {
            cmd.args([
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
            ]);
        }
        cmd.arg("-hls_segment_filename")
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
                live,
                url: url.to_string(),
                offset,
            },
        );
        self.keys.lock().unwrap().insert(key.to_string(), token.clone());
        Ok(RemuxStart { token, duration, streams, decision, offset })
    }

    /// Decision of the most recently started session (`copy` vs `transcode`).
    pub fn last_decision(&self) -> Option<Value> {
        self.last_decision.read().unwrap().clone()
    }

    /// Has this session's FFmpeg process already ended? Returns a short reason
    /// with its exit status, so callers can fail fast instead of waiting for
    /// segments that will never be written.
    pub fn ended(&self, token: &str) -> Option<String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(token)?;
        match session.child.try_wait() {
            Ok(Some(status)) => Some(format!("FFmpeg beendet ({status})")),
            _ => None,
        }
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
                .filter(|(_, v)| {
                    // A live stream may legitimately sit without requests (paused),
                    // so it gets a far longer leash than an abandoned VOD session.
                    let limit = if v.live { 1800 } else { 120 };
                    now.duration_since(v.last) > Duration::from_secs(limit)
                })
                .map(|(k, _)| k.clone())
                .collect()
        };
        for t in dead {
            self.stop(&t);
        }
    }
}

/// One subtitle track extracted next to a running session's segments.
pub struct SubTrack {
    pub index: usize,
    pub file: String,
}

impl Remux {
    /// Extract the given subtitle streams of a running session to WebVTT.
    ///
    /// This is a **second** FFmpeg run and therefore a second upstream connection -
    /// the deliberate trade-off of variant A in `docs/PLAYER-RESEARCH.md`:
    /// complete subtitles right away, instead of a WebVTT that only fills up as
    /// the film plays. If it fails, playback simply continues without subtitles.
    ///
    /// Blocking - call it from `spawn_blocking`.
    pub fn extract_subs(&self, token: &str, indices: &[usize]) -> Result<Vec<SubTrack>> {
        if indices.is_empty() {
            return Ok(Vec::new());
        }
        let (dir, url, offset) = {
            let sessions = self.sessions.lock().unwrap();
            let s = sessions
                .get(token)
                .ok_or_else(|| anyhow!("no running session for this token"))?;
            (s.dir.clone(), s.url.clone(), s.offset)
        };
        let ffmpeg = self.ffmpeg_bin().ok_or_else(|| anyhow!("ffmpeg not found"))?;

        let mut tracks = Vec::with_capacity(indices.len());
        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-y")
            .arg("-user_agent")
            .arg(UA);
        if offset > 0.0 {
            // Same offset as the video session, so the cues keep their place.
            cmd.arg("-ss").arg(format!("{offset:.3}"));
        }
        cmd.arg("-i")
            .arg(&url);
        for &i in indices {
            let file = format!("sub_{i}.vtt");
            cmd.arg("-map")
                .arg(format!("0:s:{i}"))
                .arg("-c:s")
                .arg("webvtt")
                .arg("-f")
                .arg("webvtt")
                .arg(dir.join(&file));
            tracks.push(SubTrack { index: i, file });
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        hidden(&mut cmd);

        let status = cmd
            .status()
            .map_err(|e| anyhow!("ffmpeg subtitle run failed: {e}"))?;
        if !status.success() {
            return Err(anyhow!("ffmpeg could not extract subtitles"));
        }
        Ok(tracks)
    }
}

#[cfg(test)]
mod tests {
    use super::{copy_actions, DecodeCaps};
    use serde_json::{json, Value};

    /// Before any probe: exactly the policy the app used to hard-code, so a
    /// missing report can never make playback worse.
    #[test]
    fn without_a_probe_only_h264_and_aac_mp3_are_copied() {
        let caps = DecodeCaps::conservative();
        assert_eq!(copy_actions("h264", Some("aac"), &caps), (true, true));
        assert_eq!(copy_actions("h264", Some("mp3"), &caps), (true, true));
        assert_eq!(copy_actions("h264", Some("ac3"), &caps), (true, false));
        assert_eq!(copy_actions("hevc", Some("aac"), &caps), (false, true));
        assert_eq!(copy_actions("hevc", Some("ac3"), &caps), (false, false));
        // No audio stream at all: nothing to copy.
        assert_eq!(copy_actions("h264", None, &caps), (true, false));
    }

    /// The probe is what unlocks copying AC-3/E-AC-3 and HEVC.
    #[test]
    fn a_probe_widens_what_is_copied() {
        let caps = DecodeCaps::from_report(&json!({
            "video": { "h264": { "mse": true }, "hevc": { "mse": true }, "av1": { "mse": false } },
            "audio": { "aac": { "mse": true }, "ac3": { "mse": true }, "dts": { "mse": false } }
        }))
        .expect("report is usable");
        assert_eq!(copy_actions("hevc", Some("ac3"), &caps), (true, true));
        assert_eq!(copy_actions("av1", Some("aac"), &caps), (false, true));
        assert_eq!(copy_actions("h264", Some("dts"), &caps), (true, false));
        // Alias: FFmpeg says h265 where the probe says hevc.
        assert_eq!(copy_actions("h265", Some("eac3"), &caps), (true, false));
    }

    /// An unusable report must not cause blanket transcoding.
    #[test]
    fn an_empty_report_is_ignored() {
        assert!(DecodeCaps::from_report(&Value::Null).is_none());
        assert!(DecodeCaps::from_report(&json!({})).is_none());
        assert!(DecodeCaps::from_report(&json!({ "video": {}, "audio": {} })).is_none());
    }

    /// The live remux playlist is read by hls.js again, and hls.js cannot demux
    /// AC-3/E-AC-3 out of MPEG-TS ("Unsupported EC-3 in M2TS"), even when the
    /// webview says it could decode them. Those must become AAC for live.
    #[test]
    fn live_audio_that_hls_js_cannot_demux_is_transcoded() {
        use super::hls_js_compatible_audio;
        assert!(hls_js_compatible_audio(Some("aac")));
        assert!(hls_js_compatible_audio(Some("mp3")));
        assert!(!hls_js_compatible_audio(Some("eac3")));
        assert!(!hls_js_compatible_audio(Some("ac3")));
        assert!(!hls_js_compatible_audio(None));

        // With a full probe the policy would copy AC-3/E-AC-3 - for live that is
        // overridden, so the frontend can actually play it.
        let caps = DecodeCaps::from_report(&json!({
            "video": { "h264": { "mse": true } },
            "audio": { "aac": { "mse": true }, "ac3": { "mse": true }, "eac3": { "mse": true } }
        }))
        .expect("report is usable");
        assert_eq!(copy_actions("h264", Some("eac3"), &caps), (true, true));
        assert!(!hls_js_compatible_audio(Some("eac3")));
    }
}
