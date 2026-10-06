import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ChevronLeft,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Settings2,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { API_BASE, playerUrl } from "../lib/api";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtTime } from "../lib/format";
import { useLang, useT } from "../lib/i18n";

interface TrackInfo {
  name: string;
  lang?: string;
}
interface LevelInfo {
  height?: number;
  bitrate?: number;
}

const LANGS: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  nl: "Nederlands",
  pl: "Polski",
  tr: "Türkçe",
  ru: "Русский",
  ar: "العربية",
  pt: "Português",
  sv: "Svenska",
  da: "Dansk",
  cs: "Čeština",
  el: "Ελληνικά",
};

function langName(code?: string): string {
  if (!code) return "";
  return LANGS[code.toLowerCase().slice(0, 2)] || code.toUpperCase();
}

function isGermanTrack(lang?: string | null, title?: string | null): boolean {
  const l = (lang || "").toLowerCase();
  if (l === "de" || l === "ger" || l === "deu" || l.startsWith("de")) return true;
  const t = (title || "").toLowerCase();
  return t.includes("deutsch") || t.includes("german");
}

// Containers the webview can play directly.
const BROWSER_CONTAINERS = ["mp4", "m4v", "webm", "ogv", "ogg"];

export function Player() {
  const appLang = useLang((s) => s.lang);
  const t = useT();
  const current = useStore((s) => s.current);
  const stop = useStore((s) => s.stop);
  const play = useStore((s) => s.play);
  const saveHistory = useStore((s) => s.saveHistory);
  const history = useStore((s) => s.history);
  const autoplayNext = useStore((s) => s.autoplayNext);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const remuxRef = useRef(false);
  const remuxTokenRef = useRef<string | null>(null);
  const hideTimer = useRef<number | null>(null);
  const lastSave = useRef(0);
  const autoAudioRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // track selection
  const [tracksOpen, setTracksOpen] = useState(false);
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([]);
  const [audioIndex, setAudioIndex] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<TrackInfo[]>([]);
  const [subtitleIndex, setSubtitleIndex] = useState(-1);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [levelIndex, setLevelIndex] = useState(-1);

  // remux (FFmpeg) options
  const [remuxAudio, setRemuxAudio] = useState(0);
  const [forceRemux, setForceRemux] = useState(false);

  const streamKey = current ? `${current.kind}:${current.id}` : "";

  const cleanup = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const resetTracks = useCallback(() => {
    setAudioTracks([]);
    setAudioIndex(-1);
    setSubtitleTracks([]);
    setSubtitleIndex(-1);
    setLevels([]);
    setLevelIndex(-1);
    setTracksOpen(false);
  }, []);

  // reset per-stream options when the stream changes
  useEffect(() => {
    setRemuxAudio(0);
    setForceRemux(false);
    autoAudioRef.current = false;
  }, [streamKey]);

  // load stream
  useEffect(() => {
    const video = videoRef.current;
    if (!current || !video) return;
    setError(false);
    setLoading(true);
    setPosition(0);
    setDuration(0);
    resetTracks();
    cleanup();
    let cancelled = false;
    let sessionToken: string | null = null;

    const ext = (current.ext || "").toLowerCase();
    const isVod = current.kind !== "live";
    const wantRemux = isVod && (forceRemux || (ext !== "" && !BROWSER_CONTAINERS.includes(ext)));
    remuxRef.current = wantRemux;

    const directUrl = playerUrl(current.kind, current.id, current.ext);

    const setupHls = (src: string, onFatal: () => void) => {
      const hls = new Hls({
        lowLatencyMode: current.kind === "live",
        backBufferLength: 90,
        maxBufferLength: 30,
        enableWorker: true,
      });
      hlsRef.current = hls;
      const refreshTracks = () => {
        setAudioTracks((hls.audioTracks || []).map((a) => ({ name: a.name || a.lang || "Audio", lang: a.lang })));
        setAudioIndex(hls.audioTrack ?? -1);
        setSubtitleTracks(
          (hls.subtitleTracks || []).map((s) => ({ name: s.name || s.lang || "Subtitle", lang: s.lang }))
        );
        setSubtitleIndex(hls.subtitleTrack ?? -1);
        setLevels((hls.levels || []).map((l) => ({ height: l.height, bitrate: l.bitrate })));
      };
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
      hls.on(Hls.Events.MANIFEST_PARSED, refreshTracks);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, refreshTracks);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, refreshTracks);
      hls.on(Hls.Events.LEVELS_UPDATED, refreshTracks);
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => setSubtitleIndex(hls.subtitleTrack));
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => setAudioIndex(hls.audioTrack));
      hls.on(Hls.Events.LEVEL_SWITCHED, () => setLevelIndex(hls.autoLevelEnabled ? -1 : hls.currentLevel));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else onFatal();
      });
    };

    const attachNative = (src: string) => {
      video.src = src;
      video.load();
    };

    const startPlayback = async () => {
      if (wantRemux) {
        try {
          let audioIdx = remuxAudio;
          if (!autoAudioRef.current) {
            autoAudioRef.current = true;
            try {
              const info = await api.streams(current.kind, current.id, current.ext);
              if (cancelled) return;
              if (info.audio?.length) {
                setAudioTracks(
                  info.audio.map((a, i) => ({
                    name: a.title || a.codec || `Audio ${i + 1}`,
                    lang: a.lang ?? undefined,
                  }))
                );
                if (appLang === "de") {
                  const gi = info.audio.findIndex((a) => isGermanTrack(a.lang, a.title));
                  if (gi >= 0) audioIdx = gi;
                }
              }
            } catch {
              /* ignore */
            }
          }
          const res = await api.remux(current.kind, current.id, current.ext, audioIdx);
          if (cancelled) {
            api.remuxStop(res.token);
            return;
          }
          sessionToken = res.token;
          remuxTokenRef.current = res.token;
          setAudioIndex(audioIdx);
          if (res.duration && res.duration > 0) setDuration(res.duration);
          setupHls(API_BASE + res.playlist, () => setError(true));
          return;
        } catch {
          // FFmpeg unavailable or remux failed -> try direct playback
        }
      }
      const useHls = current.kind === "live" || ext.includes("m3u8") || ext === "";
      if (useHls && Hls.isSupported()) {
        setupHls(directUrl, () => {
          if (isVod && !forceRemux) setForceRemux(true);
          else setError(true);
        });
      } else {
        attachNative(directUrl);
      }
    };

    startPlayback();

    const resume = history.find((h) => h.key === current.historyKey);
    const onLoaded = () => {
      if (!remuxRef.current) {
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      }
      setLoading(false);
      if (!hlsRef.current) {
        const subs: TrackInfo[] = [];
        for (let i = 0; i < video.textTracks.length; i++) {
          const tt = video.textTracks[i];
          subs.push({ name: tt.label || tt.language || `Track ${i + 1}`, lang: tt.language });
        }
        if (subs.length) setSubtitleTracks(subs);
      }
      if (resume && resume.position > 10 && current.kind !== "live" && video.duration > 0) {
        video.currentTime = resume.position;
      }
    };
    const onTime = () => {
      setPosition(video.currentTime);
      const now = Date.now();
      if (now - lastSave.current > 4000) {
        lastSave.current = now;
        persist(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0);
      }
    };
    const onErr = () => {
      // A direct attempt on an unsupported container -> switch to remux.
      if (isVod && !remuxRef.current && !forceRemux) {
        setForceRemux(true);
        return;
      }
      setLoading(false);
      setError(true);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("error", onErr);
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("error", onErr);
      cleanup();
      video.removeAttribute("src");
      video.load();
      if (sessionToken) api.remuxStop(sessionToken);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, remuxAudio, forceRemux]);

  const persist = useCallback(
    (pos: number, dur: number) => {
      if (!current) return;
      saveHistory({
        key: current.historyKey,
        kind: current.kind,
        id: current.id,
        ext: current.ext,
        title: current.title,
        poster: current.poster,
        subtitle: current.subtitle,
        position: pos,
        duration: dur,
        updatedAt: Date.now(),
      });
    },
    [current, saveHistory]
  );

  const close = useCallback(() => {
    const v = videoRef.current;
    if (v) persist(v.currentTime, Number.isFinite(v.duration) ? v.duration : 0);
    cleanup();
    stop();
  }, [persist, stop, cleanup]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  }, []);

  const selectAudio = (i: number) => {
    if (remuxRef.current) {
      setRemuxAudio(i);
      setAudioIndex(i);
    } else if (hlsRef.current) {
      hlsRef.current.audioTrack = i;
      setAudioIndex(i);
    }
  };
  const selectSubtitle = (i: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = i;
      setSubtitleIndex(i);
    } else {
      const v = videoRef.current;
      if (v) {
        for (let k = 0; k < v.textTracks.length; k++) {
          v.textTracks[k].mode = k === i ? "showing" : "disabled";
        }
      }
      setSubtitleIndex(i);
    }
  };
  const selectLevel = (i: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = i;
      setLevelIndex(i);
    }
  };

  // keyboard
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowRight":
          seek(10);
          break;
        case "ArrowLeft":
          seek(-10);
          break;
        case "ArrowUp":
          setVolume((v) => Math.min(1, v + 0.1));
          break;
        case "ArrowDown":
          setVolume((v) => Math.max(0, v - 0.1));
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          setMuted((m) => !m);
          break;
        case "Escape":
          if (tracksOpen) setTracksOpen(false);
          else if (!document.fullscreenElement) close();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, toggle, seek, toggleFullscreen, close, tracksOpen]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const revealControls = () => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setShowControls(false);
    }, 3000);
  };

  if (!current) return null;

  const isLive = current.kind === "live";
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  const hasTracks = audioTracks.length > 1 || subtitleTracks.length > 0 || levels.length > 1;

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onMouseMove={revealControls}
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false);
          setPlaying(true);
        }}
        onEnded={() => {
          setPlaying(false);
          if (autoplayNext && current.next) {
            play({
              kind: current.next.kind,
              id: current.next.id,
              ext: current.next.ext,
              title: current.next.title,
              subtitle: current.next.subtitle,
              poster: current.poster,
              historyKey: `${current.next.kind}:${current.next.id}`,
            });
          }
        }}
        playsInline
      />

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-white/80" size={54} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-8 text-center">
          <p className="max-w-md text-sm text-white/80">{t("player.streamError")}</p>
          <button className="btn btn-ghost" onClick={close}>
            {t("common.close")}
          </button>
        </div>
      )}

      {/* top bar */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/85 to-transparent p-5 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          onClick={close}
          aria-label={t("common.back")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
        >
          <ChevronLeft />
        </button>
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-white">{current.title}</div>
          {current.subtitle && (
            <div className="truncate text-xs text-white/60">{current.subtitle}</div>
          )}
        </div>
        {isLive && (
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> {t("player.live")}
          </span>
        )}
        <button
          onClick={close}
          aria-label={t("common.close")}
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
        >
          <X />
        </button>
      </div>

      {/* center play */}
      <button
        onClick={toggle}
        className={`absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-opacity duration-300 hover:bg-white/25 ${
          showControls && !playing ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <Play size={34} fill="currentColor" />
      </button>

      {/* track panel */}
      {tracksOpen && (
        <div className="absolute bottom-24 right-4 z-10 max-h-[60vh] w-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#14161f]/95 p-3 text-sm shadow-2xl backdrop-blur">
          <div className="mb-2 text-xs font-bold uppercase tracking-widest text-white/50">
            {t("player.tracks")}
          </div>

          {audioTracks.length > 0 && (
            <TrackGroup title={t("player.audio")}>
              {audioTracks.map((a, i) => (
                <TrackRow key={i} active={i === audioIndex} onClick={() => selectAudio(i)}>
                  {a.name}
                  {langName(a.lang) ? ` (${langName(a.lang)})` : ""}
                </TrackRow>
              ))}
            </TrackGroup>
          )}

          {subtitleTracks.length > 0 && (
            <TrackGroup title={t("player.subtitles")}>
              <TrackRow active={subtitleIndex === -1} onClick={() => selectSubtitle(-1)}>
                {t("player.subtitleOff")}
              </TrackRow>
              {subtitleTracks.map((s, i) => (
                <TrackRow key={i} active={i === subtitleIndex} onClick={() => selectSubtitle(i)}>
                  {s.name}
                  {langName(s.lang) ? ` (${langName(s.lang)})` : ""}
                </TrackRow>
              ))}
            </TrackGroup>
          )}

          {levels.length > 1 && (
            <TrackGroup title={t("player.quality")}>
              <TrackRow active={levelIndex === -1} onClick={() => selectLevel(-1)}>
                {t("player.auto")}
              </TrackRow>
              {levels.map((l, i) => (
                <TrackRow key={i} active={i === levelIndex} onClick={() => selectLevel(i)}>
                  {l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)} kbps`}
                </TrackRow>
              ))}
            </TrackGroup>
          )}

          {!hasTracks && <div className="px-1 py-2 text-white/60">—</div>}
        </div>
      )}

      {/* bottom controls */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-5 pt-16 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        {!isLive && (
          <div className="mb-3 flex items-center gap-3">
            <span className="w-14 text-right text-xs tabular-nums text-white/70">
              {fmtTimeClock(position)}
            </span>
            <div className="relative flex-1">
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={pct}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (v && duration > 0) v.currentTime = (Number(e.target.value) / 100) * duration;
                }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-[var(--accent-2)]"
                style={{
                  background: `linear-gradient(to right, var(--accent-2) ${pct}%, rgba(255,255,255,0.2) ${pct}%)`,
                }}
              />
            </div>
            <span className="w-14 text-xs tabular-nums text-white/70">{fmtTimeClock(duration)}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button onClick={toggle} className="text-white transition hover:text-[var(--accent-2)]">
            {playing ? <Pause size={26} /> : <Play size={26} fill="currentColor" />}
          </button>
          {!isLive && (
            <button
              onClick={() => seek(10)}
              className="text-white/80 transition hover:text-white"
              title="+10s"
            >
              <SkipForward size={22} />
            </button>
          )}

          <div className="group flex items-center gap-2">
            <button onClick={() => setMuted((m) => !m)} className="text-white/80 hover:text-white">
              {muted || volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setTracksOpen((o) => !o)}
              className={`transition ${
                tracksOpen ? "text-[var(--accent-2)]" : "text-white/80 hover:text-white"
              }`}
              title={t("player.tracks")}
            >
              <Settings2 size={22} />
            </button>
            <span className="hidden text-[11px] font-medium text-white/50 sm:block">
              {isLive ? fmtTime(new Date().getTime() / 1000) : ""}
            </span>
            <button onClick={toggleFullscreen} className="text-white/80 hover:text-white">
              {fullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function TrackRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        active ? "bg-[var(--accent)]/25 text-white" : "text-white/85 hover:bg-white/10"
      }`}
    >
      <span className="truncate">{children}</span>
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-2)]" />}
    </button>
  );
}

function fmtTimeClock(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "00:00";
  const s = Math.floor(secs % 60);
  const m = Math.floor((secs / 60) % 60);
  const h = Math.floor(secs / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
