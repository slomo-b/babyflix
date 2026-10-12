//! Optional native playback engine: an external MPV process driven over JSON IPC.
//!
//! Why an external process (and not libmpv in-process): MPV decodes every container
//! and codec with hardware support, tone-maps HDR, buffers IPTV streams and seeks
//! frame-exact - things a webview `<video>` element can only do after a re-encode.
//! Stufe 3 embeds that process into the app window: we own a native child window
//! (`embed::Stage`) and hand its id to `mpv --wid=<id>`, so the video is painted
//! *inside* BabyFlix. Where no child window exists (macOS, Wayland) MPV runs in
//! its own borderless window which we dock over the stage rectangle.
//!
//! Layout: `Mpv` owns a long-lived `mpv --idle` child. A reader thread parses the
//! JSON IPC stream into a property snapshot plus a ring buffer of events that the UI
//! polls; a writer thread forwards commands. Hence: no new dependencies, and the
//! whole engine can be tested headlessly (`--vo=null --ao=null`) against real MPV.
use anyhow::{anyhow, Result};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use crate::embed::{self, Mode, Rect};
use crate::remux::{find_exe, hidden};

/// How many events the UI may fall behind.
const EVENT_RING: usize = 600;
/// Kill MPV when nobody touched it for this long (safety net; the UI stops it too).
const IDLE_TIMEOUT: Duration = Duration::from_secs(45 * 60);
/// `time-pos` changes ~20x/s; the UI only needs a few updates per second.
const POS_THROTTLE: Duration = Duration::from_millis(200);

/// Properties mirrored into the UI (observed on connect).
const OBSERVED: [&str; 17] = [
    "pause",
    "time-pos",
    "duration",
    "volume",
    "mute",
    "speed",
    "aid",
    "sid",
    "track-list",
    "eof-reached",
    "fullscreen",
    "media-title",
    "playlist-pos",
    "playlist-count",
    "ontop",
    "idle-active",
    "paused-for-cache",
];

#[cfg(unix)]
type Ipc = std::os::unix::net::UnixStream;
#[cfg(windows)]
type Ipc = std::fs::File;

#[cfg(unix)]
fn connect(path: &str) -> std::io::Result<Ipc> {
    std::os::unix::net::UnixStream::connect(path)
}

#[cfg(windows)]
fn connect(path: &str) -> std::io::Result<Ipc> {
    std::fs::OpenOptions::new().read(true).write(true).open(path)
}

/// MPV creates this socket itself; on Windows the IPC server is a named pipe.
#[cfg(unix)]
fn socket_path(dir: &Path) -> String {
    dir.join("mpv-ipc.sock").to_string_lossy().into_owned()
}

#[cfg(windows)]
fn socket_path(_dir: &Path) -> String {
    format!(r"\\.\pipe\babyflix-mpv-{}", std::process::id())
}

fn mpv_file_name() -> &'static str {
    if cfg!(windows) {
        "mpv.exe"
    } else {
        "mpv"
    }
}

/// Directories beyond the generic search (FFmpeg-oriented) that ship MPV.
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    dirs.push(PathBuf::from("/Applications/mpv.app/Contents/MacOS"));
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Programs").join("mpv"));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            dirs.push(PathBuf::from(&profile).join("scoop").join("shims"));
        }
        dirs.push(PathBuf::from(r"C:\Program Files\mpv"));
        dirs.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/snap/bin"));
        dirs.push(PathBuf::from("/var/lib/flatpak/exports/bin"));
    }
    dirs
}

/// Snapshot + event log shared between `Mpv` and the reader thread.
struct Shared {
    props: Mutex<Value>,
    log: Mutex<VecDeque<(u64, Value)>>,
    seq: AtomicU64,
    last: Mutex<Instant>,
}

impl Shared {
    fn new() -> Self {
        Shared {
            props: Mutex::new(json!({})),
            log: Mutex::new(VecDeque::new()),
            seq: AtomicU64::new(0),
            last: Mutex::new(Instant::now()),
        }
    }

    fn touch(&self) {
        *self.last.lock().unwrap() = Instant::now();
    }

    /// Mirror one observed property into the snapshot.
    fn set(&self, name: &str, data: &Value) {
        let mut props = self.props.lock().unwrap();
        if !props.is_object() {
            *props = json!({});
        }
        if name == "time-pos" && data.is_null() {
            // MPV clears properties between files; keep the last known value.
            return;
        }
        props[name] = data.clone();
    }

    fn push(&self, event: Value) {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let mut log = self.log.lock().unwrap();
        log.push_back((seq, event));
        while log.len() > EVENT_RING {
            log.pop_front();
        }
    }
}

struct Proc {
    child: Child,
    /// IPC endpoint – a unix socket on Linux/macOS, unused on Windows (named pipe).
    #[cfg_attr(windows, allow(dead_code))]
    socket: String,
    tx: Sender<Value>,
    stop: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
}

/// What to play (and how) - mirrors the webview player's options.
#[derive(Default, Clone)]
pub struct StartOpts {
    pub title: Option<String>,
    pub start: Option<f64>,
    pub audio: Option<i64>,
    pub sub: Option<i64>,
    pub volume: Option<i64>,
    pub muted: Option<bool>,
    pub speed: Option<f64>,
    pub fullscreen: Option<bool>,
    pub ontop: Option<bool>,
    pub alang: Option<String>,
    pub slang: Option<String>,
    pub user_agent: Option<String>,
}

pub struct Mpv {
    dir: PathBuf,
    bin: RwLock<Option<Option<PathBuf>>>,
    ver: RwLock<Option<String>>,
    proc: Mutex<Option<Proc>>,
    shared: Arc<Shared>,
    /// Host window handle + the native surface the video is painted into.
    stage: Mutex<StageState>,
}

/// Embedded-video state. `rect` is what the UI last asked for (physical px,
/// relative to the client area); `origin` is that area's position on screen.
#[derive(Default)]
pub struct StageState {
    pub host: Option<embed::Host>,
    pub stage: Option<embed::Stage>,
    pub rect: Rect,
    pub origin: (i32, i32),
    pub visible: bool,
}

impl Mpv {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Mpv {
            dir,
            bin: RwLock::new(None),
            ver: RwLock::new(None),
            proc: Mutex::new(None),
            shared: Arc::new(Shared::new()),
            stage: Mutex::new(StageState::default()),
        }
    }

    /// Resolve the MPV binary once: env override, bundled/sidecar, PATH, usual dirs.
    pub fn resolve(&self) -> Option<PathBuf> {
        if let Some(cached) = self.bin.read().unwrap().clone() {
            return cached;
        }
        let mut found = find_exe("mpv", "BABYFLIX_MPV");
        if found.is_none() {
            for dir in extra_dirs() {
                let candidate = dir.join(mpv_file_name());
                if candidate.is_file() {
                    found = Some(candidate);
                    break;
                }
            }
        }
        *self.bin.write().unwrap() = Some(found.clone());
        found
    }

    pub fn path(&self) -> Option<String> {
        self.resolve().map(|p| p.to_string_lossy().into_owned())
    }

    pub fn available(&self) -> bool {
        self.resolve().is_some()
    }

    pub fn version(&self) -> Option<String> {
        if let Some(v) = self.ver.read().unwrap().clone() {
            return Some(v);
        }
        let bin = self.resolve()?;
        let out = Command::new(bin).arg("--version").output().ok()?;
        let line = String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        if line.is_empty() {
            return None;
        }
        *self.ver.write().unwrap() = Some(line.clone());
        Some(line)
    }

    pub fn running(&self) -> bool {
        let mut guard = self.proc.lock().unwrap();
        match guard.as_mut() {
            Some(p) => match p.child.try_wait() {
                Ok(None) => true,
                _ => {
                    *guard = None;
                    false
                }
            },
            None => false,
        }
    }

    pub fn props(&self) -> Value {
        self.shared.props.lock().unwrap().clone()
    }

    pub fn status(&self) -> Value {
        json!({
            "available": self.available(),
            "path": self.path(),
            "version": self.version(),
            "running": self.running(),
            "props": self.props(),
            "seq": self.shared.seq.load(Ordering::SeqCst),
            "embed": self.embed_info(),
        })
    }

    /// Events + state for the UI. `since` is the last sequence number the UI saw.
    pub fn poll(&self, since: u64) -> Value {
        self.shared.touch();
        let seq = self.shared.seq.load(Ordering::SeqCst);
        let log = self.shared.log.lock().unwrap();
        let oldest = log.front().map(|(s, _)| *s).unwrap_or(seq);
        let events: Vec<Value> = log
            .iter()
            .filter(|(s, _)| *s > since)
            .map(|(_, v)| v.clone())
            .collect();
        let reset = since + 1 < oldest;
        drop(log);
        json!({
            "seq": seq,
            "reset": reset,
            "running": self.running(),
            "events": events,
            "props": self.props(),
        })
    }

    fn command(&self, command: &[Value]) -> Result<()> {
        let guard = self.proc.lock().unwrap();
        let proc = guard.as_ref().ok_or_else(|| anyhow!("mpv is not running"))?;
        proc.tx
            .send(json!({ "command": command }))
            .map_err(|_| anyhow!("mpv is not running"))?;
        self.shared.touch();
        Ok(())
    }

    pub fn cmd(&self, command: Vec<Value>) -> Result<()> {
        self.command(&command)
    }

    pub fn set_prop(&self, name: &str, value: Value) -> Result<()> {
        self.command(&[json!("set_property"), json!(name), value])
    }

    /// Remember the app window's native handle (called once at startup).
    pub fn set_host(&self, host: Option<embed::Host>) {
        self.stage.lock().unwrap().host = host;
    }

    /// Which embedding mode is in use (`None` = no surface reserved yet).
    pub fn embed_mode(&self) -> Option<Mode> {
        self.stage.lock().unwrap().stage.as_ref().map(|s| s.mode())
    }

    /// Embedding state for `/api/health` and `/api/mpv/status`.
    pub fn embed_info(&self) -> Value {
        let st = self.stage.lock().unwrap();
        json!({
            "mode": st.stage.as_ref().map(|s| s.mode().as_str()),
            "wid": st.stage.as_ref().and_then(|s| s.wid()),
            "rect": st.rect,
            "visible": st.visible,
        })
    }

    /// Last rectangle + visibility the UI asked for.
    pub fn stage_rect(&self) -> (Rect, bool) {
        let st = self.stage.lock().unwrap();
        (st.rect, st.visible)
    }

    /// Place (and show/hide) the video surface. `client` is relative to the
    /// window's client area, `origin` is that area's position on screen.
    pub fn set_stage(&self, client: Rect, origin: (i32, i32), visible: bool) {
        let (mode, wid) = {
            let mut st = self.stage.lock().unwrap();
            st.rect = client.sized();
            st.origin = origin;
            st.visible = visible;
            if let Some(s) = st.stage.as_mut() {
                s.set_rect(client);
                s.set_visible(visible);
                s.sink();
            }
            (st.stage.as_ref().map(|s| s.mode()), st.stage.as_ref().and_then(|s| s.wid()))
        };
        // No native child window (macOS, Wayland): MPV keeps its own borderless
        // window, so the surface is placed with screen geometry instead.
        if mode == Some(Mode::OwnWindow) && wid.is_none() {
            let screen = Rect {
                x: origin.0 + client.x,
                y: origin.1 + client.y,
                ..client.sized()
            };
            let _ = self.set_prop("geometry", json!(embed::geometry_arg(screen)));
            let _ = self.set_prop("window-minimized", json!(if visible { "no" } else { "yes" }));
        }
    }

    /// Mirror the app window's focus in own-window mode - MPV's window would
    /// otherwise stay above every other application.
    pub fn set_ontop(&self, on: bool) {
        if self.embed_mode() == Some(Mode::OwnWindow) {
            let _ = self.set_prop("ontop", json!(on));
        }
    }

    fn spawn(&self, o: &StartOpts) -> Result<()> {
        let bin = self
            .resolve()
            .ok_or_else(|| anyhow!("mpv not found - install mpv or set BABYFLIX_MPV"))?;
        let sock = socket_path(&self.dir);
        #[cfg(unix)]
        {
            let _ = std::fs::remove_file(&sock);
        }

        let env_or = |key: &str, default: &str| -> String {
            std::env::var(key).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| default.to_string())
        };
        let vo = env_or("BABYFLIX_MPV_VO", "gpu-next");
        let hwdec = env_or("BABYFLIX_MPV_HWDEC", "auto-safe");
        let profile = env_or("BABYFLIX_MPV_PROFILE", "high-quality");
        let volume = o.volume.unwrap_or(100).clamp(0, 150);
        let speed = o.speed.unwrap_or(1.0).clamp(0.25, 4.0);
        let alang = o
            .alang
            .clone()
            .unwrap_or_else(|| "de,ger,en,eng".to_string());
        let slang = o
            .slang
            .clone()
            .unwrap_or_else(|| "de,ger,en,eng,off".to_string());

        // Reserve the native video surface *before* MPV starts - child-window
        // mode needs its id on the command line (`--wid`).
        let embed_on = std::env::var("BABYFLIX_MPV_EMBED")
            .map(|v| !v.trim().is_empty() && v.trim() != "0")
            .unwrap_or(true);
        let mut wid: Option<u64> = None;
        let mut own_window = false;
        {
            let mut st = self.stage.lock().unwrap();
            if let Some(mut old) = st.stage.take() {
                old.destroy();
            }
            if embed_on {
                let stage = embed::Stage::create(st.host, st.rect);
                own_window = st.host.is_some() && stage.mode() == Mode::OwnWindow;
                wid = stage.wid();
                st.stage = Some(stage);
            }
        }
        let dock = {
            let st = self.stage.lock().unwrap();
            Rect {
                x: st.origin.0 + st.rect.x,
                y: st.origin.1 + st.rect.y,
                ..st.rect.sized()
            }
        };

        let mut cmd = Command::new(&bin);
        cmd.arg("--idle=yes")
            .arg("--no-terminal")
            .arg("--force-window=yes")
            .arg("--keep-open=yes")
            .arg("--save-position-on-quit=no")
            .arg(format!("--input-ipc-server={sock}"))
            .arg("--osd-level=1")
            .arg(format!("--hwdec={hwdec}"))
            .arg(format!("--vo={vo}"))
            .arg(format!("--cache-secs=30"))
            .arg(format!("--demuxer-max-bytes={}", 256 * 1024 * 1024))
            .arg(format!("--volume={volume}"))
            .arg(format!("--speed={speed}"))
            .arg(format!("--alang={alang}"))
            .arg(format!("--slang={slang}"))
            .arg("--title=BabyFlix")
            .arg("--cache=yes");
        if let Some(w) = wid {
            // Video is painted into our own child window: no border, no OSC (the
            // HTML chrome around the stage is the control surface).
            cmd.arg(format!("--wid={w}"))
                .arg("--border=no")
                .arg("--focus-on-open=no")
                .arg("--osc=no");
        } else if own_window {
            // No native child windows here: MPV floats in its own borderless
            // window, docked over the stage rectangle by /api/mpv/stage.
            cmd.arg("--border=no")
                .arg("--ontop=yes")
                .arg("--focus-on-open=no")
                .arg("--osc=no")
                .arg(format!("--geometry={}", embed::geometry_arg(dock)));
        } else {
            cmd.arg("--osc=yes");
        }
        if o.muted == Some(true) {
            cmd.arg("--mute=yes");
        }
        if !profile.is_empty() && profile != "none" {
            cmd.arg(format!("--profile={profile}"));
        }
        if let Some(ua) = &o.user_agent {
            cmd.arg(format!("--user-agent={ua}"));
        }
        if let Ok(extra) = std::env::var("BABYFLIX_MPV_EXTRA") {
            for part in extra.split_whitespace() {
                cmd.arg(part);
            }
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hidden(&mut cmd);

        let child = cmd.spawn().map_err(|e| anyhow!("mpv could not start: {e}"))?;

        // MPV needs a moment to create its IPC endpoint.
        let mut conn: Option<Ipc> = None;
        for _ in 0..120 {
            match connect(&sock) {
                Ok(c) => {
                    conn = Some(c);
                    break;
                }
                Err(_) => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        let conn = match conn {
            Some(c) => c,
            None => {
                let mut child = child;
                let _ = child.kill();
                return Err(anyhow!("mpv IPC endpoint was not reachable"));
            }
        };
        let write_half = conn
            .try_clone()
            .map_err(|e| anyhow!("mpv IPC handle could not be cloned: {e}"))?;

        let (tx, rx) = channel::<Value>();
        let stop = Arc::new(AtomicBool::new(false));
        let shared = self.shared.clone();

        let reader = {
            let shared = shared.clone();
            let stop = stop.clone();
            std::thread::spawn(move || pump_events(shared, stop, conn))
        };
        let writer = {
            let stop = stop.clone();
            std::thread::spawn(move || pump_commands(stop, write_half, rx))
        };

        {
            let mut props = self.shared.props.lock().unwrap();
            *props = json!({});
        }
        *self.proc.lock().unwrap() = Some(Proc {
            child,
            socket: sock,
            tx: tx.clone(),
            stop,
            threads: vec![reader, writer],
        });

        for (i, name) in OBSERVED.iter().enumerate() {
            let _ = tx.send(json!({ "command": ["observe_property", (i + 1) as u64, name] }));
        }
        self.shared.touch();
        Ok(())
    }

    /// Load a URL into the (re)started MPV process.
    pub fn start(&self, url: &str, o: &StartOpts) -> Result<Value> {
        if !self.running() {
            self.spawn(o)?;
        }
        // Per-file preferences (apply before the load so MPV picks tracks itself).
        if let Some(ua) = &o.user_agent {
            let _ = self.set_prop("user-agent", json!(ua));
        }
        if let Some(a) = &o.alang {
            let _ = self.set_prop("alang", json!(a));
        }
        if let Some(s) = &o.slang {
            let _ = self.set_prop("slang", json!(s));
        }
        if let Some(t) = &o.title {
            let _ = self.set_prop("title", json!(format!("{t} — BabyFlix")));
        }
        if let Some(v) = o.volume {
            let _ = self.set_prop("volume", json!(v.clamp(0, 150)));
        }
        if let Some(m) = o.muted {
            let _ = self.set_prop("mute", json!(if m { "yes" } else { "no" }));
        }
        if let Some(s) = o.speed {
            let _ = self.set_prop("speed", json!(s.clamp(0.25, 4.0)));
        }
        if let Some(fs) = o.fullscreen {
            let _ = self.set_prop("fullscreen", json!(fs));
        }
        if let Some(top) = o.ontop {
            let _ = self.set_prop("ontop", json!(top));
        }

        // Options MPV applies while opening the file (avoids track/seek races).
        let mut opts = Map::new();
        if let Some(start) = o.start {
            if start > 1.0 {
                opts.insert("start".into(), json!(format!("{start:.3}")));
            }
        }
        if let Some(aid) = o.audio {
            if aid >= 0 {
                opts.insert("aid".into(), json!(aid.to_string()));
            }
        }
        if let Some(sid) = o.sub {
            opts.insert("sid".into(), json!(sid.to_string()));
        }
        opts.insert("pause".into(), json!("no"));

        {
            let mut props = self.shared.props.lock().unwrap();
            *props = json!({});
        }
        self.shared.push(json!({ "event": "babyflix-start", "url": url }));
        self.command(&[
            json!("loadfile"),
            json!(url),
            json!("replace"),
            Value::Object(opts),
        ])?;
        Ok(json!({ "ok": true, "url": url, "path": self.path() }))
    }

    pub fn stop(&self) {
        let taken = self.proc.lock().unwrap().take();
        if let Some(mut proc) = taken {
            let _ = proc.tx.send(json!({ "command": ["quit"] }));
            let deadline = Instant::now() + Duration::from_millis(1500);
            loop {
                match proc.child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if Instant::now() > deadline {
                            let _ = proc.child.kill();
                            let _ = proc.child.wait();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
            proc.stop.store(true, Ordering::SeqCst);
            drop(proc.tx);
            for t in proc.threads {
                let _ = t.join();
            }
            #[cfg(unix)]
            {
                let _ = std::fs::remove_file(&proc.socket);
            }
        }
        // Release the native video surface together with the process.
        {
            let mut st = self.stage.lock().unwrap();
            if let Some(mut s) = st.stage.take() {
                s.destroy();
            }
            st.visible = false;
        }
        *self.shared.props.lock().unwrap() = json!({});
    }

    /// Stop MPV when the UI has not touched it for a long time.
    pub fn reap(&self) {
        if !self.running() {
            return;
        }
        let idle = self.shared.last.lock().unwrap().elapsed();
        if idle > IDLE_TIMEOUT {
            self.stop();
        }
    }
}

/// Read the JSON IPC stream: mirror properties, log the events for the UI.
fn pump_events(shared: Arc<Shared>, stop: Arc<AtomicBool>, conn: Ipc) {
    let reader = BufReader::new(conn);
    let mut last_pos = Instant::now() - POS_THROTTLE;
    for line in reader.lines() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(text) = line else { break };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            continue;
        };
        if value.get("event").and_then(|e| e.as_str()) == Some("property-change") {
            let name = value
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string();
            if !name.is_empty() {
                let data = value.get("data").cloned().unwrap_or(Value::Null);
                shared.set(&name, &data);
                if name == "time-pos" {
                    if last_pos.elapsed() < POS_THROTTLE {
                        continue;
                    }
                    last_pos = Instant::now();
                }
            }
        }
        shared.push(value);
    }
}

/// Forward commands to MPV.
fn pump_commands(stop: Arc<AtomicBool>, mut conn: Ipc, rx: std::sync::mpsc::Receiver<Value>) {
    while let Ok(cmd) = rx.recv() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let mut line = cmd.to_string();
        line.push('\n');
        if conn.write_all(line.as_bytes()).is_err() {
            break;
        }
        let _ = conn.flush();
    }
}

#[cfg(test)]
mod tests {
    //! Headless end-to-end test against a real MPV process:
    //! spawn -> IPC connect -> load -> time-pos -> seek -> speed -> EOF.
    //! Needs `mpv` and a short clip (env `BABYFLIX_MPV_TESTCLIP`), else it is skipped.
    use super::*;
    use std::sync::MutexGuard;

    static SERIAL: Mutex<()> = Mutex::new(());

    fn clip() -> Option<PathBuf> {
        if let Ok(p) = std::env::var("BABYFLIX_MPV_TESTCLIP") {
            let path = PathBuf::from(p);
            if path.is_file() {
                return Some(path);
            }
        }
        let fallback = PathBuf::from("/tmp/mpvtest/clip.mp4");
        if fallback.is_file() {
            Some(fallback)
        } else {
            None
        }
    }

    fn wait_for<F: Fn(&Value) -> bool>(mpv: &Mpv, what: &str, secs: u64, pred: F) -> bool {
        let deadline = Instant::now() + Duration::from_secs(secs);
        loop {
            let props = mpv.props();
            if pred(&props) {
                return true;
            }
            if Instant::now() > deadline {
                eprintln!("[mpv-test] timeout waiting for {what}: {props}");
                return false;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    #[test]
    fn plays_seeks_and_reports_eof() {
        let _guard: MutexGuard<()> = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let Some(clip) = clip() else {
            eprintln!("[mpv-test] skipped: no test clip available");
            return;
        };
        let mpv = Mpv::new(std::env::temp_dir().join("babyflix-mpv-test"));
        assert!(mpv.available(), "mpv binary should be found: {:?}", mpv.path());
        eprintln!("[mpv-test] using {}", mpv.version().unwrap_or_default());

        // Headless: no window/audio device needed on a build machine.
        std::env::set_var("BABYFLIX_MPV_VO", "null");
        std::env::set_var("BABYFLIX_MPV_HWDEC", "no");
        std::env::set_var("BABYFLIX_MPV_PROFILE", "none");
        std::env::set_var("BABYFLIX_MPV_EXTRA", "--ao=null --no-config --really-quiet");

        let url = clip.to_string_lossy().into_owned();
        let opts = StartOpts {
            title: Some("BabyFlix Test".into()),
            volume: Some(70),
            alang: Some("de,en".into()),
            slang: Some("de,en,off".into()),
            ..Default::default()
        };
        mpv.start(&url, &opts).expect("mpv should accept the file");
        assert!(mpv.running(), "mpv process should be alive");

        assert!(
            wait_for(&mpv, "time-pos", 20, |p| p["time-pos"].as_f64().unwrap_or(0.0) > 0.2),
            "playback should advance"
        );
        let duration = mpv.props()["duration"].as_f64().unwrap_or(0.0);
        assert!(duration > 1.0, "duration should be reported, got {duration}");
        assert_eq!(mpv.props()["volume"].as_f64().unwrap_or(0.0), 70.0);

        // Frame-exact seek (the webview player needs a remux for this).
        mpv.set_prop("time-pos", json!(1.5)).unwrap();
        assert!(
            wait_for(&mpv, "seeked time-pos", 10, |p| {
                p["time-pos"].as_f64().unwrap_or(0.0) >= 1.4
            }),
            "seek should land at the requested position"
        );

        // Speed changes take effect immediately.
        mpv.set_prop("speed", json!(2.0)).unwrap();
        assert!(
            wait_for(&mpv, "speed", 5, |p| p["speed"].as_f64() == Some(2.0)),
            "speed should be applied"
        );

        // Pause / resume through the same path the UI uses.
        mpv.set_prop("pause", json!(true)).unwrap();
        assert!(wait_for(&mpv, "pause", 5, |p| p["pause"] == json!(true)));
        let paused_at = mpv.props()["time-pos"].as_f64().unwrap_or(0.0);
        std::thread::sleep(Duration::from_millis(600));
        let still_at = mpv.props()["time-pos"].as_f64().unwrap_or(0.0);
        assert!(
            (still_at - paused_at).abs() < 0.2,
            "paused playback must not advance ({paused_at} -> {still_at})"
        );
        mpv.set_prop("pause", json!(false)).unwrap();

        // EOF must be observable - that is what drives "next episode".
        assert!(
            wait_for(&mpv, "eof", 30, |p| p["eof-reached"] == json!(true)),
            "end of file should be reported"
        );
        let saw_end = mpv.poll(0)["events"]
            .as_array()
            .map(|evs| {
                evs.iter().any(|e| {
                    e.get("event").and_then(|x| x.as_str()) == Some("end-file")
                        || (e.get("event").and_then(|x| x.as_str()) == Some("property-change")
                            && e.get("name").and_then(|n| n.as_str()) == Some("eof-reached"))
                })
            })
            .unwrap_or(false);
        assert!(saw_end, "the event ring must carry the end-of-file event");

        mpv.stop();
        assert!(!mpv.running(), "stop() must end the process");

        std::env::remove_var("BABYFLIX_MPV_VO");
        std::env::remove_var("BABYFLIX_MPV_HWDEC");
        std::env::remove_var("BABYFLIX_MPV_PROFILE");
        std::env::remove_var("BABYFLIX_MPV_EXTRA");
    }
}
