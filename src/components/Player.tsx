import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ChevronLeft,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { playerUrl } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtTime } from "../lib/format";
import { useT } from "../lib/i18n";

export function Player() {
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
  const hideTimer = useRef<number | null>(null);
  const lastSave = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const streamKey = current ? `${current.kind}:${current.id}` : "";

  const cleanup = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  // load stream
  useEffect(() => {
    const video = videoRef.current;
    if (!current || !video) return;
    setError(false);
    setLoading(true);
    setPosition(0);
    setDuration(0);
    cleanup();

    const url = playerUrl(current.kind, current.id, current.ext);
    const ext = (current.ext || "").toLowerCase();
    const useHls = current.kind === "live" || ext.includes("m3u8") || ext === "";

    const attachNative = () => {
      video.src = url;
      video.load();
    };

    if (useHls && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: current.kind === "live",
        backBufferLength: 90,
        maxBufferLength: 30,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else {
            cleanup();
            attachNative();
          }
        }
      });
    } else {
      attachNative();
    }

    const resume = history.find((h) => h.key === current.historyKey);
    const onLoaded = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setLoading(false);
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
      setLoading(false);
      setError(true);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("error", onErr);
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("error", onErr);
      cleanup();
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

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
          if (!document.fullscreenElement) close();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, toggle, seek, toggleFullscreen, close]);

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
            <span className="w-14 text-xs tabular-nums text-white/70">
              {fmtTimeClock(duration)}
            </span>
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

function fmtTimeClock(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "00:00";
  const s = Math.floor(secs % 60);
  const m = Math.floor((secs / 60) % 60);
  const h = Math.floor(secs / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
