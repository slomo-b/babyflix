import type { ReactNode } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { CapabilitiesReport, CodecCapability, RemuxDecision } from "../lib/api";
import { useT } from "../lib/i18n";

/** Codec badge: green = usable, red = not usable, grey = no statement possible. */
function Chip({ label, state, title }: { label: string; state: boolean | null; title?: string }) {
  const tone =
    state === null
      ? "border-[var(--border)] text-[var(--muted)]"
      : state
        ? "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]"
        : "border-rose-400/40 bg-rose-400/10 text-rose-300";
  return (
    <span className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${tone}`} title={title}>
      {label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

const CONTAINER_LABEL: Record<string, string> = {
  "video/mp4": "MP4",
  "video/x-matroska": "MKV",
  "video/mp2t": "MPEG-TS",
  "application/vnd.apple.mpegurl": "HLS",
};

/**
 * Diagnostics: what the webview reports it can decode, and what the last FFmpeg
 * remux session actually did. Read-only – playback does not depend on it.
 */
export function CapabilitiesCard({
  caps,
  lastRemux,
}: {
  caps?: CapabilitiesReport | null;
  lastRemux?: RemuxDecision | null;
}) {
  const t = useT();

  const codec = (id: string, c: CodecCapability) => (
    <Chip
      key={id}
      label={id.toUpperCase()}
      state={c.mse}
      title={`MSE: ${c.mse} · decode: ${c.decode ?? "?"} · hardware: ${c.hardware ?? "?"}`}
    />
  );

  return (
    <details className="group border-b border-[var(--border)] py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
        <ShieldCheck size={16} />
        <span className="flex-1">{t("settings.caps")}</span>
        <ChevronDown size={15} className="text-[var(--muted)] transition group-open:rotate-180" />
      </summary>

      <p className="mt-2 text-xs text-[var(--muted)]">{t("settings.capsHint")}</p>

      {!caps ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">{t("settings.capsPending")}</p>
      ) : (
        <>
          <Row label={t("settings.capsVideo")}>
            {Object.entries(caps.video).map(([id, c]) => codec(id, c))}
          </Row>
          <Row label={t("settings.capsAudio")}>
            {Object.entries(caps.audio).map(([id, c]) => codec(id, c))}
          </Row>
          <Row label={t("settings.capsHardware")}>
            {Object.entries(caps.video)
              .filter(([, c]) => c.hardware !== null)
              .map(([id, c]) => (
                <Chip key={id} label={id.toUpperCase()} state={c.hardware} />
              ))}
          </Row>
          <Row label={t("settings.capsContainers")}>
            {Object.entries(caps.containers).map(([mime, ok]) => (
              <Chip key={mime} label={CONTAINER_LABEL[mime] ?? mime} state={ok} title={mime} />
            ))}
          </Row>
        </>
      )}

      <Row label={t("settings.lastPlayback")}>
        {!lastRemux ? (
          <span className="text-[11px] text-[var(--muted)]">{t("settings.lastPlaybackNone")}</span>
        ) : (
          <>
            <Chip
              label={`${lastRemux.video_codec.toUpperCase()} → ${
                lastRemux.video === "copy" ? t("settings.copy") : t("settings.transcode")
              }`}
              state={lastRemux.video === "copy"}
            />
            <Chip
              label={`${(lastRemux.audio_codec ?? "?").toUpperCase()} → ${
                lastRemux.audio === "copy" ? t("settings.copy") : t("settings.transcode")
              }`}
              state={lastRemux.audio === "copy"}
            />
          </>
        )}
      </Row>

      <p className="mt-3 text-[10px] text-[var(--muted)]">{t("settings.capsNote")}</p>
    </details>
  );
}
