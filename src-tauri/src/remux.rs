//! On-the-fly FFmpeg remux to HLS for VOD playback.
//! Used for every movie/series so that: containers the webview cannot play (MKV, AVI, …) work,
//! audio codecs are normalised (e.g. DTS/AC3 -> AAC) and all audio tracks are selectable.
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::xtream::UA;

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
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
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

fn find_exe(name: &str, env_var: &str) -> Option<PathBuf> {
    if let Ok(p) = std::env::var(env_var) {
        let p = PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let out = Command::new("where").arg(name).output().ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines() {
            let p = PathBuf::from(line.trim());
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
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
        Remux {
            root,
            ffmpeg: find_exe("ffmpeg", "BABYFLIX_FFMPEG"),
            ffprobe: find_exe("ffprobe", "BABYFLIX_FFPROBE"),
            sessions: Mutex::new(HashMap::new()),
            keys: Mutex::new(HashMap::new()),
        }
    }

    pub fn available(&self) -> bool {
        self.ffmpeg.is_some()
    }

    fn probe_json(&self, url: &str) -> Option<Value> {
        let ffprobe = self.ffprobe.as_ref()?;
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
        let ffmpeg = self.ffmpeg.clone().ok_or_else(|| anyhow!("ffmpeg not found"))?;

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
