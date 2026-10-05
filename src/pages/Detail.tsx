import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Film, Heart, Info, Play, Star } from "lucide-react";
import { api, imgUrl, Episode } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtDuration, fmtVotes, initials, initialsColor, yearOf } from "../lib/format";
import { useT } from "../lib/i18n";

export default function Detail({ kind }: { kind: "movie" | "series" }) {
  const t = useT();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const play = useStore((s) => s.play);
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const [seasonIdx, setSeasonIdx] = useState(0);

  const favKey = `${kind}:${id}`;
  const isFav = favorites.includes(favKey);

  const query = useQuery({
    queryKey: ["detail", kind, id],
    queryFn: () => api.detail(kind, id),
    enabled: !!id,
  });

  const data = query.data;
  const item = data?.item;
  const detail = data?.detail;
  const imdb = data?.imdb;

  const backdrop = imgUrl(detail?.backdrop ?? imdb?.image ?? item?.cover);
  const poster = imgUrl(imdb?.image ?? item?.cover);

  const seasons = data?.seasons ?? [];
  const activeSeason = seasons[Math.min(seasonIdx, Math.max(0, seasons.length - 1))];
  const activeEpisodes = activeSeason?.episodes ?? [];

  const flatEpisodes = useMemo(
    () => seasons.flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.number }))),
    [seasons]
  );

  useEffect(() => {
    setSeasonIdx(0);
  }, [id]);

  const rating = imdb?.rating ?? detail?.rating ?? item?.rating ?? null;
  const votes = imdb?.votes ?? null;
  const genres = (detail?.genre ?? imdb?.genres?.join(", ") ?? "")
    .split(/[,/]/)
    .map((g) => g.trim())
    .filter(Boolean);

  const playMovie = () => {
    if (!item) return;
    play({
      kind: "movie",
      id: item.id,
      ext: detail?.container_extension ?? item.extension ?? undefined,
      title: item.name,
      poster: item.cover ?? undefined,
      subtitle: yearOf(detail?.release_date) ?? undefined,
      historyKey: `movie:${item.id}`,
    });
  };

  const playEpisode = (ep: Episode & { season: number }) => {
    if (!item) return;
    const idx = flatEpisodes.findIndex((e) => e.id === ep.id);
    const next = idx >= 0 ? flatEpisodes[idx + 1] : undefined;
    play({
      kind: "series",
      id: ep.id,
      ext: ep.extension,
      title: item.name,
      poster: ep.cover ?? item.cover ?? undefined,
      subtitle: `S${ep.season} · E${ep.num} – ${ep.title}`,
      historyKey: `series:${ep.id}`,
      next: next
        ? {
            kind: "series",
            id: next.id,
            ext: next.extension,
            title: item.name,
            subtitle: `S${next.season} · E${next.num} – ${next.title}`,
          }
        : undefined,
    });
  };

  const firstEpisode = flatEpisodes[0];
  const playSeries = () => {
    if (firstEpisode) playEpisode(firstEpisode);
  };

  if (query.isLoading) {
    return (
      <div className="animate-fade-in pt-6">
        <div className="skeleton mb-8 h-72 w-full rounded-2xl" />
        <div className="flex gap-8">
          <div className="skeleton h-72 w-48 rounded-2xl" />
          <div className="flex-1 space-y-3">
            <div className="skeleton h-8 w-2/3 rounded" />
            <div className="skeleton h-4 w-1/3 rounded" />
            <div className="skeleton h-24 w-full rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (query.isError || !item) {
    return (
      <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-sm text-red-300">
        {t("detail.loadError")} {(query.error as Error)?.message}
        <div className="mt-3">
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-10">
      {/* backdrop (flush with top, no negative top margin so nothing is clipped) */}
      <div className="relative -mx-8 mb-6 h-[300px] overflow-hidden">
        {backdrop && (
          <img src={backdrop} alt="" className="h-full w-full scale-105 object-cover opacity-55" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/60 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          aria-label={t("common.back")}
          className="absolute left-8 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/80"
        >
          <ArrowLeft />
        </button>
      </div>

      <div className="-mt-32 flex flex-col gap-8 lg:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-5 lg:w-60">
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl">
            <div className="aspect-[2/3] w-full">
              {poster ? (
                <img src={poster} alt={item.name} className="h-full w-full object-cover" />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-3xl font-black text-white"
                  style={{ background: `linear-gradient(150deg, ${initialsColor(item.name)}, #12141d)` }}
                >
                  {initials(item.name)}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {kind === "movie" ? (
              <button className="btn btn-primary w-full" onClick={playMovie}>
                <Play size={18} fill="currentColor" /> {t("common.play")}
              </button>
            ) : (
              <button className="btn btn-primary w-full" onClick={playSeries} disabled={!firstEpisode}>
                <Play size={18} fill="currentColor" />{" "}
                {firstEpisode ? t("detail.firstEpisode") : t("detail.noEpisodes")}
              </button>
            )}
            <button className="btn btn-ghost w-full" onClick={() => toggleFavorite(favKey)}>
              <Heart
                size={18}
                fill={isFav ? "#f43f5e" : "none"}
                stroke={isFav ? "#f43f5e" : "currentColor"}
              />
              {isFav ? t("detail.inFavorites") : t("detail.addFavorite")}
            </button>
            {detail?.trailer && (
              <a
                className="btn btn-ghost w-full"
                href={
                  detail.trailer.startsWith("http")
                    ? detail.trailer
                    : `https://www.youtube.com/watch?v=${detail.trailer}`
                }
                target="_blank"
                rel="noreferrer"
              >
                <Film size={18} /> {t("detail.trailer")}
              </a>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 pt-2 lg:pt-32">
          <h1 className="break-words text-4xl font-black leading-tight tracking-tight">
            <span className="text-gradient">{imdb?.title || item.name}</span>
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/80">
            {rating != null && rating > 0 && (
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Star size={16} fill="#f5c518" stroke="#f5c518" />
                {rating.toFixed(1)}
                {votes ? <span className="text-white/50">· {fmtVotes(votes)} Votes</span> : null}
                <span className="text-white/40">IMDb</span>
              </span>
            )}
            {yearOf(detail?.release_date) && <span>{yearOf(detail?.release_date)}</span>}
            {fmtDuration(detail?.duration) && <span>{fmtDuration(detail?.duration)}</span>}
            {detail?.age && (
              <span className="rounded border border-white/25 px-1.5 py-0.5 text-[11px] font-bold">
                {detail.age}
              </span>
            )}
            {detail?.country && <span className="text-[var(--muted)]">{detail.country}</span>}
          </div>

          {genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-[var(--border)] bg-white/5 px-3 py-1 text-xs font-medium text-[var(--muted)]"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {detail?.plot && (
            <p className="mt-5 max-w-3xl text-[15px] leading-relaxed text-white/85">{detail.plot}</p>
          )}

          <div className="mt-6 grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2">
            {detail?.director && (
              <div>
                <span className="text-[var(--muted)]">{t("detail.director")} </span>
                <span className="font-medium">{detail.director}</span>
              </div>
            )}
            {detail?.cast && detail.cast.length > 0 && (
              <div className="sm:col-span-2">
                <span className="text-[var(--muted)]">{t("detail.cast")} </span>
                <span className="font-medium">{detail.cast.join(", ")}</span>
              </div>
            )}
          </div>

          {kind === "series" && seasons.length > 0 && (
            <div className="mt-9">
              <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
                {seasons.map((s, i) => (
                  <button
                    key={s.number}
                    className="chip"
                    data-active={i === seasonIdx}
                    onClick={() => setSeasonIdx(i)}
                  >
                    {t("detail.season", { n: s.number })}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {activeEpisodes.map((ep) => {
                  const epWithSeason = { ...ep, season: activeSeason?.number ?? 1 };
                  const cover = imgUrl(ep.cover ?? item.cover);
                  return (
                    <button
                      key={ep.id}
                      onClick={() => playEpisode(epWithSeason)}
                      className="group flex w-full items-center gap-4 rounded-xl border border-transparent bg-white/[0.03] p-3 text-left transition hover:border-[var(--border)] hover:bg-white/[0.07]"
                    >
                      <span className="relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-2)]">
                        {cover ? (
                          <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : null}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                          <Play size={18} fill="white" className="text-white" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--accent-2)]">
                            E{String(ep.num).padStart(2, "0")}
                          </span>
                          <span className="truncate text-sm font-semibold">{ep.title}</span>
                        </span>
                        {ep.plot && (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--muted)]">
                            {ep.plot}
                          </span>
                        )}
                      </span>
                      {ep.duration && (
                        <span className="shrink-0 text-xs text-[var(--muted)]">{ep.duration}</span>
                      )}
                    </button>
                  );
                })}
                {activeEpisodes.length === 0 && (
                  <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-4 text-sm text-[var(--muted)]">
                    <Info size={16} /> {t("detail.noSeasonEpisodes")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
