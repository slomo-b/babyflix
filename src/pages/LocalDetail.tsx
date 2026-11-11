import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Download,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api, imgUrl, DetailResponse, DownloadInfo } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { Select } from "../components/Select";
import { asRating, fmtVotes, initials, initialsColor, yearOf } from "../lib/format";

/**
 * Detail page for downloaded content.
 *
 * Uses the copy of the provider metadata that was stored with the download, so it
 * works without internet - same layout as the streaming detail page.
 */
export default function LocalDetail({ kind }: { kind: "movie" | "series" }) {
  const t = useT();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const play = useStore((s) => s.play);
  const [seasonIdx, setSeasonIdx] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);

  const detailQ = useQuery({
    queryKey: ["local_detail", kind, id],
    queryFn: () => api.localDetail(kind, id),
    enabled: !!id,
    retry: false,
    staleTime: 1000 * 60 * 30,
  });

  const downloadsQ = useQuery({
    queryKey: ["downloads"],
    queryFn: api.downloads,
    refetchInterval: 2000,
  });

  const downloads = downloadsQ.data?.items ?? [];
  const bySource = useMemo(() => {
    const map = new Map<string, DownloadInfo>();
    for (const d of downloads) map.set(`${d.kind}:${d.source_id}`, d);
    return map;
  }, [downloads]);

  const data: DetailResponse | undefined = detailQ.data;
  const item = data?.item;
  const detail = data?.detail;
  const imdb = data?.imdb;
  const seasons = data?.seasons ?? [];
  const activeSeason = seasons[Math.min(seasonIdx, Math.max(0, seasons.length - 1))];

  const movieDownload = bySource.get(`movie:${id}`);
  // Der Anbieter liefert bei manchen Titeln gar keine Infos - dann steht dort nur
  // "Film #<id>". Fallback: der beim Download gespeicherte Name.
  const seriesTitle = downloads.find((d) => d.series_id === id)?.title;
  const rawTitle = item?.name ?? "";
  const placeholder = !rawTitle.trim() || /^(Film|Serie) #\d+/.test(rawTitle);
  const title = placeholder
    ? movieDownload?.title ?? seriesTitle ?? (rawTitle.trim() || t("local.unknown"))
    : rawTitle;
  const poster = imgUrl(imdb?.image ?? item?.cover ?? movieDownload?.poster);
  const backdrop = imgUrl(detail?.backdrop ?? item?.cover ?? movieDownload?.poster);

  const refresh = () => qc.invalidateQueries({ queryKey: ["downloads"] });

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

  const episodes = activeSeason?.episodes ?? [];
  const downloadedEpisodes = episodes.filter((e) => bySource.get(`series:${e.id}`)?.state === "done");

  const fixUpload = (ep: { id: string; num: number; title: string; extension: string; cover: string | null }) =>
    api
      .download({
        kind: "series",
        id: ep.id,
        title: item?.name ?? title,
        subtitle: `S${activeSeason?.number ?? 1} · E${ep.num} – ${ep.title}`,
        poster: item?.cover ?? undefined,
        series_id: id,
        season: activeSeason?.number ?? 1,
        episode: ep.num,
        ext: ep.extension,
      })
      .catch(() => undefined)
      .finally(refresh);

  return (
    <div className="animate-fade-in">
      <button
        className="mt-4 mb-3 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
        onClick={() => navigate("/downloads")}
      >
        <ArrowLeft size={16} /> {t("downloads.title")}
      </button>

      <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface-2)]">
        {backdrop && (
          <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f16] via-[#0d0f16]/85 to-[#0d0f16]/40" />
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row">
          <div className="w-40 shrink-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl sm:w-48">
            <div className="aspect-[2/3] w-full bg-[var(--surface-3)]">
              {poster ? (
                <img src={poster} alt="" className="h-full w-full object-cover" />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-3xl font-black text-white/90"
                  style={{ background: `linear-gradient(150deg, ${initialsColor(title)}, #12141d)` }}
                >
                  {initials(title) || "?"}
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[var(--muted)]">
                {kind === "series" ? t("nav.series") : t("nav.movies")}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-emerald-300">
                <Check size={12} /> {t("downloads.state.done")}
              </span>
            </div>

            <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight">{title}</h1>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--muted)]">
              {(() => {
                const year = yearOf(item?.name ?? title);
                return year ? <span>{year}</span> : null;
              })()}
              {(() => {
                const rating = asRating(imdb?.rating ?? detail?.rating);
                return rating ? (
                  <span className="inline-flex items-center gap-1 text-[var(--imdb)]">
                    ★ {rating.toFixed(1)}
                    {imdb?.votes ? ` · ${fmtVotes(imdb.votes)}` : ""}
                  </span>
                ) : null;
              })()}
              {detail?.genre && <span className="truncate">{detail.genre}</span>}
              {detail?.duration && <span>{detail.duration}</span>}
            </div>

            {detail?.plot && (
              <p className="mt-4 line-clamp-5 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
                {detail.plot}
              </p>
            )}

            {imdb?.cast && imdb.cast.length > 0 && (
              <p className="mt-3 max-w-3xl truncate text-xs text-[var(--muted)]">
                {imdb.cast.slice(0, 6).join(", ")}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              {kind === "movie" &&
                (movieDownload?.state === "done" ? (
                  <button className="btn btn-primary py-3 text-base" onClick={() => playLocal(movieDownload)}>
                    <Play size={18} fill="currentColor" /> {t("common.play")}
                  </button>
                ) : (
                  <span className="text-sm text-[var(--muted)]">{t("local.notDownloaded")}</span>
                ))}

              {kind === "series" && downloadedEpisodes.length > 0 && (
                <button
                  className="btn btn-primary py-3 text-base"
                  onClick={() => {
                    const d = bySource.get(`series:${downloadedEpisodes[0].id}`);
                    if (d) playLocal(d);
                  }}
                >
                  <Play size={18} fill="currentColor" /> {t("local.playFirst")}
                </button>
              )}

              {kind === "movie" && movieDownload && (
                <button
                  className={`btn btn-ghost py-3 text-rose-300 ${
                    confirm === movieDownload.id ? "bg-rose-500/15" : ""
                  }`}
                  onClick={() => {
                    if (confirm === movieDownload.id) {
                      void api.downloadRemove(movieDownload.id).then(() => {
                        setConfirm(null);
                        refresh();
                      });
                    } else {
                      setConfirm(movieDownload.id);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  {confirm === movieDownload.id ? t("downloads.confirmRemove") : t("downloads.remove")}
                </button>
              )}
            </div>

            {detailQ.isError && (
              <p className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-[var(--muted)]">
                {t("local.noMeta")}
              </p>
            )}
          </div>
        </div>
      </div>

      {kind === "series" && seasons.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{t("detail.episodes")}</h2>
            {seasons.length > 1 && (
              <Select
                value={String(seasonIdx)}
                onChange={(v) => setSeasonIdx(Number(v))}
                ariaLabel={t("detail.episodes")}
                className="w-48"
                options={seasons.map((s, i) => ({
                  value: String(i),
                  label: s.name || `${t("downloads.season", { n: s.number })}`,
                }))}
              />
            )}
          </div>

          <div className="space-y-2">
            {episodes.map((ep) => {
              const d = bySource.get(`series:${ep.id}`);
              const done = d?.state === "done";
              const busy = d?.state === "running" || d?.state === "queued";
              return (
                <div
                  key={ep.id}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-[var(--accent-2)]">
                    {ep.num}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{ep.title}</div>
                    {ep.plot && (
                      <div className="line-clamp-1 text-xs text-[var(--muted)]">{ep.plot}</div>
                    )}
                  </div>

                  {done ? (
                    <>
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">
                        {Math.round((d!.total || d!.done) / 1024 ** 2)} MB
                      </span>
                      <button
                        className="shrink-0 rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
                        title={t("downloads.play")}
                        onClick={() => playLocal(d!)}
                      >
                        <Play size={15} fill="currentColor" />
                      </button>
                      <button
                        className="shrink-0 rounded-lg p-2 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
                        title={t("downloads.remove")}
                        onClick={() => void api.downloadRemove(d!.id).then(refresh)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : busy ? (
                    <span className="shrink-0 text-[11px] text-[var(--accent-2)]">
                      {d?.state === "queued" ? t("downloads.state.queued") : `${t("detail.downloading")} ${d?.total ? Math.round((d.done / d.total) * 100) : 0}%`}
                    </span>
                  ) : (
                    <button
                      className="shrink-0 rounded-lg p-2 text-[var(--muted)] transition hover:bg-white/10 hover:text-white"
                      title={t("detail.download")}
                      onClick={() => fixUpload(ep)}
                    >
                      {d?.state === "error" || d?.state === "paused" || d?.state === "stopped" ? (
                        <RotateCcw size={16} />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {episodes.length === 0 && (
            <p className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-6 text-sm text-[var(--muted)]">
              {t("local.noEpisodes")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
