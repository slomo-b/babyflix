import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Keyboard,
  Loader2,
  Maximize,
  Minimize,
  MonitorPlay,
  Pause,
  Pin,
  Play,
  RotateCcw,
  Settings2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, type MpvStartOpts } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtTimeClock } from "../lib/format";
import { useLang, useT } from "../lib/i18n";

/**
 * Native Engines "mpv": Der Rust-Teil startet einen echten MPV-Prozess und steuert
 * ihn über JSON-IPC. Das Bild liegt im MPV-Fenster, dieses Overlay ist die
 * Fernbedienung - gleiche Bedienlogik wie der Webview-Player (Zeitleiste, Tempo,
 * Spuren, Endkarte mit Automatik), nur mit den Fähigkeiten von MPV.
 */

/** Countdown am Folgenende, wie im Webview-Player. */
const END_COUNTDOWN = 10;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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

/** Ton-/Untertitel-Präferenz aus der App-Sprache ableiten. */
function langsFor(lang: string): { alang: string; slang: string } {
  const pref = lang === "de" ? ["de", "ger", "deu", "en", "eng"] : [lang, lang.slice(0, 2), "en", "eng"];
  return { alang: pref.join(","), slang: [...pref, "off"].join(",") };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

type TrackInfo = {
  id: number;
  type: string;
  lang: string;
  title: string;
  codec: string;
  selected: boolean;
};

/** mpv `track-list` → flache Liste. */
function trackList(props: Record<string, unknown>): TrackInfo[] {
  const raw = props["track-list"];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      id: num(t.id, -1),
      type: String(t.type ?? ""),
      lang: String(t.lang ?? ""),
      title: String(t.title ?? ""),
      codec: String(t.codec ?? ""),
      selected: t.selected === true,
    }))
    .filter((t) => t.id >= 0);
}

export function MpvPlayer() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const current = useStore((s) => s.current);
  const stop = useStore((s) => s.stop);
  const play = useStore((s) => s.play);
  const saveHistory = useStore((s) => s.saveHistory);
  const setPlayerEngine = useStore((s) => s.setPlayerEngine);

  const [phase, setPhase] = useState<"starting" | "playing" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [props, setProps] = useState<Record<string, unknown>>({});
  const [showControls, setShowControls] = useState(true);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [endMode, setEndMode] = useState<null | "next" | "end">(null);
  const [endIn, setEndIn] = useState(0);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [localPos, setLocalPos] = useState<number | null>(null);

  const seqRef = useRef(0);
  const seenRunning = useRef(false);
  const endHandled = useRef(false);
  const lastSave = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);
  const endInRef = useRef(0);
  const startedKey = useRef<string | null>(null);

  const propsRef = useRef(props);
  propsRef.current = props;
  const currentRef = useRef(current);
  currentRef.current = current;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const langRef = useRef(lang);
  langRef.current = lang;

  const history = useStore((s) => s.history);
  const autoResume = useStore((s) => s.autoResume);
  const autoplayNext = useStore((s) => s.autoplayNext);
  const historyRef = useRef(history);
  historyRef.current = history;
  const autoResumeRef = useRef(autoResume);
  autoResumeRef.current = autoResume;
  const autoplayNextRef = useRef(autoplayNext);
  autoplayNextRef.current = autoplayNext;

  const isLive = current?.kind === "live";
  const position = localPos ?? num(props["time-pos"]);
  const duration = num(props["duration"]);
  const paused = props["pause"] === true;
  const volume = Math.round(num(props["volume"], 100));
  const muted = props["mute"] === true;
  const speed = num(props["speed"], 1);
  const fullscreen = props["fullscreen"] === true;
  const ontop = props["ontop"] === true;
  const buffering = props["paused-for-cache"] === true;
  const total = duration > 0 ? duration : 0;

  const cmd = useCallback((command: unknown[]) => {
    api.mpvCmd(command).catch(() => {});
  }, []);

  const persist = useCallback(
    (pos: number, dur: number) => {
      const c = currentRef.current;
      if (!c) return;
      saveHistory({
        key: c.historyKey,
        kind: c.kind,
        id: c.id,
        ext: c.ext,
        title: c.title,
        poster: c.poster,
        subtitle: c.subtitle,
        position: pos,
        duration: dur,
        updatedAt: Date.now(),
      });
    },
    [saveHistory]
  );

  /** Overlay schließen (Wiedergabe im MPV-Fenster beenden). */
  const close = useCallback(() => {
    const p = propsRef.current;
    persist(num(p["time-pos"]), num(p["duration"]));
    api.mpvStop().catch(() => {});
    stop();
  }, [persist, stop]);

  const cancelEnd = useCallback(() => {
    if (tickTimer.current !== null) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
    endInRef.current = 0;
    setEndIn(0);
    setEndMode(null);
  }, []);

  const goNextNow = useCallback(() => {
    const c = currentRef.current;
    const nx = c?.next;
    if (!c || !nx) return;
    cancelEnd();
    play({
      kind: nx.kind,
      id: nx.id,
      ext: nx.ext,
      title: nx.title,
      subtitle: nx.subtitle,
      poster: c.poster,
      historyKey: `${nx.kind}:${nx.id}`,
    });
  }, [cancelEnd, play]);

  /** Folge ist durch: Verlauf markieren, dann Endkarte mit Automatik zeigen. */
  const handleEof = useCallback(
    (reason: string) => {
      if (endHandled.current) return;
      endHandled.current = true;
      const p = propsRef.current;
      const dur = num(p["duration"]);
      persist(dur > 0 ? dur : num(p["time-pos"]), dur);
      cmd(["set_property", "pause", "yes"]);
      if (reason === "error") {
        setPhase("error");
        setError(t("player.streamError"));
        return;
      }
      if (currentRef.current?.next && autoplayNextRef.current) {
        setEndMode("next");
        endInRef.current = END_COUNTDOWN;
        setEndIn(END_COUNTDOWN);
        // Zaehler laeuft im Interval; der Folge-Start erst hier (nicht im
        // State-Updater, sonst setState waehrend des Renderns).
        tickTimer.current = window.setInterval(() => {
          endInRef.current -= 1;
          if (endInRef.current <= 0) {
            if (tickTimer.current !== null) {
              window.clearInterval(tickTimer.current);
              tickTimer.current = null;
            }
            endInRef.current = 0;
            setEndIn(0);
            goNextNow();
            return;
          }
          setEndIn(endInRef.current);
        }, 1000);
      } else {
        setEndMode("end");
      }
    },
    [cmd, goNextNow, persist, t]
  );

  const restart = useCallback(() => {
    cancelEnd();
    endHandled.current = false;
    setLocalPos(0);
    cmd(["set_property", "time-pos", 0]);
    cmd(["set_property", "pause", "no"]);
  }, [cancelEnd, cmd]);

  // --- Wiedergabe starten (bei jedem neuen Titel) -------------------------------
  useEffect(() => {
    const c = current;
    if (!c) return;
    if (startedKey.current === c.historyKey) return;
    startedKey.current = c.historyKey;
    endHandled.current = false;
    seenRunning.current = false;
    seqRef.current = 0;
    setPhase("starting");
    setError(null);
    setEndMode(null);
    endInRef.current = 0;
    setEndIn(0);
    setTracksOpen(false);
    setLocalPos(null);

    const hist = historyRef.current.find((h) => h.key === c.historyKey);
    let startAt: number | undefined;
    if (c.startAt && c.startAt > 10) startAt = c.startAt;
    else if (autoResumeRef.current && hist && hist.position > 10 && c.kind !== "live") startAt = hist.position;

    const { alang, slang } = langsFor(langRef.current);
    const opts: MpvStartOpts = {
      kind: c.kind,
      id: c.id,
      ext: c.ext,
      start: startAt,
      volume,
      muted,
      speed,
      alang,
      slang,
      ontop: true,
      title: [c.title, c.subtitle].filter(Boolean).join(" · "),
    };
    api
      .mpvStart(opts)
      .then(() => setPhase("playing"))
      .catch((e: unknown) => {
        setPhase("error");
        setError(e instanceof Error ? e.message : String(e));
      });
    // Bewusst nur an den Titel gebunden: Verlaufs-Schreibvorgänge dürfen die
    // Wiedergabe nicht neu starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.historyKey]);

  // --- Zustand pollen ----------------------------------------------------------
  useEffect(() => {
    if (!current) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.mpvPoll(seqRef.current);
        if (!alive) return;
        seqRef.current = r.reset ? 0 : r.seq;
        setProps(r.props);
        if (r.running) {
          seenRunning.current = true;
        } else if (seenRunning.current && !endHandled.current) {
          // Nutzer hat das MPV-Fenster selbst geschlossen: Position sichern, raus.
          const p = propsRef.current;
          persist(num(p["time-pos"]), num(p["duration"]));
          stop();
          return;
        }
        for (const ev of r.events) {
          if (ev.event === "end-file") handleEof(String(ev.reason ?? ""));
        }
      } catch {
        /* Rust-Backend weg: Overlay schließen statt endlos zu pollen. */
        if (alive) stop();
      }
    };
    tick();
    const id = window.setInterval(tick, 400);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [current?.historyKey, handleEof, persist, stop]);

  // Verlauf regelmäßig sichern (wie der Webview-Player alle ~4 s).
  useEffect(() => {
    if (!current || phase !== "playing") return;
    const now = Date.now();
    if (now - lastSave.current < 4000) return;
    lastSave.current = now;
    const p = propsRef.current;
    persist(num(p["time-pos"]), num(p["duration"]));
  }, [props, current, phase, persist]);

  // Beim echten Verlassen des Overlays aufräumen. Der Stop wird kurz verzögert,
  // damit React.StrictMode (Effekt-Cleanup + sofortiges Neu-Mounten im Dev-Modus)
  // den frisch gestarteten MPV-Prozess nicht gleich wieder killt.
  const stopTimer = useRef<number | null>(null);
  useEffect(() => {
    if (stopTimer.current !== null) {
      window.clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    return () => {
      if (tickTimer.current !== null) {
        window.clearInterval(tickTimer.current);
        tickTimer.current = null;
      }
      stopTimer.current = window.setTimeout(() => {
        stopTimer.current = null;
        api.mpvStop().catch(() => {});
      }, 400);
    };
  }, []);

  const seekTo = useCallback(
    (secs: number) => {
      const target = Math.max(0, total > 0 ? Math.min(secs, total - 0.2) : secs);
      setLocalPos(target);
      cmd(["set_property", "time-pos", target]);
    },
    [cmd, total]
  );

  const seek = useCallback((delta: number) => seekTo(position + delta), [position, seekTo]);

  // Steuerleiste ein-/ausblenden.
  const bump = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowControls(false), 3200);
  }, []);

  // --- Tastatur ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          cmd(["set_property", "pause", paused ? "no" : "yes"]);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(e.shiftKey ? 30 : 10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(e.shiftKey ? -30 : -10);
          break;
        case "ArrowUp":
          e.preventDefault();
          cmd(["set_property", "volume", Math.min(150, volume + 5)]);
          break;
        case "ArrowDown":
          e.preventDefault();
          cmd(["set_property", "volume", Math.max(0, volume - 5)]);
          break;
        case "m":
        case "M":
          cmd(["set_property", "mute", muted ? "no" : "yes"]);
          break;
        case "f":
        case "F":
          cmd(["set_property", "fullscreen", fullscreen ? "no" : "yes"]);
          break;
        case "?":
          setHelpOpen((v) => !v);
          break;
        case "Escape":
          if (helpOpen) setHelpOpen(false);
          else if (tracksOpen) setTracksOpen(false);
          else close();
          break;
        case "Home":
          seekTo(0);
          break;
        case "End":
          if (total > 0) seekTo(total - 1);
          break;
        default:
          if (/^[0-9]$/.test(e.key) && total > 0) seekTo((Number(e.key) / 10) * total);
      }
      bump();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bump, close, cmd, fullscreen, helpOpen, muted, paused, seek, seekTo, total, tracksOpen, volume]);

  const tracks = useMemo(() => trackList(props), [props]);
  const audioTracks = tracks.filter((x) => x.type === "audio");
  const subTracks = tracks.filter((x) => x.type === "sub");
  const activeAid = props["aid"];
  const activeSid = props["sid"];
  const pct = total > 0 ? Math.min(100, Math.max(0, (position / total) * 100)) : 0;

  if (!current) return null;

  const barDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const move = (clientX: number) => {
      const r = el.getBoundingClientRect();
      const p = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
      setHoverPct(p);
      setLocalPos(total > 0 ? (p / 100) * total : 0);
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = (ev: PointerEvent) => {
      move(ev.clientX);
      const r = el.getBoundingClientRect();
      const p = Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100));
      if (total > 0) seekTo((p / 100) * total);
      setHoverPct(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0b0c12]"
      onPointerMove={bump}
      onClick={() => setTracksOpen(false)}
    >
      {/* Bildfläche: das echte Bild zeigt MPV im eigenen Fenster. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {current.poster && (
          <img
            src={current.poster}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-md"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />

        <div className="relative z-10 flex max-w-lg flex-col items-center gap-4 px-6 text-center">
          <MonitorPlay size={44} className="text-[var(--accent-2)]" />
          {phase === "starting" && (
            <div className="flex items-center gap-2 text-sm text-white/75">
              <Loader2 size={16} className="animate-spin" /> {t("player.mpvStarting")}
            </div>
          )}
          {phase === "error" && (
            <>
              <div className="flex items-center gap-2 text-base font-semibold text-red-300">
                <AlertTriangle size={18} /> {t("player.mpvError")}
              </div>
              <div className="text-xs leading-relaxed text-white/60">{error}</div>
              <button className="btn btn-ghost px-3 py-2 text-sm" onClick={() => setPlayerEngine("web")}>
                {t("settings.engineWeb")}
              </button>
            </>
          )}
          {phase === "playing" && (
            <>
              <div className="text-base font-semibold text-white">{t("player.mpvWindow")}</div>
              <div className="text-xs leading-relaxed text-white/60">{t("player.mpvWindowHint")}</div>
            </>
          )}
        </div>
      </div>

      {/* Kopflleiste */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/85 to-transparent px-5 pb-10 pt-4">
        <button
          onClick={close}
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white"
          aria-label={t("player.close")}
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[var(--accent)]/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              {t("player.mpvBadge")}
            </span>
            <span className="truncate text-sm font-bold text-white">{current.title}</span>
          </div>
          {current.subtitle && (
            <div className="truncate text-xs text-white/60">{current.subtitle}</div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setHelpOpen((v) => !v)}
            className={`transition ${helpOpen ? "text-[var(--accent-2)]" : "text-white/80 hover:text-white"}`}
            title={t("player.shortcuts")}
            aria-label={t("player.shortcuts")}
          >
            <Keyboard size={22} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTracksOpen((v) => !v);
            }}
            className={`transition ${tracksOpen ? "text-[var(--accent-2)]" : "text-white/80 hover:text-white"}`}
            title={t("player.tracks")}
          >
            <Settings2 size={22} />
          </button>
          <button
            onClick={close}
            className="text-white/80 transition hover:text-white"
            title={t("player.close")}
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Spuren-Panel */}
      {tracksOpen && (
        <div
          className="absolute right-5 top-16 z-30 w-72 rounded-2xl border border-white/10 bg-[#14161f]/97 p-3 shadow-2xl backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          {audioTracks.length > 0 && (
            <TrackGroup title={t("player.audio")}>
              {audioTracks.map((x) => (
                <TrackRow
                  key={`a${x.id}`}
                  active={activeAid === x.id}
                  onClick={() => cmd(["set_property", "aid", x.id])}
                >
                  {langName(x.lang) || x.title || `${x.codec} #${x.id}`}
                </TrackRow>
              ))}
            </TrackGroup>
          )}
          <TrackGroup title={t("player.subtitles")}>
            <TrackRow active={activeSid === false || activeSid === "no"} onClick={() => cmd(["set_property", "sid", "no"])}>
              {t("player.subtitleOff")}
            </TrackRow>
            {subTracks.map((x) => (
              <TrackRow
                key={`s${x.id}`}
                active={activeSid === x.id}
                onClick={() => cmd(["set_property", "sid", x.id])}
              >
                {langName(x.lang) || x.title || `${x.codec} #${x.id}`}
              </TrackRow>
            ))}
          </TrackGroup>
          {audioTracks.length === 0 && subTracks.length === 0 && (
            <div className="px-1 py-2 text-xs text-white/50">{t("player.tracks")}</div>
          )}
        </div>
      )}

      {/* Endkarte */}
      {endMode && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 px-4 pb-32 backdrop-blur-sm sm:items-center sm:pb-0"
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
                  <button className="btn btn-primary px-4 py-2 text-sm" onClick={goNextNow}>
                    <Play size={16} fill="currentColor" /> {t("player.playNext")}
                  </button>
                  {endIn > 0 && (
                    <button className="btn btn-ghost px-3 py-2 text-sm" onClick={cancelEnd}>
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

      {/* Tastenkürzel */}
      {helpOpen && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm"
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

      {/* Steuerleiste */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-5 pb-5 pt-16 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        {!isLive && (
          <div className="mb-3 flex items-center gap-3">
            <span className="w-14 text-right text-xs tabular-nums text-white/70">
              {fmtTimeClock(hoverPct !== null && total > 0 ? (hoverPct / 100) * total : position)}
            </span>
            <div
              role="slider"
              tabIndex={0}
              aria-label={t("player.seek")}
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(position)}
              className="group relative flex flex-1 touch-none cursor-pointer items-center rounded-full py-3 outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              onPointerDown={barDown}
              onPointerMove={(e) => {
                if (e.buttons !== 0) return;
                const r = e.currentTarget.getBoundingClientRect();
                setHoverPct(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
              }}
              onPointerLeave={() => setHoverPct(null)}
            >
              <div className="relative h-1.5 w-full rounded-full bg-white/20 transition-all duration-150 group-hover:h-2.5">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                  }}
                />
                <div
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent-2)] shadow-lg transition-all duration-150 ${
                    showControls ? "h-3.5 w-3.5 opacity-100" : "h-1.5 w-1.5 opacity-0"
                  }`}
                  style={{ left: `${pct}%` }}
                />
                {[0, 66.6].map((f) => (
                  <button
                    key={f}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (total > 0) seekTo((f / 100) * total);
                    }}
                    title={f === 0 ? t("player.jumpIntro") : t("player.jumpOutro")}
                    aria-label={f === 0 ? t("player.jumpIntro") : t("player.jumpOutro")}
                    className={`absolute top-1/2 -translate-y-1/2 ${
                      f === 0 ? "-translate-x-1/2" : "translate-x-0"
                    }`}
                    style={{ left: `${f}%` }}
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/70 bg-black/45 text-white/90 transition hover:scale-110 hover:border-white hover:bg-black/80">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                        <path d="M0 0h6L3 4l3 4H0z" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
              {hoverPct !== null && total > 0 && (
                <div
                  className="pointer-events-none absolute -top-2 -translate-x-1/2 rounded-lg bg-black/85 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-lg"
                  style={{ left: `${hoverPct}%` }}
                >
                  {fmtTimeClock((hoverPct / 100) * total)}
                </div>
              )}
            </div>
            <span className="w-14 text-xs tabular-nums text-white/70">{fmtTimeClock(total)}</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={() => cmd(["set_property", "pause", paused ? "no" : "yes"])}
            className="text-white transition hover:text-[var(--accent-2)]"
          >
            {paused ? <Play size={26} fill="currentColor" /> : <Pause size={26} />}
          </button>
          {buffering && (
            <span className="flex items-center gap-1.5 text-xs text-white/60">
              <Loader2 size={14} className="animate-spin" /> {t("player.mpvBuffering")}
            </span>
          )}
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
            <button
              onClick={() => cmd(["set_property", "mute", muted ? "no" : "yes"])}
              className="text-white/80 hover:text-white"
            >
              {muted || volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <input
              type="range"
              min={0}
              max={150}
              step={1}
              value={muted ? 0 : volume}
              onChange={(e) => {
                cmd(["set_property", "volume", Number(e.target.value)]);
                if (muted) cmd(["set_property", "mute", "no"]);
              }}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            />
          </div>

          <div className="hidden items-center gap-1 md:flex">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => cmd(["set_property", "speed", s])}
                className={`rounded-md px-1.5 py-1 text-[11px] font-semibold tabular-nums transition ${
                  Math.abs(speed - s) < 0.01
                    ? "bg-[var(--accent)]/30 text-white"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
                title={t("player.speed")}
              >
                {String(s).replace(".", ",")}×
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => cmd(["set_property", "ontop", ontop ? "no" : "yes"])}
              className={`transition ${ontop ? "text-[var(--accent-2)]" : "text-white/80 hover:text-white"}`}
              title={t("player.mpvOntop")}
              aria-label={t("player.mpvOntop")}
            >
              <Pin size={20} />
            </button>
            <button
              onClick={() => cmd(["set_property", "fullscreen", fullscreen ? "no" : "yes"])}
              className="text-white/80 hover:text-white"
              title={t("player.mpvFull")}
              aria-label={t("player.mpvFull")}
            >
              {fullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
            </button>
            <button
              onClick={() => {
                api.mpvStop().catch(() => {});
                setPlayerEngine("web");
              }}
              className="btn btn-ghost px-3 py-2 text-xs"
              title={t("player.mpvClose")}
            >
              {t("player.mpvClose")}
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
