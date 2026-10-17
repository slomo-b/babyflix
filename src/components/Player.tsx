import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ChevronLeft,
  Keyboard,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { API_BASE, playerUrl } from "../lib/api";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtTime, fmtTimeClock } from "../lib/format";
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

/** Countdown am Folgenende, bevor automatisch die nächste Folge startet. */
const END_COUNTDOWN = 10;

/**
 * Menü-Indizes ab hier gehören zu den aus dem Film extrahierten Untertiteln,
 * nicht zu den Spuren, die hls.js aus dem Manifest kennt.
 */
const NATIVE_SUB_BASE = 100;

/** Text-Untertitel-Codecs, die FFmpeg nach WebVTT wandeln kann. */
const TEXT_SUB_CODECS =
  /^(subrip|srt|ass|ssa|mov_text|webvtt|text|microdvd|jacosub|sami|stl|subviewer|vtt)/i;

/**
 * Beim Ziehen an der Zeitleiste höchstens alle 200 ms springen. Jeder Sprung in
 * einem HLS-Remux kostet ein neues Segment; zu viele pro Sekunde würden ihn
 * ausbremsen. Dazwischen wandert nur die Vorschau.
 */
const DRAG_SEEK_MS = 200;

/** Zeitleiste: klemmt ein Sprungziel in den tatsächlich spulbaren Bereich. */
function clampToSeekable(v: HTMLVideoElement, t: number, dur: number): number {
  let target = Math.min(Math.max(0, t), Math.max(0, dur - 0.5));
  try {
    const r = v.seekable;
    if (r && r.length > 0) {
      const last = r.length - 1;
      for (let i = 0; i < r.length; i++) {
        if (target >= r.start(i) && target <= r.end(i)) return target;
      }
      if (target < r.start(0)) target = r.start(0);
      else target = Math.max(r.start(last), Math.min(target, r.end(last)));
    }
  } catch {
    /* seekable wirft, solange nichts geladen ist */
  }
  return target;
}

/** Tastenkürzel-Übersicht: Taste → i18n-Schlüssel. */
const SHORTCUTS: [string, string][] = [
  ["Space", "player.kPlay"],
  ["← / →", "player.k10"],
  ["⇧ + ← / →", "player.k30"],
  ["↑ / ↓", "player.kVol"],
  ["M", "player.kMute"],
  ["F", "player.kFull"],
  ["0–9", "player.kTenth"],
  ["Home / End", "player.kStartEnd"],
  ["Esc", "player.kEsc"],
];

// Containers the webview can play directly (not used for VOD: we always remux there).

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
  /**
   * Aus dem Film extrahierte Text-Untertitel (WebVTT). Sie werden als echte
   * `<track>`-Elemente angehängt; Indizes im Menü liegen deshalb ab
   * `NATIVE_SUB_BASE`, damit sie mit den hls.js-Spuren nicht kollidieren.
   */
  const [subTrax, setSubTrax] = useState<{ url: string; label: string; lang?: string }[]>([]);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [levelIndex, setLevelIndex] = useState(-1);

  // remux (FFmpeg) options
  const [remuxAudio, setRemuxAudio] = useState(0);
  const [forceRemux, setForceRemux] = useState(false);
  /**
   * Stream that had to be handed to FFmpeg because the panel only delivers raw
   * MPEG-TS for live. Keyed by stream, so a new channel starts with a direct
   * attempt again instead of inheriting the fallback.
   */
  const [liveRemuxFor, setLiveRemuxFor] = useState<string | null>(null);

  // last low-level failure message, shown in the error overlay so a broken stream is debuggable
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // bumping this re-runs the load effect (retry button)
  const [reloadKey, setReloadKey] = useState(0);
  // Automatisches Weiterspielen am Episodenende: `autoOff` schaltet es für die
  // gerade laufende Folge ab (Knopf im „Als Nächstes"-Band).
  const [autoOff, setAutoOff] = useState(false);
  const autoOffRef = useRef(false);

  // Endkarte („Nächste Folge") am Episodenende + Automatik-Countdown.
  const [endMode, setEndMode] = useState<null | "next" | "done">(null);
  const [endIn, setEndIn] = useState(0);
  const endTickRef = useRef<number | null>(null);
  const endInRef = useRef(0);
  const endShownRef = useRef(false);
  const showEndRef = useRef<() => void>(() => {});

  // Zeitleiste: eigener Zeiger statt <input type="range">.
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  /** Zeitpunkt des letzten Zwischensprungs beim Ziehen (Drosselung). */
  const lastDragSeek = useRef(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

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
    autoOffRef.current = false;
    setAutoOff(false);
    setEndMode(null);
    setEndIn(0);
    endInRef.current = 0;
    endShownRef.current = false;
    setHoverPct(null);
    setDragging(false);
    draggingRef.current = false;
    setBufferedPct(0);
    setFlash(null);
    if (endTickRef.current !== null) {
      window.clearInterval(endTickRef.current);
      endTickRef.current = null;
    }
  }, [streamKey]);

  // Tempo auf das Video übertragen – auch nach einem Streamwechsel.
  useEffect(() => {
    speedRef.current = speed;
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed, streamKey]);

  // Echte Episodenlänge (vom Backend geprobt) für den Enden-Wächter bereithalten:
  // Bei HLS-„event"-Streams meldet das Video-Element bis zum Schluss „Infinity".
  const durRef = useRef(0);
  useEffect(() => {
    durRef.current = duration;
  }, [duration]);

  // load stream
  useEffect(() => {
    const video = videoRef.current;
    if (!current || !video) return;
    setError(false);
    setErrorMsg(null);
    setLoading(true);
    setPosition(0);
    setDuration(0);
    resetTracks();
    setSubTrax([]);
    cleanup();
    let cancelled = false;
    let sessionToken: string | null = null;
    let remuxErr: string | null = null;

    const ext = (current.ext || "").toLowerCase();
    const isVod = current.kind !== "live";
    // Always remux VOD so every container/codec plays and all tracks are available.
    // Live is handed to FFmpeg only when the direct attempt failed (`liveRemuxFor`).
    const liveRemux = !isVod && liveRemuxFor === streamKey;
    const wantRemux = isVod || liveRemux;
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
      let networkRetries = 0;
      let mediaRetries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        // Retry a few times (a segment may still be written by FFmpeg), then give up
        // with a visible error instead of spinning forever.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 4) {
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 3) {
          hls.recoverMediaError();
          return;
        }
        setErrorMsg(String(data.details || data.type || "fatal playback error"));
        onFatal();
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
          let preAudio: { lang?: string | null; title?: string | null; codec?: string | null }[] = [];
          if (!autoAudioRef.current) {
            try {
              const info = await api.streams(current.kind, current.id, current.ext);
              if (cancelled) return;
              preAudio = info.audio ?? [];
              if (appLang === "de" && preAudio.length) {
                const gi = preAudio.findIndex((a) => isGermanTrack(a.lang, a.title));
                if (gi >= 0) audioIdx = gi;
              }
            } catch {
              /* ignore */
            }
            autoAudioRef.current = true;
          }
          const res = await api.remux(current.kind, current.id, current.ext, audioIdx, liveRemux);
          if (cancelled) {
            api.remuxStop(res.token);
            return;
          }
          sessionToken = res.token;
          remuxTokenRef.current = res.token;
          const audio = res.audio && res.audio.length ? res.audio : preAudio;
          if (audio.length) {
            setAudioTracks(
              audio.map((a, i) => ({
                name: a.title || a.codec || `Audio ${i + 1}`,
                lang: a.lang ?? undefined,
              }))
            );
          }
          setAudioIndex(audioIdx);
          if (res.duration && res.duration > 0) setDuration(res.duration);

          // Text-Untertitel separat nach WebVTT holen (W4, Variante A). Bewusst
          // ohne await: die Wiedergabe startet sofort, die Untertitel kommen nach.
          const textSubs = res.subtitle.filter(
            (s) => s.codec && s.index != null && TEXT_SUB_CODECS.test(s.codec)
          );
          if (textSubs.length) {
            api
              .subs(
                res.token,
                textSubs.map((s) => s.index as number)
              )
              .then((subs) => {
                if (cancelled) return;
                setSubTrax(
                  subs.tracks.map((track, i) => ({
                    url: track.url,
                    label: textSubs[i]?.title || textSubs[i]?.lang || `Untertitel ${i + 1}`,
                    lang: textSubs[i]?.lang ?? undefined,
                  }))
                );
              })
              .catch(() => undefined); // ohne Untertitel weiterspielen
          }

          setupHls(API_BASE + res.playlist, () => setError(true));
          return;
        } catch (err) {
          // FFmpeg unavailable or remux failed -> try direct playback, but keep the reason
          remuxErr = err instanceof Error ? err.message : String(err);
          // Wichtig: der Direktpfad muss die Länge aus dem Videoelement übernehmen,
          // sonst bleibt die Zeitleiste ohne Gesamtlänge (Füllung/Griff/Vorschau tot).
          remuxRef.current = false;
        }
      }
      const useHls = current.kind === "live" || ext.includes("m3u8") || ext === "";
      if (useHls && Hls.isSupported()) {
        setupHls(directUrl, () => {
          if (isVod && !forceRemux) setForceRemux(true);
          // A panel that only delivers raw MPEG-TS cannot be played by hls.js
          // directly - hand it to FFmpeg and play its rolling HLS playlist.
          else if (!isVod && !liveRemux) setLiveRemuxFor(streamKey);
          else setError(true);
        });
      } else {
        attachNative(directUrl);
      }
    };

    startPlayback();

    const resume = history.find((h) => h.key === current.historyKey);

    let endTimer: number | null = null;
    // Am Ende wird nicht mehr still weitergeschaltet: es kommt die Endkarte,
    // die den Wechsel anbietet (und je nach Einstellung automatisch startet).
    const onEnded = () => {
      setPlaying(false);
      if (endShownRef.current) return;
      showEndRef.current();
    };

    const onLoaded = () => {
      if (!remuxRef.current) {
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      }
      video.playbackRate = speedRef.current;
      setLoading(false);
      if (!hlsRef.current) {
        const subs: TrackInfo[] = [];
        for (let i = 0; i < video.textTracks.length; i++) {
          const tt = video.textTracks[i];
          subs.push({ name: tt.label || tt.language || `Track ${i + 1}`, lang: tt.language });
        }
        if (subs.length) setSubtitleTracks(subs);
      }
      const startAt = current.startAt;
      if (startAt && startAt > 10 && current.kind !== "live" && video.duration > 0) {
        video.currentTime = Math.min(startAt, Math.max(0, video.duration - 5));
      } else if (resume && resume.position > 10 && current.kind !== "live" && video.duration > 0) {
        video.currentTime = resume.position;
      }
      // Quelle wirklich anspielen – auch die automatisch nachgeschobene Folge,
      // bei der kein Klick des Nutzers mehr kommt.
      const started = video.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    };
    const onTime = () => {
      setPosition(video.currentTime);
      const elDur = Number.isFinite(video.duration) ? video.duration : 0;
      const dur = elDur > 0 ? elDur : durRef.current;
      // Solange die Backend-Länge fehlt, die des Videoelements übernehmen.
      if (elDur > 0) setDuration((d) => (d > 0 ? d : elDur));
      const now = Date.now();
      if (now - lastSave.current > 4000) {
        lastSave.current = now;
        persist(video.currentTime, dur);
      }
      // Gepufferter Bereich (heller Balken hinter dem Fortschritt).
      try {
        const b = video.buffered;
        let end = 0;
        for (let i = 0; i < b.length; i++) {
          if (video.currentTime >= b.start(i) - 0.5 && video.currentTime <= b.end(i) + 5) {
            end = b.end(i);
            break;
          }
        }
        if (!end && b.length) end = b.end(b.length - 1);
        setBufferedPct(dur > 0 ? Math.min(100, (end / dur) * 100) : 0);
      } catch {
        /* buffered wirft, solange nichts geladen ist */
      }
      // Wächter: FFmpeg-Remux-Streams (HLS „event") melden am Ende nicht immer
      // ein „ended". Stockt die Wiedergabe am Ende, kommt die Endkarte trotzdem.
      if (current.kind !== "live" && !endShownRef.current) {
        if (dur > 0 && !video.paused && video.currentTime >= dur - 1.5) {
          if (endTimer === null) {
            endTimer = window.setTimeout(() => {
              endTimer = null;
              if (!cancelled) onEnded();
            }, 2000);
          }
        } else if (endTimer !== null) {
          window.clearTimeout(endTimer);
          endTimer = null;
        }
      }
    };
    const onErr = () => {
      // A direct attempt on an unsupported container -> switch to remux.
      if (isVod && !remuxRef.current && !forceRemux) {
        setForceRemux(true);
        return;
      }
      // Same for a live stream that only arrives as raw MPEG-TS (no hls.js).
      if (!isVod && !remuxRef.current && !liveRemux) {
        setLiveRemuxFor(streamKey);
        return;
      }
      const code = video.error?.code;
      setErrorMsg(
        remuxErr ??
          (code === 4 ? t("player.errUnsupported") : t("player.errCode", { code: code ?? "?" }))
      );
      setLoading(false);
      setError(true);
    };

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onErr);
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return () => {
      cancelled = true;
      if (endTimer !== null) window.clearTimeout(endTimer);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onErr);
      cleanup();
      video.removeAttribute("src");
      video.load();
      if (sessionToken) api.remuxStop(sessionToken);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, remuxAudio, forceRemux, liveRemuxFor, reloadKey]);

  const persist = useCallback(
    (pos: number, dur: number) => {
      if (!current) return;
      saveHistory({
        key: current.historyKey,
        kind: current.kind,
        id: current.id,
        ext: current.ext,
        seriesId: current.seriesId,
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

  /** „Jetzt abspielen" im Als-Nächstes-Band. */
  const goNextNow = useCallback(() => {
    const nx = current?.next;
    if (!nx || !current) return;
    play({
      kind: nx.kind,
      id: nx.id,
      ext: nx.ext,
      title: nx.title,
      subtitle: nx.subtitle,
      poster: current.poster,
      historyKey: `${nx.kind}:${nx.id}`,
    });
  }, [current, play]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  /** Verlässliche Gesamtlänge: Element-Dauer, sonst die vom Backend geprobte. */
  const totalDuration = useCallback(() => {
    const v = videoRef.current;
    const elDur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    return elDur > 0 ? elDur : durRef.current;
  }, []);

  /** Endkarte schließen und den Automatik-Countdown stoppen. */
  const cancelEnd = useCallback(() => {
    if (endTickRef.current !== null) {
      window.clearInterval(endTickRef.current);
      endTickRef.current = null;
    }
    endInRef.current = 0;
    setEndIn(0);
    setEndMode(null);
  }, []);

  /** Countdown am Ende: zählt runter und startet dann die nächste Folge. */
  const startCountdown = useCallback(() => {
    if (endTickRef.current !== null) window.clearInterval(endTickRef.current);
    endInRef.current = END_COUNTDOWN;
    setEndIn(END_COUNTDOWN);
    endTickRef.current = window.setInterval(() => {
      endInRef.current -= 1;
      setEndIn(endInRef.current);
      if (endInRef.current <= 0) {
        if (endTickRef.current !== null) {
          window.clearInterval(endTickRef.current);
          endTickRef.current = null;
        }
        goNextNow();
      }
    }, 1000);
  }, [goNextNow]);

  /** „Automatik stoppen": für diese Folge nicht mehr automatisch weiterschalten. */
  const stopAuto = useCallback(() => {
    if (endTickRef.current !== null) {
      window.clearInterval(endTickRef.current);
      endTickRef.current = null;
    }
    endInRef.current = 0;
    setEndIn(0);
    autoOffRef.current = true;
    setAutoOff(true);
  }, []);

  /** Am Folgenende: Endkarte öffnen (mit Countdown, wenn die Automatik aktiv ist). */
  const openEndCard = useCallback(() => {
    if (!current || current.kind === "live" || endShownRef.current) return;
    if (!current.next && current.kind !== "series") return;
    endShownRef.current = true;
    setEndMode(current.next ? "next" : "done");
    if (current.next && autoplayNext && !autoOffRef.current) {
      startCountdown();
    } else {
      endInRef.current = 0;
      setEndIn(0);
    }
  }, [current, autoplayNext, startCountdown]);

  // Die Listener im Ladepfad leben länger als ein Render – sie rufen die
  // jeweils aktuelle Fassung über die Ref auf.
  useEffect(() => {
    showEndRef.current = openEndCard;
  }, [openEndCard]);

  // Beim Verlassen des Players laufen keine Timer weiter.
  useEffect(
    () => () => {
      if (endTickRef.current !== null) window.clearInterval(endTickRef.current);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    []
  );

  /** „Erneut abspielen" (Ende der Serie). */
  const restart = useCallback(() => {
    cancelEnd();
    endShownRef.current = false;
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
    v.play().catch(() => {});
  }, [cancelEnd]);

  /** Sprung an eine absolute Zeit (Zeitleiste, Kürzel). */
  const seekToTime = useCallback(
    (t: number, keepHover = false) => {
      const v = videoRef.current;
      if (!v) return;
      const dur = totalDuration();
      if (!(dur > 0)) return;
      const target = clampToSeekable(v, t, dur);
      try {
        v.currentTime = target;
      } catch {
        /* ignore */
      }
      setPosition(target);
      // Beim Ziehen soll die Vorschau-Anzeige dem Zeiger folgen und nicht nach
      // jedem Zwischensprung verschwinden.
      if (!keepHover) setHoverPct(null);
      // Zurückspulen heißt: wieder mitten in der Folge.
      endShownRef.current = false;
      cancelEnd();
    },
    [cancelEnd, totalDuration]
  );

  /** Kurzer Einblender („+10 s") beim Springen. */
  const showFlash = useCallback((text: string) => {
    setFlash(text);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 700);
  }, []);

  const seek = useCallback(
    (delta: number, withFlash = true) => {
      const v = videoRef.current;
      if (!v) return;
      const dur = totalDuration();
      if (!(dur > 0)) return;
      if (withFlash) showFlash(`${delta > 0 ? "+" : "−"}${Math.abs(delta)} s`);
      seekToTime(v.currentTime + delta);
    },
    [showFlash, seekToTime, totalDuration]
  );

  // Zeitleiste: Zeigerposition → Anteil.
  const barPctFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget.getBoundingClientRect();
    if (!el.width) return 0;
    return Math.min(1, Math.max(0, (e.clientX - el.left) / el.width));
  };
  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (current?.kind === "live") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setHoverPct(barPctFromEvent(e));
    lastDragSeek.current = 0;
  };
  /**
   * Ziehen spult mit: das Bild folgt dem Zeiger, statt erst beim Loslassen zu
   * springen. Gedrosselt (siehe DRAG_SEEK_MS), damit der Remux hinterherkommt.
   */
  const onBarMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const f = barPctFromEvent(e);
    setHoverPct(f);
    if (!draggingRef.current) return;
    const dur = totalDuration();
    if (!(dur > 0)) return;
    const now = performance.now();
    if (now - lastDragSeek.current < DRAG_SEEK_MS) return;
    lastDragSeek.current = now;
    seekToTime(f * dur, true);
  };
  const onBarUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasDragging = draggingRef.current;
    const f = barPctFromEvent(e);
    draggingRef.current = false;
    setDragging(false);
    setHoverPct(null);
    if (!wasDragging) return;
    const dur = totalDuration();
    if (dur > 0) seekToTime(f * dur);
  };

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
    const v = videoRef.current;
    // Indizes ab NATIVE_SUB_BASE gehören zu den extrahierten <track>-Elementen.
    const native = i >= NATIVE_SUB_BASE ? i - NATIVE_SUB_BASE : -1;
    if (hlsRef.current) hlsRef.current.subtitleTrack = native === -1 ? i : -1;
    v?.querySelectorAll("track").forEach((el, k) => {
      const tt = (el as HTMLTrackElement).track;
      if (tt) tt.mode = k === native ? "showing" : "disabled";
    });
    setSubtitleIndex(i);
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
    const live = current.kind === "live";
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowRight":
          if (live) return;
          e.preventDefault();
          seek(e.shiftKey ? 30 : 10);
          break;
        case "ArrowLeft":
          if (live) return;
          e.preventDefault();
          seek(e.shiftKey ? -30 : -10);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume((v) => Math.min(1, v + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume((v) => Math.max(0, v - 0.1));
          break;
        case "j":
        case "J":
          if (!live) seek(-10);
          break;
        case "l":
        case "L":
          if (!live) seek(10);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "m":
        case "M":
          setMuted((m) => !m);
          break;
        case "?":
          setHelpOpen((o) => !o);
          break;
        case "Home":
          if (!live) seekToTime(0);
          break;
        case "End":
          if (!live) seekToTime(totalDuration() - 2);
          break;
        case "Escape":
          if (helpOpen) setHelpOpen(false);
          else if (tracksOpen) setTracksOpen(false);
          else if (endMode !== null) cancelEnd();
          else if (!document.fullscreenElement) close();
          break;
        default:
          if (!live && /^[0-9]$/.test(e.key)) seekToTime(totalDuration() * (Number(e.key) / 10));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    current,
    toggle,
    seek,
    toggleFullscreen,
    close,
    tracksOpen,
    helpOpen,
    endMode,
    cancelEnd,
    seekToTime,
    totalDuration,
  ]);

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
      const busy = draggingRef.current || endMode !== null || helpOpen || tracksOpen;
      if (!videoRef.current?.paused && !busy) setShowControls(false);
    }, 3000);
  };

  if (!current) return null;

  const isLive = current.kind === "live";
  const totalSecs = duration > 0 ? duration : durRef.current;
  const pct = totalSecs > 0 ? (position / totalSecs) * 100 : 0;
  const hasTracks =
    audioTracks.length > 1 || subtitleTracks.length > 0 || subTrax.length > 0 || levels.length > 1;
  // Zeitleiste: beim Ziehen/Hovern zeigt sie die Vorschau-Position.
  const previewSecs = hoverPct !== null ? hoverPct * totalSecs : null;
  const barPct = previewSecs !== null && totalSecs > 0 ? (previewSecs / totalSecs) * 100 : pct;
  const gripOn = hoverPct !== null || dragging;
  // Im letzten Stück einer Folge wird die nächste angeteasert.
  const upNext =
    !isLive &&
    !autoOff &&
    !error &&
    !endMode &&
    duration > 0 &&
    position >= duration - 20 &&
    current.next
      ? current.next
      : null;

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onMouseMove={revealControls}
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black object-contain"
        onDoubleClick={(e) => {
          if (current.kind === "live") return;
          const r = e.currentTarget.getBoundingClientRect();
          const left = (e.clientX - r.left) / Math.max(1, r.width) < 0.5;
          seek(left ? -10 : 10);
        }}
        onPlay={() => {
          setPlaying(true);
          cancelEnd();
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false);
          setPlaying(true);
        }}
        playsInline
      >
        {subTrax.map((s, i) => (
          <track
            key={s.url}
            kind="subtitles"
            src={API_BASE + s.url}
            label={s.label}
            srcLang={s.lang || "und"}
            default={false}
            data-native-sub={NATIVE_SUB_BASE + i}
          />
        ))}
      </video>

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-white/80" size={54} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-8 text-center">
          <p className="max-w-md text-sm text-white/80">{t("player.streamError")}</p>
          {errorMsg && <p className="max-w-md break-words text-xs text-white/50">{errorMsg}</p>}
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => {
                setError(false);
                setErrorMsg(null);
                setLoading(true);
                setForceRemux(false);
                setReloadKey((k) => k + 1);
              }}
            >
              {t("common.retry")}
            </button>
            <button className="btn btn-ghost" onClick={close}>
              {t("common.close")}
            </button>
          </div>
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

      {/* Einblender beim Springen (+10 s / −10 s) */}
      {flash && (
        <div
          className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${
            flash.startsWith("+") ? "left-[72%]" : "left-[28%]"
          }`}
        >
          <div className="rounded-2xl bg-black/60 px-5 py-3 text-lg font-bold tabular-nums text-white backdrop-blur">
            {flash}
          </div>
        </div>
      )}

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

          {(subtitleTracks.length > 0 || subTrax.length > 0) && (
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
              {subTrax.map((s, i) => (
                <TrackRow
                  key={s.url}
                  active={NATIVE_SUB_BASE + i === subtitleIndex}
                  onClick={() => selectSubtitle(NATIVE_SUB_BASE + i)}
                >
                  {s.label}
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

          {!isLive && (
            <TrackGroup title={t("player.speed")}>
              <div className="flex flex-wrap gap-1 px-1">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <button
                    key={r}
                    onClick={() => setSpeed(r)}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold tabular-nums transition ${
                      speed === r
                        ? "bg-[var(--accent)]/30 text-white"
                        : "bg-white/5 text-white/75 hover:bg-white/15"
                    }`}
                  >
                    {r.toLocaleString(appLang === "de" ? "de-DE" : "en-US")}×
                  </button>
                ))}
              </div>
            </TrackGroup>
          )}

          {!hasTracks && isLive && <div className="px-1 py-2 text-white/60">—</div>}
        </div>
      )}

      {/* „Als Nächstes": läuft eine Folge aus, wird die folgende angeteasert. */}
      {upNext && !endMode && !tracksOpen && !helpOpen && (
        <div className="absolute inset-x-0 bottom-32 z-10 flex justify-center px-5">
          <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-black/75 px-4 py-3 backdrop-blur">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">
                {t("player.next")}
              </div>
              <div className="max-w-[52vw] truncate text-sm font-semibold text-white">
                {upNext.subtitle || upNext.title}
              </div>
            </div>
            <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={goNextNow}>
              <Play size={14} fill="currentColor" /> {t("player.playNext")}
            </button>
            <button
              className="shrink-0 rounded-full px-2 py-1 text-xs text-white/60 transition hover:text-white"
              onClick={() => {
                autoOffRef.current = true;
                setAutoOff(true);
              }}
            >
              {t("player.skipNext")}
            </button>
          </div>
        </div>
      )}

      {/* Endkarte: am Ende einer Folge die nächste anbieten */}
      {endMode && (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center bg-black/55 px-4 pb-32 backdrop-blur-sm sm:items-center sm:pb-0"
          onClick={cancelEnd}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#14161f]/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-4 p-5">
              <div className="relative hidden h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-black sm:block">
                {current.poster && (
                  <img src={current.poster} alt="" className="h-full w-full object-cover opacity-70" />
                )}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Play size={26} fill="currentColor" className="text-white/90" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">
                  {endMode === "next" ? t("player.epsEnd") : t("player.seriesEnd")}
                </div>
                <div className="mt-1 text-base font-bold leading-snug text-white">
                  {endMode === "next"
                    ? current.next?.subtitle || current.next?.title
                    : current.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-white/55">
                  {endMode === "next" ? current.title : t("player.seriesEndHint")}
                </div>
                {endMode === "next" && endIn > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-xs font-semibold text-[var(--accent-2)]">
                      {t("player.autoIn", { s: endIn })}
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-[var(--accent-2)] transition-[width] duration-1000 ease-linear"
                        style={{ width: `${(endIn / END_COUNTDOWN) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={cancelEnd}
                aria-label={t("common.close")}
                className="h-8 w-8 shrink-0 rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} className="mx-auto" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-white/[0.03] px-5 py-3.5">
              {endMode === "next" ? (
                <>
                  <button
                    className="btn btn-primary px-4 py-2 text-sm"
                    onClick={() => {
                      cancelEnd();
                      goNextNow();
                    }}
                  >
                    <Play size={16} fill="currentColor" /> {t("player.playNext")}
                  </button>
                  {endIn > 0 && (
                    <button className="btn btn-ghost px-3 py-2 text-sm" onClick={stopAuto}>
                      {t("player.stopAuto")}
                    </button>
                  )}
                </>
              ) : (
                <button className="btn btn-primary px-4 py-2 text-sm" onClick={restart}>
                  <RotateCcw size={16} /> {t("player.replay")}
                </button>
              )}
              <button className="btn btn-ghost ml-auto px-3 py-2 text-sm" onClick={cancelEnd}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tastenkürzel-Übersicht */}
      {helpOpen && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#14161f]/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-widest text-white/60">
                {t("player.shortcuts")}
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                aria-label={t("common.close")}
                className="h-8 w-8 rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} className="mx-auto" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                  <span
                    dir="ltr"
                    className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/85"
                  >
                    {keys}
                  </span>
                  <span className="text-white/70">{t(label)}</span>
                </div>
              ))}
            </div>
          </div>
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
              {fmtTimeClock(previewSecs !== null && dragging ? previewSecs : position)}
            </span>

            {/* Zeitleiste: klick- und ziehbar, mit Vorschau-Zeit und Pufferspur. */}
            <div
              role="slider"
              tabIndex={0}
              aria-label={t("player.seek")}
              aria-valuemin={0}
              aria-valuemax={Math.round(totalSecs)}
              aria-valuenow={Math.round(position)}
              className="group relative flex flex-1 touch-none cursor-pointer items-center rounded-full py-3 outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              onPointerDown={onBarDown}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={onBarUp}
              onPointerLeave={() => {
                if (!draggingRef.current) setHoverPct(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") seek(e.shiftKey ? 30 : 10);
                else if (e.key === "ArrowLeft") seek(e.shiftKey ? -30 : -10);
              }}
            >
              <div className="relative h-1.5 w-full rounded-full bg-white/20 transition-all duration-150 group-hover:h-2.5">
                {/* Puffer */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                  style={{ width: `${Math.min(100, bufferedPct)}%` }}
                />
                {/* Gesehen */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${barPct}%`,
                    background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                  }}
                />
                {/* Griff */}
                <div
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent-2)] shadow-lg transition-all duration-150 ${
                    gripOn ? "h-3.5 w-3.5 opacity-100" : "h-1.5 w-1.5 opacity-0"
                  }`}
                  style={{ left: `${barPct}%` }}
                />
              </div>

              {/* Vorschau-Zeit über dem Zeiger */}
              {previewSecs !== null && totalSecs > 0 && (
                <div
                  className="pointer-events-none absolute -top-2 -translate-x-1/2 rounded-lg bg-black/85 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-lg"
                  style={{ left: `${barPct}%` }}
                >
                  {fmtTimeClock(previewSecs)}
                </div>
              )}
            </div>

            <span className="w-14 text-xs tabular-nums text-white/70">{fmtTimeClock(totalSecs)}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button onClick={toggle} className="text-white transition hover:text-[var(--accent-2)]">
            {playing ? <Pause size={26} /> : <Play size={26} fill="currentColor" />}
          </button>
          {!isLive && (
            <>
              <button
                onClick={() => seek(-10)}
                className="text-white/80 transition hover:text-white"
                title="-10s"
              >
                <SkipBack size={22} />
              </button>
              <button
                onClick={() => seek(10)}
                className="text-white/80 transition hover:text-white"
                title="+10s"
              >
                <SkipForward size={22} />
              </button>
            </>
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
              onClick={() => setHelpOpen((o) => !o)}
              className={`transition ${
                helpOpen ? "text-[var(--accent-2)]" : "text-white/80 hover:text-white"
              }`}
              title={t("player.shortcuts")}
              aria-label={t("player.shortcuts")}
            >
              <Keyboard size={22} />
            </button>
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

