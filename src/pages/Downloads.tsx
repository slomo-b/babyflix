import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FolderOpen,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { api, imgUrl, DownloadInfo } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { Select } from "../components/Select";

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

type Filter = "all" | "movie" | "series" | "active";
type Sort = "newest" | "title" | "size";

export default function Downloads() {
  const t = useT();
  const qc = useQueryClient();
  const play = useStore((s) => s.play);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.state === "running") ? 1000 : 15000,
  });

  const all = data?.items ?? [];
  const running = all.filter((i) => i.state === "running");
  const used = all.reduce((n, i) => n + (i.state === "done" ? i.total || i.done : 0), 0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["downloads"] });

  const resume = (d: DownloadInfo) =>
    void api
      .download({
        kind: d.kind,
        id: d.source_id,
        title: d.title,
        subtitle: d.subtitle ?? undefined,
        poster: d.poster ?? undefined,
        series_id: d.series_id ?? undefined,
        ext: d.ext,
      })
      .catch(() => undefined)
      .finally(refresh);

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

  const items = useMemo(() => {
    const filtered = all.filter((d) =>
      filter === "all"
        ? true
        : filter === "active"
          ? d.state !== "done"
          : d.kind === filter
    );
    const bySize = (d: DownloadInfo) => d.total || d.done;
    return [...filtered].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "de")
        : sort === "size"
          ? bySize(b) - bySize(a)
          : b.created - a.created
    );
  }, [all, filter, sort]);

  // Nach Status gruppieren: was läuft, steht oben; Fehler/Angehaltenes darunter.
  const sections = useMemo(
    () =>
      [
        { key: "running" as const, list: items.filter((i) => i.state === "running") },
        { key: "done" as const, list: items.filter((i) => i.state === "done") },
        {
          key: "failed" as const,
          list: items.filter((i) => i.state === "stopped" || i.state === "error"),
        },
      ].filter((s) => s.list.length > 0),
    [items]
  );

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("downloads.filter.all") },
    { key: "movie", label: t("downloads.filter.movies") },
    { key: "series", label: t("downloads.filter.series") },
    { key: "active", label: t("downloads.filter.active") },
  ];

  return (
    <div className="animate-fade-in pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{t("downloads.title")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("downloads.subtitle")}
            {all.length > 0 ? ` · ${all.length}` : ""}
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

      {all.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-12 text-center text-sm text-[var(--muted)]">
          <Download size={30} className="text-[var(--muted)]" />
          <span className="max-w-md">{t("downloads.empty")}</span>
        </div>
      ) : (
        <>
          {/* Filter + Sortierung */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {filters.map((f) => {
                const count =
                  f.key === "all"
                    ? all.length
                    : f.key === "active"
                      ? all.filter((i) => i.state !== "done").length
                      : all.filter((i) => i.kind === f.key).length;
                return (
                  <button
                    key={f.key}
                    className="chip"
                    data-active={filter === f.key}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                    {count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
                  </button>
                );
              })}
            </div>
            <Select
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              options={[
                { value: "newest", label: t("downloads.sort.newest") },
                { value: "title", label: t("downloads.sort.title") },
                { value: "size", label: t("downloads.sort.size") },
              ]}
            />
          </div>

          {items.length === 0 && (
            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-8 text-center text-sm text-[var(--muted)]">
              {t("downloads.filterEmpty")}
            </div>
          )}

          {sections.map((section) => {
            const bytes = section.list.reduce((n, d) => n + (d.total || d.done), 0);
            return (
              <section key={section.key} className="mt-7">
                <div className="mb-3 flex items-baseline gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
                    {t(`downloads.section.${section.key}`)}
                  </h2>
                  <span className="text-xs text-[var(--muted)]">
                    {section.list.length}
                    {bytes > 0 ? ` · ${fmtSize(bytes)}` : ""}
                  </span>
                </div>

                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}
                >
                  {section.list.map((d) => {
                    const p = pct(d);
                    const failed = d.state === "stopped" || d.state === "error";
                    return (
                      <div
                        key={d.id}
                        className="group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white/[0.03] transition hover:border-[var(--accent)]/40 hover:bg-white/[0.05]"
                      >
                        <button
                          className="relative aspect-video w-full overflow-hidden bg-[var(--surface-2)]"
                          onClick={() => d.state === "done" && playLocal(d)}
                          disabled={d.state !== "done"}
                          title={d.state === "done" ? t("downloads.play") : undefined}
                        >
                          {d.poster ? (
                            <img
                              src={imgUrl(d.poster)}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center">
                              <Download className="text-[var(--muted)]" />
                            </span>
                          )}

                          {/* Zustand oben links */}
                          <span
                            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${
                              d.state === "done"
                                ? "bg-emerald-500/85 text-emerald-50"
                                : d.state === "running"
                                  ? "bg-[var(--accent)]/85 text-white"
                                  : "bg-black/70 text-rose-200"
                            }`}
                          >
                            {d.state === "running"
                              ? `${p}%`
                              : d.state === "done"
                                ? t("downloads.state.done")
                                : t("downloads.state.error")}
                          </span>

                          {d.state === "done" && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                                <Play size={20} fill="currentColor" />
                              </span>
                            </span>
                          )}

                          {/* Fortschritt am unteren Rand */}
                          {d.state === "running" && (
                            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                              <span
                                className="block h-full bg-[var(--accent)] transition-[width]"
                                style={{ width: `${Math.max(2, p)}%` }}
                              />
                            </span>
                          )}
                        </button>

                        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                          <div className="line-clamp-2 text-sm font-semibold leading-snug">
                            {d.title}
                          </div>
                          {d.subtitle && (
                            <div className="truncate text-xs text-[var(--muted)]">{d.subtitle}</div>
                          )}

                          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                            <span className="text-[11px] text-[var(--muted)]">
                              {fmtSize(d.state === "done" ? d.total || d.done : d.done)}
                              {d.state !== "done" && d.total
                                ? ` / ${fmtSize(d.total)}`
                                : ""}
                            </span>
                            <span className="flex items-center gap-1">
                              {d.state === "running" && (
                                <button
                                  className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
                                  title={t("downloads.stop")}
                                  onClick={() => void api.downloadStop(d.id).then(refresh)}
                                >
                                  <Loader2 size={15} className="animate-spin" />
                                </button>
                              )}
                              {failed && (
                                <button
                                  className="rounded-lg p-1.5 text-[var(--accent-2)] transition hover:bg-white/10 hover:text-white"
                                  title={t("downloads.resume")}
                                  onClick={() => resume(d)}
                                >
                                  <RotateCcw size={15} />
                                </button>
                              )}
                              {confirm === d.id ? (
                                <>
                                  <button
                                    className="rounded-lg bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/30"
                                    onClick={() =>
                                      void api.downloadRemove(d.id).then(() => {
                                        setConfirm(null);
                                        refresh();
                                      })
                                    }
                                  >
                                    {t("downloads.remove")}
                                  </button>
                                  <button
                                    className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
                                    onClick={() => setConfirm(null)}
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="rounded-lg p-1.5 text-[var(--muted)] opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
                                  title={t("downloads.remove")}
                                  onClick={() => setConfirm(d.id)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </span>
                          </div>

                          {d.state === "error" && d.error && (
                            <div className="line-clamp-2 text-[11px] text-rose-300" title={d.error}>
                              {d.error}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}

      {running.length > 0 && (
        <p className="mt-6 text-xs text-[var(--muted)]">
          {running.length} × {t("downloads.state.running")} · {data?.dir}
        </p>
      )}
    </div>
  );
}
