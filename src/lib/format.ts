import { localeOf, useLang } from "./i18n";

export function durationToMinutes(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  // "01:45:00" or "00:45:00"
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] + Math.round(parts[1] / 60);
  }
  // "1h 45m" / "105 min" / "105"
  const hMatch = s.match(/(\d+)\s*h/i);
  const mMatch = s.match(/(\d+)\s*m(?:in)?/i);
  if (hMatch || mMatch) {
    return (hMatch ? parseInt(hMatch[1], 10) * 60 : 0) + (mMatch ? parseInt(mMatch[1], 10) : 0);
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function fmtDuration(input: string | null | undefined): string | null {
  const mins = durationToMinutes(input);
  if (mins == null) return input || null;
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtVotes(n: number | null | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function yearOf(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = date.match(/(\d{4})/);
  return m ? m[1] : null;
}

/**
 * Manche Panels schreiben ins Feld `rating` das **Erscheinungsjahr** (z. B. 2016).
 * Nur eine plausible Bewertung darf als IMDb-Stern erscheinen, sonst stünde dort
 * "★ 2016.0" – siehe `yearFromTitle` für die Alternative.
 */
export function asRating(v: number | null | undefined): number | null {
  return v != null && v > 0 && v <= 10 ? v : null;
}

/** Erscheinungsjahr aus einem Titel wie "IR - Khaneh Bakht (2016)". */
export function yearFromTitle(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = name.match(/\((19|20)\d{2}\)/);
  return m ? m[0].slice(1, 5) : null;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const locale = localeOf(useLang.getState().lang);
  return new Date(ts * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function progressPct(
  start: number | null | undefined,
  stop: number | null | undefined
): number {
  if (!start || !stop || stop <= start) return 0;
  const now = Date.now() / 1000;
  return Math.max(0, Math.min(100, ((now - start) / (stop - start)) * 100));
}

export function ratingColor(r: number): string {
  if (r >= 8) return "#34d399";
  if (r >= 6.5) return "#f5c518";
  if (r >= 5) return "#fb923c";
  return "#f87171";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function initialsColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 32%)`;
}

/** Uhrzeit-Format für den Player: mm:ss bzw. h:mm:ss. */
export function fmtTimeClock(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "00:00";
  const s = Math.floor(secs % 60);
  const m = Math.floor((secs / 60) % 60);
  const h = Math.floor(secs / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
