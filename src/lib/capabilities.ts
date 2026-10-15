import { api, CapabilitiesReport, CodecCapability } from "./api";

/**
 * Was die laufende Webview wirklich abspielen kann.
 *
 * Warum im Frontend: Codec-Unterstützung hängt von der Plattform ab, auf der die
 * Webview läuft (WKWebView unter macOS, Chromium unter Windows) - und auf Windows
 * zusätzlich davon, ob die "HEVC Video Extensions" installiert sind. Der Rust-Teil
 * kann das nicht wissen, also wird hier geprüft und das Ergebnis ans Backend
 * gemeldet (`/api/capabilities`), damit dort sichtbar ist, warum ein Stream
 * kopiert oder neu kodiert wurde.
 *
 * Reine Diagnose: das Ergebnis beeinflusst das Abspielen in Phase 0 noch nicht.
 */

/** Video-Codecs, die bei IPTV-Panels tatsächlich vorkommen. */
const VIDEO: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
  mpeg4: 'video/mp4; codecs="mp4v.20.9"',
  av1: 'video/mp4; codecs="av01.0.05M.08"',
  vp9: 'video/mp4; codecs="vp09.00.10.08"',
};

/** Audio-Codecs, die bei IPTV-Panels tatsächlich vorkommen. */
const AUDIO: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mp4; codecs="mp4a.69"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  dts: 'audio/mp4; codecs="dtsc"',
  opus: 'audio/mp4; codecs="opus"',
  flac: 'audio/mp4; codecs="flac"',
};

/** Container-Fähigkeiten - Chromium lehnt z. B. Matroska-MIME-Typen rundheraus ab. */
const CONTAINERS = [
  "video/mp4",
  "video/x-matroska",
  "video/mp2t",
  "application/vnd.apple.mpegurl",
];

function mseSupported(type: string): boolean {
  try {
    return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type);
  } catch {
    return false;
  }
}

function containerSupported(type: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("video");
    return el.canPlayType(type) !== "";
  } catch {
    return false;
  }
}

interface DecodingInfo {
  supported: boolean;
  powerEfficient: boolean;
}

/** `mediaCapabilities` ist die einzige Quelle, die auch Hardware-/Energie-Aussagen trifft. */
async function decodingInfo(
  type: string,
  kind: "video" | "audio",
  viaMse: boolean
): Promise<DecodingInfo | null> {
  const mc = navigator.mediaCapabilities;
  if (!mc?.decodingInfo) return null;
  try {
    const configuration: MediaDecodingConfiguration =
      kind === "video"
        ? viaMse
          ? {
              type: "media-source",
              video: {
                contentType: type,
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                framerate: 30,
              },
            }
          : {
              type: "file",
              video: {
                contentType: type,
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                framerate: 30,
              },
            }
        : viaMse
          ? {
              type: "media-source",
              audio: { contentType: type, channels: "2", samplerate: 48_000, bitrate: 192_000 },
            }
          : {
              type: "file",
              audio: { contentType: type, channels: "2", samplerate: 48_000, bitrate: 192_000 },
            };
    const res = await mc.decodingInfo(configuration);
    return { supported: res.supported, powerEfficient: res.powerEfficient };
  } catch {
    // MSE nicht verfügbar oder Codec-String abgelehnt - dann eben keine Aussage.
    return null;
  }
}

async function probeCodecs(
  codecs: Record<string, string>,
  kind: "video" | "audio",
  viaMse: boolean
): Promise<Record<string, CodecCapability>> {
  const entries = await Promise.all(
    Object.entries(codecs).map(async ([id, type]) => {
      const mse = viaMse ? mseSupported(type) : containerSupported(type);
      const info = await decodingInfo(type, kind, viaMse);
      const cap: CodecCapability = {
        mse,
        decode: info ? info.supported : null,
        hardware: info ? info.powerEfficient : null,
      };
      return [id, cap] as const;
    })
  );
  return Object.fromEntries(entries);
}

let cached: CapabilitiesReport | null = null;
let inflight: Promise<CapabilitiesReport> | null = null;

/** Ergebnis der Probe (einmal pro Sitzung, danach aus dem Cache). */
export function probeCapabilities(): Promise<CapabilitiesReport> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = (async () => {
    const viaMse = typeof MediaSource !== "undefined";
    const detail = viaMse || typeof navigator.mediaCapabilities !== "undefined";
    const report: CapabilitiesReport = {
      probedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      mediaSource: viaMse,
      mediaCapabilities: !!navigator.mediaCapabilities?.decodingInfo,
      video: {},
      audio: {},
      containers: Object.fromEntries(CONTAINERS.map((c) => [c, containerSupported(c)])),
    };
    if (detail) {
      report.video = await probeCodecs(VIDEO, "video", viaMse);
      report.audio = await probeCodecs(AUDIO, "audio", viaMse);
    }
    cached = report;
    return report;
  })();

  return inflight;
}

/** Ergebnis bereits ermittelt? (für Anzeigen ohne erneutes Prüfen) */
export function cachedCapabilities(): CapabilitiesReport | null {
  return cached;
}

let reported = false;

/** Probe ausführen und einmalig ans Backend melden. Fehler sind hier egal. */
export async function reportCapabilities(): Promise<void> {
  if (reported) return;
  reported = true;
  try {
    const caps = await probeCapabilities();
    await api.reportCapabilities(caps);
  } catch {
    // Nur Diagnose - ein Fehler darf nichts blockieren.
    reported = false;
  }
}
