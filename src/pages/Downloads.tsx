import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
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
import { initials, initialsColor } from "../lib/format";

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

/** Local images come from the app itself; everything else goes through the proxy. */
function mediaUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  return u.startsWith("http://127.0.0.1") ? u : imgUrl(u);
}

function Cover({
  poster,
  title,
  children,
}: {
  poster?: string | null;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden bg-[var(--surface-2)]">
      {poster ? (
        <img
          src={mediaUrl(poster)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-3xl font-black tracking-tight text-white/90"
          style={{ background: `linear-gradient(150deg, ${initialsColor(title)}, #12141d)` }}
        >
          {initials(title) || "?"}
        </div>
      )}
      {children}
    </div>
  );
}

type Filter = "all" | "movie" | "series" | "active";
type Sort = "newest" | "title" | "size";

interface SeriesGroup {
  key: string;
  seriesId: string | null;
  title: string;
  poster?: string | null;
  episodes: DownloadInfo[];
  bytes: number;
  created: number;
}

export default function Downloads() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const play = useStore((s) => s.play);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const { data } = useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.state === "running" || i.state === "queued")
        ? 1000
        : 15000,
  });

  const all = data?.items ?? [];
  const runningCount = all.filter((i) => i.state === "running" || i.state === "queued").length;
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
        season: d.season ?? undefined,
        episode: d.episode ?? undefined,
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
      historyKey: `${d.kind}:${d.source_id}`,
      sourceKind: d.kind,
      sourceId: d.source_id,
      seriesId: d.series_id ?? undefined,
    });
  };

  const openDetail = (d: DownloadInfo) =>
    navigate(`/local/${d.kind === "series" ? "series" : "movie"}/${d.kind === "series" ? d.series_id ?? d.source_id : d.source_id}`);

  const remove = (d: DownloadInfo) =>
    void api.downloadRemove(d.id).then(() => {
      setConfirm(null);
      refresh();
    });

  const filtered = useMemo(() => {
    const list = all.filter((d) =>
      filter === "all" ? true : filter === "active" ? d.state !== "done" : d.kind === filter
    );
    const bySize = (d: DownloadInfo) => d.total || d.done;
    return [...list].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "de")
        : sort === "size"
          ? bySize(b) - bySize(a)
          : b.created - a.created
    );
  }, [all, filter, sort]);

  const runningItems = filtered.filter((i) => i.state === "running" || i.state === "queued");
  const failedItems = filtered.filter(
    (i) => i.state === "stopped" || i.state === "error" || i.state === "paused"
  );
  const doneItems = filtered.filter((i) => i.state === "done");
  const doneMovies = doneItems.filter((i) => i.kind === "movie");

  const seriesGroups = useMemo<SeriesGroup[]>(() => {
    const map = new Map<string, SeriesGroup>();
    for (const d of doneItems) {
      if (d.kind !== "series") continue;
      const key = d.series_id ?? d.title;
      const g = map.get(key) ?? {
        key,
        seriesId: d.series_id ?? null,
        title: d.title,
        poster: d.poster ?? null,
        episodes: [],
        bytes: 0,
        created: 0,
      };
      g.episodes.push(d);
      g.bytes += d.total || d.done;
      g.created = Math.max(g.created, d.created);
      map.set(key, g);
    }
    const groups = [...map.values()];
    return groups.sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "de")
        : sort === "size"
          ? b.bytes - a.bytes
          : b.created - a.created
    );
  }, [doneItems, sort]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("downloads.filter.all") },
    { key: "movie", label: t("downloads.filter.movies") },
    { key: "series", label: t("downloads.filter.series") },
    { key: "active", label: t("downloads.filter.active") },
  ];

  const hasSomething =
    runningItems.length + failedItems.length + doneMovies.length + seriesGroups.length > 0;

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

      {data?.dir && (
        <p className="mt-2 select-all truncate text-xs text-[var(--muted)]" title={data.dir}>
          {t("downloads.folder")}: {data.dir}
        </p>
      )}

      {all.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-12 text-center text-sm text-[var(--muted)]">
          <Download size={30} className="text-[var(--muted)]" />
          <span className="max-w-md">{t("downloads.empty")}</span>
        </div>
      ) : (
        <>
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

          {!hasSomething && (
            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-8 text-center text-sm text-[var(--muted)]">
              {t("downloads.filterEmpty")}
            </div>
          )}

          {runningItems.length > 0 && (
            <section className="mt-7">
              <SectionHead
                title={t("downloads.section.running")}
                count={runningItems.length}
                bytes={runningItems.reduce((n, d) => n + (d.total || d.done), 0)}
              />
              <div className="grid gap-4" style={GRID}>
                {runningItems.map((d) => (
                  <DownloadCard
                    key={d.id}
                    d={d}
                    onOpen={openDetail}
                    onPlay={playLocal}
                    onResume={resume}
                    onStop={(x) => void api.downloadStop(x.id).then(refresh)}
                    onDelete={remove}
                    confirm={confirm}
                    setConfirm={setConfirm}
                  />
                ))}
              </div>
            </section>
          )}

          {(doneMovies.length > 0 || seriesGroups.length > 0) && (
            <section className="mt-7">
              <SectionHead
                title={t("downloads.section.done")}
                count={doneItems.length}
                bytes={doneItems.reduce((n, d) => n + (d.total || d.done), 0)}
              />
              <div className="grid gap-4" style={GRID}>
                {doneMovies.map((d) => (
                  <DownloadCard
                    key={d.id}
                    d={d}
                    onOpen={openDetail}
                    onPlay={playLocal}
                    onResume={resume}
                    onStop={(x) => void api.downloadStop(x.id).then(refresh)}
                    onDelete={remove}
                    confirm={confirm}
                    setConfirm={setConfirm}
                  />
                ))}
                {seriesGroups.map((g) => (
                  <SeriesCard
                    key={g.key}
                    group={g}
                    onOpen={() =>
                      g.seriesId
                        ? navigate(`/local/series/${g.seriesId}`)
                        : navigate("/downloads")
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {failedItems.length > 0 && (
            <section className="mt-7">
              <SectionHead
                title={t("downloads.section.failed")}
                count={failedItems.length}
                bytes={failedItems.reduce((n, d) => n + (d.total || d.done), 0)}
              />
              <div className="grid gap-4" style={GRID}>
                {failedItems.map((d) => (
                  <DownloadCard
                    key={d.id}
                    d={d}
                    onOpen={openDetail}
                    onPlay={playLocal}
                    onResume={resume}
                    onStop={(x) => void api.downloadStop(x.id).then(refresh)}
                    onDelete={remove}
                    confirm={confirm}
                    setConfirm={setConfirm}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {runningCount > 0 && (
        <p className="mt-6 text-xs text-[var(--muted)]">
          {runningCount} × {t("downloads.state.running")} · {data?.dir}
        </p>
      )}
    </div>
  );
}

const GRID = { gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))" } as const;

function SectionHead({ title, count, bytes }: { title: string; count: number; bytes: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--muted)]">{title}</h2>
      <span className="text-xs text-[var(--muted)]">
        {count}
        {bytes > 0 ? ` · ${fmtSize(bytes)}` : ""}
      </span>
    </div>
  );
}

function SeriesCard({ group, onOpen }: { group: SeriesGroup; onOpen: () => void }) {
  const t = useT();
  return (
    <div
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white/[0.03] transition hover:border-[var(--accent)]/40 hover:bg-white/[0.05]"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <Cover poster={group.poster} title={group.title}>
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
          {t("downloads.episodesCount", { n: group.episodes.length })}
        </span>
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
            <ChevronRight size={22} />
          </span>
        </span>
      </Cover>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-snug">{group.title}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-[var(--muted)]">
          <span>
            {group.episodes.length} · {fmtSize(group.bytes)}
          </span>
          <ChevronRight size={15} />
        </div>
      </div>
    </div>
  );
}

function DownloadCard({
  d,
  onOpen,
  onPlay,
  onResume,
  onStop,
  onDelete,
  confirm,
  setConfirm,
}: {
  d: DownloadInfo;
  onOpen: (d: DownloadInfo) => void;
  onPlay: (d: DownloadInfo) => void;
  onResume: (d: DownloadInfo) => void;
  onStop: (d: DownloadInfo) => void;
  onDelete: (d: DownloadInfo) => void;
  confirm: string | null;
  setConfirm: (id: string | null) => void;
}) {
  const t = useT();
  const p = pct(d);
  const failed = d.state === "stopped" || d.state === "error" || d.state === "paused";
  const playable = d.state === "done";

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white/[0.03] transition hover:border-[var(--accent)]/40 hover:bg-white/[0.05]">
      <div
        className="relative cursor-pointer"
        onClick={() => onOpen(d)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onOpen(d)}
        title={t("local.openDetails")}
      >
        <Cover poster={d.poster} title={d.title}>
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur ${
              d.state === "done"
                ? "bg-emerald-500/85 text-emerald-50"
                : d.state === "running" || d.state === "queued"
                  ? "bg-[var(--accent)]/85 text-white"
                  : "bg-black/70 text-rose-200"
            }`}
          >
            {d.state === "running"
              ? `${p}%`
              : d.state === "queued"
                ? t("downloads.state.queued")
                : d.state === "done"
                  ? t("downloads.state.done")
                  : d.state === "paused"
                    ? t("downloads.state.paused")
                    : t("downloads.state.stopped")}
          </span>

          {playable && (
            <button
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(d);
              }}
              title={t("downloads.play")}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                <Play size={20} fill="currentColor" />
              </span>
            </button>
          )}

          {d.state === "running" && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
              <span
                className="block h-full bg-[var(--accent)] transition-[width]"
                style={{ width: `${Math.max(2, p)}%` }}
              />
            </span>
          )}
        </Cover>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <button className="text-left" onClick={() => onOpen(d)}>
          <div className="line-clamp-2 text-sm font-semibold leading-snug">{d.title}</div>
          {d.subtitle && (
            <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{d.subtitle}</div>
          )}
        </button>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-[11px] text-[var(--muted)]">
            {fmtSize(d.state === "done" ? d.total || d.done : d.done)}
            {d.state !== "done" && d.total ? ` / ${fmtSize(d.total)}` : ""}
          </span>
          <span className="flex items-center gap-1">
            {d.state === "running" || d.state === "queued" ? (
              <IconButton label={t("downloads.stop")} onClick={() => onStop(d)}>
                <Loader2 size={15} className={d.state === "running" ? "animate-spin" : ""} />
              </IconButton>
            ) : null}
            {failed && (
              <IconButton label={t("downloads.resume")} onClick={() => onResume(d)}>
                <RotateCcw size={15} />
              </IconButton>
            )}
            <DeleteButton
              id={d.id}
              d={d}
              onDelete={onDelete}
              confirm={confirm}
              setConfirm={setConfirm}
            />
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
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DeleteButton({
  id,
  d,
  onDelete,
  confirm,
  setConfirm,
}: {
  id: string;
  d: DownloadInfo;
  onDelete: (d: DownloadInfo) => void;
  confirm: string | null;
  setConfirm: (id: string | null) => void;
}) {
  const t = useT();
  if (confirm === id) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          className="rounded-lg bg-rose-500/20 px-2 py-1 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-500/30"
          onClick={() => onDelete(d)}
        >
          {t("downloads.remove")}
        </button>
        <IconButton label={t("downloads.cancel")} onClick={() => setConfirm(null)}>
          <X size={13} />
        </IconButton>
      </span>
    );
  }
  return (
    <IconButton label={t("downloads.remove")} onClick={() => setConfirm(id)}>
      <Trash2 size={14} />
    </IconButton>
  );
}
