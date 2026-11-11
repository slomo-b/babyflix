import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
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

/** "S3 · E1" - neu aus den Feldern, alt aus dem Untertitel geparst. */
function episodeLabel(d: DownloadInfo): string {
  if (d.season != null && d.episode != null) return `S${d.season} · E${d.episode}`;
  const m = (d.subtitle ?? "").match(/^S(\d+)\s*·\s*E(\d+)/);
  return m ? `S${m[1]} · E${m[2]}` : "";
}

/** Folgentitel: beim Download stand "S3 · E1 – <Titel>" im Untertitel. */
function episodeTitle(d: DownloadInfo): string {
  const sub = d.subtitle ?? "";
  const idx = sub.indexOf("–");
  return (idx >= 0 ? sub.slice(idx + 1) : sub).trim();
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
  const play = useStore((s) => s.play);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [open, setOpen] = useState<string | null>(null);

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
      // Derselbe Verlaufseintrag wie beim Streamen, damit "Weiterschauen" stimmt.
      historyKey: `${d.kind}:${d.source_id}`,
      sourceKind: d.kind,
      sourceId: d.source_id,
      seriesId: d.series_id ?? undefined,
    });
  };

  const remove = (d: DownloadInfo) =>
    void api.downloadRemove(d.id).then(() => {
      setConfirm(null);
      refresh();
    });

  const filtered = useMemo(() => {
    const list = all.filter((d) =>
      filter === "all"
        ? true
        : filter === "active"
          ? d.state !== "done"
          : d.kind === filter
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

  const runningItems = filtered.filter((i) => i.state === "running");
  const failedItems = filtered.filter((i) => i.state === "stopped" || i.state === "error");
  const doneItems = filtered.filter((i) => i.state === "done");
  const doneMovies = doneItems.filter((i) => i.kind === "movie");

  /** Fertige Folgen zu je einer Serie zusammenfassen. */
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
      if (!g.poster && d.poster) g.poster = d.poster;
      map.set(key, g);
    }
    const groups = [...map.values()];
    for (const g of groups) {
      g.episodes.sort(
        (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)
      );
    }
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

  const openGroup = seriesGroups.find((g) => g.key === open) ?? null;

  const hasSomething = runningItems.length + failedItems.length + doneMovies.length + seriesGroups.length > 0;

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
        <p
          className="mt-2 select-all truncate text-xs text-[var(--muted)]"
          title={data.dir}
        >
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

          {/* Läuft gerade */}
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

          {/* Offline verfügbar: Filme + je eine Karte pro Serie */}
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
                    onPlay={playLocal}
                    onResume={resume}
                    onStop={(x) => void api.downloadStop(x.id).then(refresh)}
                    onDelete={remove}
                    confirm={confirm}
                    setConfirm={setConfirm}
                  />
                ))}
                {seriesGroups.map((g) => {
                  const expanded = open === g.key;
                  return (
                      <button
                        key={g.key}
                        className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white/[0.03] text-left transition hover:border-[var(--accent)]/40 hover:bg-white/[0.05] ${
                          expanded ? "border-[var(--accent)]/50" : "border-[var(--border)]"
                        }`}
                        onClick={() => setOpen(expanded ? null : g.key)}
                      >
                        <span className="relative aspect-video w-full overflow-hidden bg-[var(--surface-2)]">
                          {g.poster ? (
                            <img
                              src={imgUrl(g.poster)}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center">
                              <Download className="text-[var(--muted)]" />
                            </span>
                          )}
                          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
                            {t("downloads.episodesCount", { n: g.episodes.length })}
                          </span>
                          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg">
                              {expanded ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
                            </span>
                          </span>
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                          <span className="line-clamp-2 text-sm font-semibold leading-snug">
                            {g.title}
                          </span>
                          <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-[var(--muted)]">
                            <span>
                              {g.episodes.length} · {fmtSize(g.bytes)}
                            </span>
                            <span className="flex items-center gap-1">
                              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </span>
                          </span>
                        </span>
                      </button>
                  );
                })}
              </div>

              {/* Vollbreite Folgenliste der gewählten Serie */}
              {openGroup && (
                <div className="mt-5 rounded-2xl border border-[var(--accent)]/35 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-start justify-between gap-3 px-1">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{openGroup.title}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {t("downloads.episodesCount", { n: openGroup.episodes.length })} ·{" "}
                        {fmtSize(openGroup.bytes)}
                      </div>
                    </div>
                    <button
                      className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
                      onClick={() => setOpen(null)}
                      title={t("downloads.cancel")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <SeriesEpisodes
                    group={openGroup}
                    onPlay={playLocal}
                    onResume={resume}
                    onDelete={remove}
                    confirm={confirm}
                    setConfirm={setConfirm}
                  />
                </div>
              )}
            </section>
          )}

          {/* Angehalten & Fehler */}
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

      {running.length > 0 && (
        <p className="mt-6 text-xs text-[var(--muted)]">
          {running.length} × {t("downloads.state.running")} · {data?.dir}
        </p>
      )}
    </div>
  );
}

const GRID = { gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" } as const;

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

/** Alle Folgen einer Serie: geladene zum Abspielen, fehlende ausgegraut. */
function SeriesEpisodes({
  group,
  onPlay,
  onResume,
  onDelete,
  confirm,
  setConfirm,
}: {
  group: SeriesGroup;
  onPlay: (d: DownloadInfo) => void;
  onResume: (d: DownloadInfo) => void;
  onDelete: (d: DownloadInfo) => void;
  confirm: string | null;
  setConfirm: (id: string | null) => void;
}) {
  const t = useT();
  const seriesId = group.seriesId;
  // Optional: die vollständige Folgenliste der Serie, um fehlende Folgen zu zeigen.
  const { data } = useQuery({
    queryKey: ["detail", "series", seriesId],
    queryFn: () => api.detail("series", seriesId as string),
    enabled: !!seriesId,
    staleTime: 1000 * 60 * 60,
    retry: false,
  });

  const downloaded = useMemo(() => {
    const map = new Map<string, DownloadInfo>();
    for (const d of group.episodes) map.set(d.source_id, d);
    return map;
  }, [group.episodes]);

  const seasons = (data?.seasons ?? []).filter((s) =>
    s.episodes.some((e) => downloaded.has(e.id))
  );

  return (
    <div>
      {seasons.length === 0 ? (
        <ul className="divide-y divide-[var(--border)]">
          {group.episodes.map((d) => {
            const link = false;
            return (
              <li key={d.id} className="flex items-center gap-2 px-2 py-2">
                <span className="w-20 shrink-0 text-xs font-semibold text-[var(--accent-2)]">
                  {episodeLabel(d)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{episodeTitle(d)}</span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">
                  {fmtSize(d.total || d.done)}
                </span>
                <IconButton label={t("downloads.play")} onClick={() => onPlay(d)}>
                  <Play size={14} fill="currentColor" />
                </IconButton>
                <DeleteButton
                  id={d.id}
                  onDelete={onDelete}
                  d={d}
                  confirm={confirm}
                  setConfirm={setConfirm}
                />
                {link && null}
              </li>
            );
          })}
        </ul>
      ) : (
        seasons.map((season) => (
          <div key={season.number} className="mb-1 last:mb-0">
            <div className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
              {t("downloads.season", { n: season.number })}
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {season.episodes.map((ep) => {
                const d = downloaded.get(ep.id);
                return (
                  <li
                    key={ep.id}
                    className={`flex items-center gap-2 px-2 py-2 ${
                      d ? "" : "opacity-45"
                    }`}
                  >
                    <span className="w-8 shrink-0 text-xs font-semibold text-[var(--accent-2)]">
                      E{ep.num}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{ep.title}</span>
                    {d ? (
                      <>
                        <span className="shrink-0 text-[11px] text-[var(--muted)]">
                          {fmtSize(d.total || d.done)}
                        </span>
                        <IconButton label={t("downloads.play")} onClick={() => onPlay(d)}>
                          <Play size={14} fill="currentColor" />
                        </IconButton>
                        <DeleteButton
                          id={d.id}
                          onDelete={onDelete}
                          d={d}
                          confirm={confirm}
                          setConfirm={setConfirm}
                        />
                        {d.state !== "done" && (
                          <IconButton label={t("downloads.resume")} onClick={() => onResume(d)}>
                            <RotateCcw size={14} />
                          </IconButton>
                        )}
                      </>
                    ) : (
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">
                        {t("downloads.notDownloaded")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
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

function DownloadCard({
  d,
  onPlay,
  onResume,
  onStop,
  onDelete,
  confirm,
  setConfirm,
}: {
  d: DownloadInfo;
  onPlay: (d: DownloadInfo) => void;
  onResume: (d: DownloadInfo) => void;
  onStop: (d: DownloadInfo) => void;
  onDelete: (d: DownloadInfo) => void;
  confirm: string | null;
  setConfirm: (id: string | null) => void;
}) {
  const t = useT();
  const p = pct(d);
  const failed = d.state === "stopped" || d.state === "error";
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white/[0.03] transition hover:border-[var(--accent)]/40 hover:bg-white/[0.05]">
      <button
        className="relative aspect-video w-full overflow-hidden bg-[var(--surface-2)]"
        onClick={() => d.state === "done" && onPlay(d)}
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
        <div className="line-clamp-2 text-sm font-semibold leading-snug">{d.title}</div>
        {d.subtitle && (
          <div className="truncate text-xs text-[var(--muted)]">{d.subtitle}</div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-[11px] text-[var(--muted)]">
            {fmtSize(d.state === "done" ? d.total || d.done : d.done)}
            {d.state !== "done" && d.total ? ` / ${fmtSize(d.total)}` : ""}
          </span>
          <span className="flex items-center gap-1">
            {d.state === "running" && (
              <IconButton label={t("downloads.stop")} onClick={() => onStop(d)}>
                <Loader2 size={15} className="animate-spin" />
              </IconButton>
            )}
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
