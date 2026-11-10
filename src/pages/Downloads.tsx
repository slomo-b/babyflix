import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderOpen, Loader2, Play, Trash2, X } from "lucide-react";
import { api, imgUrl, DownloadInfo } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";

function fmtSize(bytes: number): string {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function pct(d: DownloadInfo): number {
  if (d.state === "done") return 100;
  if (!d.total) return 0;
  return Math.min(100, Math.round((d.done / d.total) * 100));
}

export default function Downloads() {
  const t = useT();
  const qc = useQueryClient();
  const play = useStore((s) => s.play);
  const [confirm, setConfirm] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    // Poll while something is running; finished lists are cheap to refresh.
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.state === "running") ? 1000 : 15000,
  });

  const items = data?.items ?? [];
  const running = items.filter((i) => i.state === "running");
  const used = items.reduce((n, i) => n + (i.state === "done" ? i.total || i.done : 0), 0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["downloads"] });

  const playLocal = (d: DownloadInfo) => {
    play({
      kind: "local",
      id: d.id,
      ext: d.ext,
      title: d.title,
      subtitle: d.subtitle ?? undefined,
      poster: d.poster ?? undefined,
      // Derselbe Verlaufseintrag wie beim Streamen, damit "Weiterschauen" stimmt.
      historyKey: `${d.kind}:${d.source_id}`,
      sourceKind: d.kind,
      sourceId: d.source_id,
      seriesId: d.series_id ?? undefined,
    });
  };

  return (
    <div className="animate-fade-in pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{t("downloads.title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("downloads.subtitle")}
            {items.length > 0 ? ` · ${items.length}` : ""}
            {used > 0 ? ` · ${t("downloads.used")}: ${fmtSize(used)}` : ""}
          </p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => void api.downloadsOpen().catch(() => undefined)}
          title={data?.dir}
        >
          <FolderOpen size={16} /> {t("downloads.openFolder")}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-12 text-center text-sm text-[var(--muted)]">
          <Download size={30} className="text-[var(--muted)]" />
          <span className="max-w-md">{t("downloads.empty")}</span>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((d) => {
            const p = pct(d);
            return (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-3 sm:flex-nowrap"
              >
                <div className="relative flex aspect-video w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--surface-2)] sm:w-36">
                  {d.poster ? (
                    <img src={imgUrl(d.poster)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Download className="text-[var(--muted)]" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{d.title}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        d.state === "done"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : d.state === "running"
                            ? "bg-[var(--accent)]/25 text-[var(--accent-2)]"
                            : "bg-white/10 text-[var(--muted)]"
                      }`}
                    >
                      {d.state === "running"
                        ? `${t("downloads.state.running")} ${p}%`
                        : t(`downloads.state.${d.state}` as "downloads.state.done")}
                    </span>
                  </div>
                  {d.subtitle && (
                    <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{d.subtitle}</div>
                  )}

                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                        style={{ width: `${d.state === "running" ? Math.max(2, p) : p}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">
                      {fmtSize(d.state === "done" ? d.total || d.done : d.done)}
                      {d.total ? ` / ${fmtSize(d.total)}` : ""}
                    </span>
                  </div>

                  {d.state === "error" && d.error && (
                    <div className="mt-1 text-[11px] text-rose-300">{d.error}</div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {d.state === "done" && (
                    <button className="btn btn-primary py-2" onClick={() => playLocal(d)}>
                      <Play size={16} fill="currentColor" /> {t("downloads.play")}
                    </button>
                  )}
                  {d.state === "running" && (
                    <button
                      className="btn btn-ghost py-2"
                      onClick={() => void api.downloadStop(d.id).then(refresh)}
                    >
                      <Loader2 size={16} className="animate-spin" /> {t("downloads.stop")}
                    </button>
                  )}
                  {confirm === d.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        className="btn py-2 text-rose-300 hover:bg-rose-500/15"
                        onClick={() => {
                          void api.downloadRemove(d.id).then(() => {
                            setConfirm(null);
                            refresh();
                          });
                        }}
                      >
                        <Trash2 size={16} /> {t("downloads.confirmRemove")}
                      </button>
                      <button className="btn btn-ghost py-2" onClick={() => setConfirm(null)}>
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost py-2"
                      onClick={() => setConfirm(d.id)}
                      title={t("downloads.remove")}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {running.length > 0 && (
        <p className="mt-4 text-xs text-[var(--muted)]">
          {running.length} × {t("downloads.state.running")} · {data?.dir}
        </p>
      )}
    </div>
  );
}
