/**
 * Player-Shell für die eingebettete, native MPV-Engine (Stufe 3).
 *
 * Das Bild ist eine *native* Fläche (X11-Child-Window der App bzw. angedocktes
 * MPV-Fenster), kein HTML-<video>. WebKit gibt uns nie ein eigenes X11-Child,
 * HTML läge also immer *unter* dem Video - deshalb lebt die komplette Steuerung
 * als Chrome **um** die Bühne ("Stage") herum, nicht als Overlay darüber.
 *
 * Aufgaben dieser Komponente:
 *  1. Bühnen-Rechteck messen und an das Backend melden (`POST /api/mpv/stage`).
 *  2. MPV starten/stoppen, Props + Events pollen (250 ms).
 *  3. Abspiel-Position verfolgen, Fortschritt speichern, Auto-Next mit Countdown.
 *  4. Komplette Bedienung: Timeline, Tempo, Spuren, Lautstärke, Tastenkürzel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, imgUrl, type Episode, type MpvEmbed } from "../lib/api";
import { useStore, type PlayNext, type PlayRequest } from "../lib/store";
import { useT } from "../lib/i18n";

/* ------------------------------------------------------------------ utils -- */

type Phase = "starting" | "playing" | "ended" | "error";
type Props = Record<string, unknown>;

interface MpvEvent {
  event?: string;
  reason?: string;
  file_error?: string;
}

interface Track {
  id: number;
  type: string;
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  default?: boolean;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const flag = (v: unknown): boolean => v === true;
const p2 = (n: number) => String(Math.floor(n)).padStart(2, "0");

/** Sekunden -> "h:mm:ss" / "m:ss". */
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const nextFrame = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const PREFS_KEY = "babyflix.player.prefs";
interface Prefs {
  volume: number;
  speed: number;
  muted: boolean;
  ontop: boolean;
}
function loadPrefs(): Prefs {
  const base: Prefs = { volume: 100, speed: 1, muted: false, ontop: false };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Partial<Prefs>) };
  } catch {
    return base;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

const AUTOPLAY_SECONDS = 10;

/** Nächsten Request aus dem vom Aufrufer mitgegebenen Folgen-Hinweis bauen. */
function fromNext(cur: PlayRequest, n: PlayNext): PlayRequest {
  return {
    ...cur,
    kind: n.kind,
    id: n.id,
    ext: n.ext,
    title: n.title,
    subtitle: n.subtitle ?? cur.subtitle,
    historyKey: `${n.kind}:${n.id}`,
    next: undefined,
    startAt: undefined,
  };
}

/* ------------------------------------------------------------------ icons -- */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const IPlay = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);
const IPause = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
  </svg>
);
const IBack = ({ n = 10 }: { n?: number }) => (
  <span className="relative inline-flex h-5 w-5 items-center justify-center">
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
      <path d="M11 8V4.5L6 8.5l5 4V9a5.5 5.5 0 1 1-5.5 5.5" />
    </svg>
    <span className="absolute -bottom-1 text-[8px] font-bold">{n}</span>
  </span>
);
const IFwd = ({ n = 10 }: { n?: number }) => (
  <span className="relative inline-flex h-5 w-5 items-center justify-center">
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
      <path d="M13 8V4.5l5 4-5 4V9a5.5 5.5 0 1 0 5.5 5.5" />
    </svg>
    <span className="absolute -bottom-1 text-[8px] font-bold">{n}</span>
  </span>
);
const IVolume = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <path d="M4 10v4h3l4 3.5v-15L7 10z" />
    {muted ? <path d="M15.5 9.5l4 5m0-5l-4 5" /> : <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7.5a7 7 0 0 1 0 9" />}
  </svg>
);
const ISpeed = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <path d="M12 5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 10.3l5-.7z" />
  </svg>
);
const ITracks = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
const IFull = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    {on ? <path d="M9 4v5H4M15 20v-5h5M4 9l5-5M20 15l-5 5" /> : <path d="M4 9V4h5M20 15v5h-5M9 4L4 9M15 20l5-5" />}
  </svg>
);
const IOntop = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <path d="M12 4v16M8 8l4-4 4 4" />
    {on && <path d="M5 20h14" />}
  </svg>
);
const INext = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M6 5.5v13l9-6.5z" />
    <path d="M16.5 5h2v14h-2z" />
  </svg>
);
const IReplay = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />
  </svg>
);
const IClose = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const IHelp = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" {...S}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.3" />
    <path d="M12 16.6h.01" />
  </svg>
);
const IChevron = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <path d="M6 14.5L12 9l6 5.5" />
  </svg>
);

/* -------------------------------------------------------------- controls -- */

function IconBtn({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 transition ${
        active ? "bg-[var(--accent)]/25 text-[var(--text)]" : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
    >
      {children}
    </button>
  );
}

/* Wie viel Breite rechts von der Bühne muss frei bleiben, damit das offene Menü
   sichtbar bleibt? Am Menü selbst gemessen, damit es zu jedem Auslöser passt. */
function menuReserve(stageRect: DOMRect): number {
  const p = document.querySelector<HTMLElement>("[data-mpv-popover]");
  if (!p) return 0;
  const need = stageRect.right - p.getBoundingClientRect().left + 10;
  return Math.round(Math.max(0, Math.min(need, stageRect.width * 0.6)));
}

function Popover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-mpv-popover=""
      className="absolute bottom-full right-0 z-20 mb-3 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]/95 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</span>
        <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]" aria-label="close">
          <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto p-1">{children}</div>
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-white/5 ${
        active ? "text-[var(--accent)]" : "text-[var(--text)]"
      }`}
    >
      <span className="w-3 shrink-0">{active ? "•" : ""}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ shell -- */

export function PlayerShell() {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;

  const cur = useStore((s) => s.current);
  const autoplayNext = useStore((s) => s.autoplayNext);
  const setAutoplayNext = useStore((s) => s.setAutoplayNext);
  const setAutoResume = useStore((s) => s.setAutoResume);

  const [phase, setPhase] = useState<Phase>("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [props, setProps] = useState<Props>({});
  const [embed, setEmbed] = useState<MpvEmbed | null>(null);
  const [followUp, setFollowUp] = useState<PlayRequest | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [countdown, setCountdown] = useState(AUTOPLAY_SECONDS);
  const [nonce, setNonce] = useState(0);
  const [menu, setMenu] = useState<null | "audio" | "subs" | "speed" | "help">(null);
  const [chrome, setChrome] = useState(true);
  const [fs, setFs] = useState(false);
  const [ontop, setOntop] = useState(() => loadPrefs().ontop);
  const [dragging, setDragging] = useState(false);
  const [scrub, setScrub] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);
  const phaseRef = useRef<Phase>("starting");
  const stageSigRef = useRef("");
  const menuRef = useRef<null | "audio" | "subs" | "speed" | "help">(null);
  const volRef = useRef(loadPrefs().volume);
  phaseRef.current = phase;

  /* -------- abgeleitete Werte -------- */
  const pos = num(props["time-pos"]);
  const dur = num(props.duration);
  const paused = flag(props.pause);
  const buffering = flag(props["paused-for-cache"]);
  const volume = Math.round(num(props.volume) || volRef.current);
  const muted = flag(props.mute);
  const speed = flagspeed(props, 1);
  const tracks = useMemo<Track[]>(
    () => (Array.isArray(props["track-list"]) ? (props["track-list"] as Track[]) : []),
    [props]
  );
  const audioTracks = tracks.filter((x) => x.type === "audio");
  const subTracks = tracks.filter((x) => x.type === "sub");
  const isLive = cur?.kind === "live";

  /* -------- MPV-Kommandos -------- */
  const mpv = useCallback((command: unknown[]) => {
    void api.mpvCmd(command).catch(() => undefined);
  }, []);
  const setProp = useCallback((name: string, value: unknown) => mpv(["set_property", name, value]), [mpv]);

  const seek = useCallback(
    (to: number) => {
      const target = Math.max(0, Math.min(dur > 0 ? dur - 0.4 : to, to));
      setScrub(target);
      mpv(["seek", target, "absolute"]);
    },
    [dur, mpv]
  );
  const nudge = useCallback((delta: number) => seek(num(props["time-pos"]) + delta), [props, seek]);

  const togglePlay = useCallback(() => setProp("pause", !flag(props.pause)), [props, setProp]);

  const setVolume = useCallback(
    (v: number) => {
      const val = Math.max(0, Math.min(130, Math.round(v)));
      volRef.current = val;
      savePrefs({ ...loadPrefs(), volume: val });
      setProp("volume", val);
      if (val > 0 && flag(props.mute)) setProp("mute", false);
    },
    [props, setProp]
  );

  const toggleMute = useCallback(() => setProp("mute", !flag(props.mute)), [props, setProp]);

  const setSpeed = useCallback(
    (s: number) => {
      savePrefs({ ...loadPrefs(), speed: s });
      setProp("speed", s);
      setMenu(null);
    },
    [setProp]
  );

  const toggleFullscreen = useCallback(async () => {
    const next = !fs;
    setFs(next);
    if (!isTauri()) return;
    try {
      const w = getCurrentWindow();
      await w.setFullscreen(next);
    } catch {
      /* ignore */
    }
  }, [fs]);

  const toggleOntop = useCallback(async () => {
    const next = !ontop;
    setOntop(next);
    savePrefs({ ...loadPrefs(), ontop: next });
    if (!isTauri()) return;
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch {
      /* ignore */
    }
  }, [ontop]);

  /* -------- Fortschritt speichern -------- */
  const saveProgress = useCallback(
    (force = false) => {
      const c = useStore.getState().current;
      if (!c) return;
      const p = num(props["time-pos"]);
      const d = num(props.duration);
      if (!d || d <= 0 || p <= 1) return;
      if (!force && p < 5) return;
      useStore.getState().saveHistory({
        key: c.historyKey,
        kind: c.kind,
        id: c.id,
        ext: c.ext,
        title: c.title,
        poster: c.poster,
        subtitle: c.subtitle,
        position: p,
        duration: d,
        updatedAt: Date.now(),
      });
    },
    [props]
  );

  const close = useCallback(() => {
    saveProgress(true);
    void api.mpvStop().catch(() => undefined);
    if (isTauri()) void getCurrentWindow().setFullscreen(false).catch(() => undefined);
    useStore.getState().stop();
  }, [saveProgress]);

  /* -------- Bühne melden -------- */
  const pushStage = useCallback((visible: boolean) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Ein offenes Menü liegt über der Bühne. Die native Videofläche lässt sich
    // nicht überdecken, also schneiden wir die Spalte, die das Menü belegt, aus
    // der Bühnenbreite heraus – das Bild wird für den Moment schmaler, das Menü
    // bleibt vollständig lesbar.
    const reserve = menuRef.current ? menuReserve(r) : 0;
    const rect = {
      x: Math.round(r.left * dpr),
      y: Math.round(r.top * dpr),
      w: Math.max(2, Math.round((r.width - reserve) * dpr)),
      h: Math.max(2, Math.round(r.height * dpr)),
    };
    const sig = `${rect.x},${rect.y},${rect.w},${rect.h},${visible}`;
    if (sig === stageSigRef.current) return;
    stageSigRef.current = sig;
    void api
      .mpvStage({ ...rect, visible })
      .then((r2) => setEmbed(r2.embed ?? null))
      .catch(() => undefined);
  }, []);

  /* -------- Auflösung der nächsten Folge -------- */
  const resolveFollowUp = useCallback(async (c: PlayRequest) => {
    if (c.next) {
      setFollowUp(fromNext(c, c.next));
      return;
    }
    if (c.kind !== "series" || !c.seriesId) {
      setFollowUp(null);
      return;
    }
    setResolveBusy(true);
    try {
      const d = await api.detail("series", c.seriesId);
      const flat: (Episode & { season: number })[] = (d.seasons ?? []).flatMap((s) =>
        (s.episodes ?? []).map((e) => ({ ...e, season: s.number }))
      );
      const idx = flat.findIndex((e) => e.id === c.id);
      const nx = idx >= 0 ? flat[idx + 1] : undefined;
      if (!nx) {
        setFollowUp(null);
        return;
      }
      setFollowUp({
        ...c,
        id: nx.id,
        ext: nx.extension,
        poster: nx.cover ?? c.poster,
        subtitle: `S${nx.season} · E${nx.num} – ${nx.title}`,
        historyKey: `series:${nx.id}`,
        next: undefined,
        startAt: undefined,
      });
    } catch {
      setFollowUp(null);
    } finally {
      setResolveBusy(false);
    }
  }, []);

  const playNext = useCallback(() => {
    const nx = followUp;
    if (!nx) return;
    saveProgress(true);
    setCountdown(AUTOPLAY_SECONDS);
    useStore.getState().play(nx);
  }, [followUp, saveProgress]);

  const replay = useCallback(() => {
    saveProgress(true);
    setCountdown(AUTOPLAY_SECONDS);
    setPhase("starting");
    setNonce((n) => n + 1);
  }, [saveProgress]);

  /* -------- Effekt 1: Start (Bühne reservieren, dann MPV) -------- */
  useEffect(() => {
    const c = useStore.getState().current;
    if (!c) return;
    let cancelled = false;
    setPhase("starting");
    setErrorMsg("");
    setProps({});
    setFollowUp(null);
    setCountdown(AUTOPLAY_SECONDS);

    const run = async () => {
      await nextFrame();
      if (cancelled) return;
      pushStage(false);

      const st = useStore.getState();
      const hist = st.history.find((h) => h.key === c.historyKey);
      const resume =
        c.startAt ??
        (st.autoResume && hist && hist.duration > 0 && hist.position > 20 && hist.position < hist.duration - 20
          ? hist.position
          : undefined);
      const prefs = loadPrefs();
      try {
        await api.mpvStart({
          kind: c.kind,
          id: c.id,
          ext: c.ext,
          start: resume,
          volume: prefs.volume,
          speed: prefs.speed,
          muted: prefs.muted,
          title: c.title,
        });
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(String((e as Error)?.message ?? tRef.current("player.mpvError")));
        setPhase("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [cur?.historyKey, nonce, pushStage]);

  /* -------- Effekt 2: Poll-Schleife -------- */
  useEffect(() => {
    if (!cur) return;
    let alive = true;

    const handleEvent = (e: MpvEvent) => {
      switch (e.event) {
        case "file-loaded":
        case "playback-restart":
          setPhase((p) => (p === "starting" ? "playing" : p));
          break;
        case "end-file":
          if (e.reason === "error") {
            setErrorMsg(e.file_error || tRef.current("player.mpvError"));
            setPhase("error");
          } else if (e.reason === "eof") {
            setPhase("ended");
          }
          break;
        default:
          break;
      }
    };

    const tick = async () => {
      try {
        const res = await api.mpvPoll(seqRef.current);
        if (!alive) return;
        seqRef.current = res.seq;
        setProps(res.props ?? {});
        for (const e of (res.events ?? []) as MpvEvent[]) handleEvent(e);
      } catch {
        /* Backend startet neu o.ä. - nächster Tick */
      }
    };

    void tick();
    const id = window.setInterval(tick, 250);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [cur?.historyKey]);

  /* -------- Effekt 3: Phase aus Props nachziehen (Sicherheitsnetz) -------- */
  useEffect(() => {
    if (!cur) return;
    const p = phaseRef.current;
    if (p === "error") return;
    if (p === "starting" && dur > 0 && !flag(props["idle-active"])) setPhase("playing");
    if (p === "playing" && (flag(props["eof-reached"]) || (dur > 0 && pos >= dur - 0.6))) setPhase("ended");
  }, [props, dur, pos, cur]);

  /* -------- Effekt 4: Bühne an/aus + Layoutänderungen -------- */
  useEffect(() => {
    pushStage(phase === "playing");
  }, [phase, pushStage]);

  /* Menü auf/zu ändert die reservierte Spalte → Bühne neu melden. */
  useEffect(() => {
    menuRef.current = menu;
    pushStage(phaseRef.current === "playing");
  }, [menu, pushStage]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const report = () => pushStage(phaseRef.current === "playing");
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [pushStage]);

  /* -------- Effekt 5: Fortschritt + Auto-Next -------- */
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => saveProgress(), 5000);
    return () => window.clearInterval(id);
  }, [phase, saveProgress]);

  useEffect(() => {
    if (phase !== "ended") return;
    saveProgress(true);
    void resolveFollowUp(useStore.getState().current as PlayRequest);
  }, [phase, resolveFollowUp, saveProgress]);

  useEffect(() => {
    if (phase !== "ended" || !followUp || !autoplayNext) return;
    const id = window.setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          playNext();
          return AUTOPLAY_SECONDS;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, followUp, autoplayNext, playNext]);

  /* -------- Effekt 6: Aufräumen -------- */
  useEffect(
    () => () => {
      const c = useStore.getState().current;
      void api.mpvStop().catch(() => undefined);
      void c;
      if (isTauri()) void getCurrentWindow().setFullscreen(false).catch(() => undefined);
    },
    []
  );

  useEffect(() => savePrefs({ ...loadPrefs(), ontop }), [ontop]);

  /* -------- Effekt 7: Tastenkürzel -------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        if (e.key === "Escape") (document.activeElement as HTMLElement).blur();
        return;
      }
      const k = e.key;
      const step = e.shiftKey ? 30 : 5;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      switch (k) {
        case " ":
        case "k":
        case "K":
          handled();
          togglePlay();
          break;
        case "ArrowLeft":
          handled();
          nudge(-step);
          break;
        case "ArrowRight":
          handled();
          nudge(step);
          break;
        case "j":
        case "J":
          handled();
          nudge(-10);
          break;
        case "l":
        case "L":
          handled();
          nudge(10);
          break;
        case "ArrowUp":
          handled();
          setVolume((num(props.volume) || volRef.current) + 5);
          break;
        case "ArrowDown":
          handled();
          setVolume((num(props.volume) || volRef.current) - 5);
          break;
        case "m":
        case "M":
          handled();
          toggleMute();
          break;
        case "f":
        case "F":
          handled();
          void toggleFullscreen();
          break;
        case "t":
        case "T":
          handled();
          void toggleOntop();
          break;
        case "h":
        case "H":
          handled();
          setChrome((c) => !c);
          break;
        case "n":
        case "N":
          handled();
          if (followUp) playNext();
          break;
        case ",":
          handled();
          setSpeed(Math.max(0.25, Math.round((flagspeed(props, 1) - 0.25) * 100) / 100));
          break;
        case ".":
          handled();
          setSpeed(Math.min(4, Math.round((flagspeed(props, 1) + 0.25) * 100) / 100));
          break;
        case "Escape":
          handled();
          if (menu) setMenu(null);
          else if (fs) void toggleFullscreen();
          else close();
          break;
        default:
          if (/^[0-9]$/.test(k) && dur > 0) {
            handled();
            seek((dur * Number(k)) / 10);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, dur, followUp, fs, menu, nudge, playNext, props, seek, setSpeed, setVolume, toggleFullscreen, toggleMute, toggleOntop, togglePlay]);

  /* ---------------------------------- render ---------------------------------- */

  if (!cur) return null;

  const shown = dragging ? scrub : pos;
  const shownPct = dur > 0 ? Math.min(100, (shown / dur) * 100) : 0;
  const ownWindow = embed?.mode === "own-window";
  const nextLabel = followUp?.subtitle ?? followUp?.title ?? "";

  const hoverTime = (clientX: number) => {
    const el = barRef.current;
    if (!el || dur <= 0) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setHoverX(ratio);
  };

  const infoText = phase === "starting" ? t("player.mpvStarting") : buffering ? t("player.mpvBuffering") : "";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#05060a] text-[var(--text)]">
      {/* ---------------- Kopfzeile ---------------- */}
      {chrome ? (
        <header className="flex shrink-0 items-center gap-3 px-5 pt-4 pb-2">
          {cur.poster ? (
            <img
              src={imgUrl(cur.poster)}
              alt=""
              className="h-14 w-10 shrink-0 rounded-md object-cover ring-1 ring-[var(--border)]"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{cur.title}</div>
            {cur.subtitle ? <div className="truncate text-xs text-[var(--muted)]">{cur.subtitle}</div> : null}
          </div>
          {isLive ? (
            <span className="chip" data-active="true">
              {t("player.live")}
            </span>
          ) : null}
          <span
            className="chip"
            data-active="true"
            title={ownWindow ? t("player.mpvWindowHint") : t("player.stageHint")}
          >
            {t("player.mpvBadge")}
            {ownWindow ? " · Fenster" : " · native"}
          </span>
          {infoText ? <span className="text-xs text-[var(--muted)]">{infoText}</span> : null}
          <IconBtn label={t("player.fullscreen")} onClick={() => void toggleFullscreen()} active={fs}>
            <IFull on={fs} />
          </IconBtn>
          <IconBtn label={t("common.close")} onClick={close}>
            <IClose />
          </IconBtn>
        </header>
      ) : (
        <button
          type="button"
          onClick={() => setChrome(true)}
          title={t("player.shortcuts")}
          className="absolute right-3 top-3 z-20 rounded-full bg-black/40 p-2 text-[var(--muted)] opacity-40 transition hover:opacity-100"
        >
          <IChevron />
        </button>
      )}

      {/* ---------------- Bühne (native Video-Fläche) ---------------- */}
      <div className="min-h-0 flex-1 px-5">
        <div
          ref={stageRef}
          onDoubleClick={() => void toggleFullscreen()}
          className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black"
        >
          {/* Beim Start: Poster + Spinner (die native Fläche ist noch versteckt) */}
          {phase === "starting" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              {cur.poster ? (
                <img
                  src={imgUrl(cur.poster)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-25 blur-[2px]"
                />
              ) : null}
              <div className="relative flex flex-col items-center gap-3">
                <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
                <div className="text-sm text-[var(--muted)]">{t("player.mpvStarting")}</div>
              </div>
            </div>
          ) : null}

          {/* Fehler */}
          {phase === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="text-base font-semibold text-[var(--err)]">{t("player.mpvError")}</div>
              <div className="max-w-xl break-words text-xs text-[var(--muted)]">{errorMsg}</div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" onClick={replay}>
                  {t("common.retry")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={close}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          ) : null}

          {/* Ende der Folge */}
          {phase === "ended" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
              {cur.poster ? (
                <img
                  src={imgUrl(cur.poster)}
                  alt=""
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/70 to-black/80" />
              <div className="relative flex max-w-2xl flex-col items-center gap-3 px-6 text-center">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                  {cur.kind === "live" ? t("player.liveEnd") : t("player.epsEnd")}
                </div>
                <div className="text-xl font-semibold">{cur.title}</div>
                {cur.subtitle ? <div className="text-sm text-[var(--muted)]">{cur.subtitle}</div> : null}

                {followUp ? (
                  <div className="mt-2 w-full rounded-xl border border-[var(--border)] bg-black/40 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      {t("player.next")}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">{nextLabel}</div>
                    {autoplayNext ? (
                      <>
                        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full bg-[var(--accent)] transition-[width] duration-1000 ease-linear"
                            style={{ width: `${((AUTOPLAY_SECONDS - countdown) / AUTOPLAY_SECONDS) * 100}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs text-[var(--muted)]">
                          {t("player.nextIn", { n: countdown })}
                        </div>
                      </>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={playNext}>
                        <INext />
                        {t("player.playNext")}
                      </button>
                      {autoplayNext ? (
                        <button type="button" className="btn btn-ghost" onClick={() => setAutoplayNext(false)}>
                          {t("player.stopAuto")}
                        </button>
                      ) : null}
                      <button type="button" className="btn btn-ghost inline-flex items-center gap-2" onClick={replay}>
                        <IReplay />
                        {t("player.replay")}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={close}>
                        {t("common.close")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col items-center gap-3">
                    <div className="text-sm text-[var(--muted)]">
                      {resolveBusy
                        ? t("player.mpvStarting")
                        : cur.kind === "live"
                          ? t("player.liveEndHint")
                          : t("player.seriesEndHint")}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={replay}>
                        <IReplay />
                        {t("player.replay")}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={close}>
                        {t("common.close")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {ownWindow && phase === "playing" ? (
        <div className="px-5 pt-2 text-center text-[11px] text-amber-400/90">{t("player.mpvWindow")}</div>
      ) : null}

      {/* ---------------- Steuerleiste ---------------- */}
      <footer className="relative shrink-0 px-5 pb-4 pt-3">
        {/* Timeline */}
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
            {isLive ? "--:--" : fmt(shown)}
          </span>
          <div
            ref={barRef}
            className="group relative h-6 flex-1 cursor-pointer"
            onMouseMove={(e) => hoverTime(e.clientX)}
            onMouseLeave={() => setHoverX(null)}
          >
            <div className="pointer-events-none absolute top-1/2 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-[var(--accent)]/80" style={{ width: `${shownPct}%` }} />
            </div>
            {hoverX !== null && dur > 0 ? (
              <div
                className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-black/80 px-2 py-1 text-[11px] tabular-nums"
                style={{ left: `${hoverX * 100}%` }}
              >
                {fmt(hoverX * dur)}
              </div>
            ) : null}
            <input
              type="range"
              min={0}
              max={dur > 0 ? dur : 1}
              step={0.1}
              value={dur > 0 ? shown : 0}
              disabled={dur <= 0}
              aria-label={t("player.seek")}
              onChange={(e) => {
                setDragging(true);
                setScrub(Number(e.target.value));
              }}
              onMouseUp={(e) => {
                setDragging(false);
                seek(Number((e.target as HTMLInputElement).value));
              }}
              onKeyUp={(e) => {
                setDragging(false);
                seek(Number((e.target as HTMLInputElement).value));
              }}
              onBlur={() => setDragging(false)}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent accent-[var(--accent)] opacity-0"
            />
            {/* griff */}
            {dur > 0 ? (
              <div
                className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 shadow transition group-hover:opacity-100"
                style={{ left: `${shownPct}%` }}
              />
            ) : null}
          </div>
          <span className="w-14 shrink-0 text-xs tabular-nums text-[var(--muted)]">
            {isLive ? t("player.live") : fmt(dur)}
          </span>
        </div>

        {/* Transport */}
        <div className="mt-1 flex items-center gap-1">
          <IconBtn label={t("player.jumpIntro")} onClick={() => seek(0)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M6 5h2v14H6zM19 5.5v13L9.5 12z" />
            </svg>
          </IconBtn>
          <IconBtn label={t("player.back10")} onClick={() => nudge(-10)}>
            <IBack />
          </IconBtn>
          <IconBtn label={paused ? t("player.play") : t("player.pause")} onClick={togglePlay} active={!paused}>
            {paused ? <IPlay /> : <IPause />}
          </IconBtn>
          <IconBtn label={t("player.fwd10")} onClick={() => nudge(10)}>
            <IFwd />
          </IconBtn>
          <IconBtn label={t("player.jumpOutro")} onClick={() => seek(dur > 0 ? dur * 0.66 : 0)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M16 5h2v14h-2zM5 5.5v13L14.5 12z" />
            </svg>
          </IconBtn>

          {/* Lautstärke */}
          <div className="ml-2 flex items-center gap-2">
            <IconBtn label={muted ? t("player.unmute") : t("player.mute")} onClick={toggleMute} active={muted}>
              <IVolume muted={muted} />
            </IconBtn>
            <input
              type="range"
              min={0}
              max={130}
              step={1}
              value={muted ? 0 : volume}
              aria-label={t("player.audio")}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--accent)]"
            />
          </div>

          <div className="flex-1" />

          {buffering && phase === "playing" ? (
            <span className="mr-2 text-xs text-[var(--muted)]">{t("player.mpvBuffering")}</span>
          ) : null}

          <div className="relative flex items-center">
            <IconBtn label={t("player.speed")} onClick={() => setMenu(menu === "speed" ? null : "speed")} active={speed !== 1}>
              <ISpeed />
            </IconBtn>
            <span className="mr-1 text-xs tabular-nums text-[var(--muted)]">{speed !== 1 ? `${speed}×` : ""}</span>
            {menu === "speed" ? (
              <Popover title={t("player.speed")} onClose={() => setMenu(null)}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <Row key={s} active={Math.abs(s - speed) < 0.01} onClick={() => setSpeed(s)}>
                    {s}×
                  </Row>
                ))}
              </Popover>
            ) : null}
          </div>

          <div className="relative flex items-center">
            <IconBtn label={t("player.tracks")} onClick={() => setMenu(menu === "audio" ? null : "audio")} active={menu === "audio"}>
              <ITracks />
            </IconBtn>
            {menu === "audio" ? (
              <Popover title={t("player.audio")} onClose={() => setMenu(null)}>
                {audioTracks.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[var(--muted)]">–</div>
                ) : (
                  audioTracks.map((tr) => (
                    <Row key={tr.id} active={flag(props.aid) && Number(props.aid) === tr.id} onClick={() => setProp("aid", tr.id)}>
                      {tr.title || tr.lang || `#${tr.id}`}
                      {tr.codec ? <span className="ml-2 text-[10px] text-[var(--muted)]">{tr.codec}</span> : null}
                    </Row>
                  ))
                )}
              </Popover>
            ) : null}
          </div>

          <div className="relative flex items-center">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-[var(--muted)] transition hover:bg-white/5 hover:text-[var(--text)]"
              onClick={() => setMenu(menu === "subs" ? null : "subs")}
              title={t("player.subtitles")}
            >
              {t("player.subtitles")}
              <IChevron />
            </button>
            {menu === "subs" ? (
              <Popover title={t("player.subtitles")} onClose={() => setMenu(null)}>
                <Row active={false} onClick={() => setProp("sid", "no")}>
                  {t("player.subtitleOff")}
                </Row>
                {subTracks.map((tr) => (
                  <Row
                    key={tr.id}
                    active={Number(props.sid) === tr.id}
                    onClick={() => setProp("sid", tr.id)}
                  >
                    {tr.title || tr.lang || `#${tr.id}`}
                  </Row>
                ))}
              </Popover>
            ) : null}
          </div>

          <div className="relative flex items-center">
            <IconBtn label={t("player.shortcuts")} onClick={() => setMenu(menu === "help" ? null : "help")} active={menu === "help"}>
              <IHelp />
            </IconBtn>
            {menu === "help" ? (
              <Popover title={t("player.shortcuts")} onClose={() => setMenu(null)}>
                <div className="space-y-1 px-3 py-2 text-xs text-[var(--muted)]">
                  <div>{t("player.kbSpace")}</div>
                  <div>{t("player.kbArrows")}</div>
                  <div>{t("player.kb10")}</div>
                  <div>{t("player.kbVol")}</div>
                  <div>{t("player.kbPct")}</div>
                  <div>{t("player.kbSpeed")}</div>
                  <div>{t("player.kbWindow")}</div>
                  <div>{t("player.kbNext")}</div>
                  <button
                    type="button"
                    className="mt-2 btn btn-ghost"
                    onClick={() => {
                      setAutoResume(false);
                      setAutoplayNext(true);
                      setSpeed(1);
                      setVolume(100);
                      setMenu(null);
                    }}
                  >
                    {t("player.resetPrefs")}
                  </button>
                </div>
              </Popover>
            ) : null}
          </div>

          <IconBtn label={t("player.ontop")} onClick={() => void toggleOntop()} active={ontop}>
            <IOntop on={ontop} />
          </IconBtn>
          <IconBtn label={fs ? t("player.exitFullscreen") : t("player.fullscreen")} onClick={() => void toggleFullscreen()} active={fs}>
            <IFull on={fs} />
          </IconBtn>
        </div>
      </footer>
    </div>
  );
}

/** Tempo robust aus den Props lesen (mpv liefert Zahlen, aber nicht immer). */
function flagspeed(props: Props, fallback: number): number {
  const v = props.speed;
  return typeof v === "number" && v > 0 ? Math.round(v * 100) / 100 : fallback;
}
