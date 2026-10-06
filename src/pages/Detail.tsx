import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Film, Heart, Info, Play, Star } from "lucide-react";
import { api, imgUrl, Episode } from "../lib/api";
import { useStore } from "../lib/store";
import { fmtDuration, fmtVotes, initials, initialsColor, yearOf } from "../lib/format";
import { useT } from "../lib/i18n";
import { Select } from "../components/Select";

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

  const poster = imgUrl(imdb?.image ?? item?.cover);
  const backdropImg = imgUrl(detail?.backdrop);

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
  const year = yearOf(detail?.release_date);
  const duration = fmtDuration(detail?.duration);

  const playMovie = () => {
    if (!item) return;
    play({
      kind: "movie",
      id: item.id,
      ext: detail?.container_extension ?? item.extension ?? undefined,
      title: item.name,
      poster: item.cover ?? undefined,
      subtitle: year ?? undefined,
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

  if (query.isLoading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton -mx-8 h-[420px]" />
        <div className="-mt-48 flex flex-col gap-10 lg:flex-row">
          <div className="skeleton mx-auto h-[330px] w-[190px] shrink-0 rounded-2xl lg:mx-0 lg:w-[250px]" />
          <div className="flex-1 space-y-4 lg:pt-8">
            <div className="skeleton h-12 w-2/3 rounded" />
            <div className="skeleton h-6 w-1/3 rounded" />
            <div className="skeleton h-28 w-full rounded" />
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
    <div className="animate-fade-in pb-12">
      {/* HERO */}
      <div className="relative -mx-8 h-[420px] overflow-hidden bg-[var(--surface-2)]">
        {poster && (
          <img
            src={poster}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-3xl"
          />
        )}
        {backdropImg && (
          <img
            src={backdropImg}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08090d] via-[#08090d]/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#08090d]/85 via-[#08090d]/25 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          aria-label={t("common.back")}
          className="absolute left-8 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur transition hover:bg-black/70"
        >
          <ArrowLeft />
        </button>
      </div>

      {/* CONTENT */}
      <div className="relative -mt-48 flex flex-col gap-10 lg:flex-row">
        {/* LEFT: poster + actions */}
        <aside className="w-full shrink-0 lg:w-[250px]">
          <div className="mx-auto w-[190px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl ring-1 ring-white/10 lg:mx-0 lg:w-full">
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

          <div className="mt-5 flex flex-col gap-2.5">
            {kind === "movie" ? (
              <button className="btn btn-primary py-3.5 text-base" onClick={playMovie}>
                <Play size={20} fill="currentColor" /> {t("common.play")}
              </button>
            ) : (
              <button
                className="btn btn-primary py-3.5 text-base"
                onClick={() => firstEpisode && playEpisode(firstEpisode)}
                disabled={!firstEpisode}
              >
                <Play size={20} fill="currentColor" />{" "}
                {firstEpisode ? t("detail.firstEpisode") : t("detail.noEpisodes")}
              </button>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              {detail?.trailer && (
                <a
                  className="btn btn-ghost"
                  href={
                    detail.trailer.startsWith("http")
                      ? detail.trailer
                      : `https://www.youtube.com/watch?v=${detail.trailer}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <Film size={17} /> {t("detail.trailer")}
                </a>
              )}
              <button
                className={`btn btn-ghost ${detail?.trailer ? "" : "col-span-2"}`}
                onClick={() => toggleFavorite(favKey)}
              >
                <Heart
                  size={17}
                  fill={isFav ? "#f43f5e" : "none"}
                  stroke={isFav ? "#f43f5e" : "currentColor"}
                />
                {isFav ? t("detail.inFavorites") : t("detail.addFavorite")}
              </button>
            </div>
          </div>
        </aside>

        {/* RIGHT: title + meta + overview + credits + episodes */}
        <div className="min-w-0 flex-1 lg:pt-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80 backdrop-blur">
              {kind === "series" ? t("common.serie") : t("common.movie")}
            </span>
            {detail?.age && (
              <span className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-bold text-white/80">
                {detail.age}
              </span>
            )}
          </div>

          <h1 className="break-words text-4xl font-black leading-[1.05] tracking-tight lg:text-5xl">
            <span className="text-gradient">{imdb?.title || item.name}</span>
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {rating != null && rating > 0 && (
              <span className="inline-flex items-center gap-2 rounded-xl border border-[var(--imdb)]/30 bg-[var(--imdb)]/10 px-3 py-1.5 font-bold text-[#ffdd66]">
                <Star size={15} fill="#f5c518" stroke="#f5c518" />
                {rating.toFixed(1)}
                {votes ? <span className="font-medium text-white/50">({fmtVotes(votes)})</span> : null}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  IMDb
                </span>
              </span>
            )}
            {year && <span className="font-medium text-white/80">{year}</span>}
            {duration && <span className="font-medium text-white/80">{duration}</span>}
            {detail?.country && <span className="text-[var(--muted)]">{detail.country}</span>}
          </div>

          {genres.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full border border-[var(--border)] bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-white/80"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {detail?.plot && (
            <div className="mt-7 max-w-3xl">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                {t("detail.overview")}
              </h2>
              <p className="text-[15px] leading-relaxed text-white/85">{detail.plot}</p>
            </div>
          )}

          {(detail?.director || (detail?.cast && detail.cast.length > 0)) && (
            <div className="mt-8 grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
              {detail?.director && (
                <div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                    {t("detail.directorTitle")}
                  </h3>
                  <p className="text-sm font-semibold text-white/90">{detail.director}</p>
                </div>
              )}
              {detail?.cast && detail.cast.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--muted)]">
                    {t("detail.castTitle")}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {detail.cast.slice(0, 14).map((c) => (
                      <span key={c} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/75">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {kind === "series" && seasons.length > 0 && (
            <div className="mt-10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold tracking-tight">{t("detail.episodes")}</h2>
                <Select
                  value={String(seasonIdx)}
                  onChange={(v) => setSeasonIdx(Number(v))}
                  ariaLabel={t("detail.episodes")}
                  className="w-48"
                  options={seasons.map((s, i) => ({
                    value: String(i),
                    label: t("detail.season", { n: s.number }),
                  }))}
                />
              </div>

              <div className="space-y-2.5">
                {activeEpisodes.map((ep) => {
                  const epWithSeason = { ...ep, season: activeSeason?.number ?? 1 };
                  const cover = imgUrl(ep.cover ?? item.cover);
                  return (
                    <button
                      key={ep.id}
                      onClick={() => playEpisode(epWithSeason)}
                      className="group flex w-full items-center gap-4 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-3 text-left transition hover:border-[var(--accent)]/40 hover:bg-white/[0.07]"
                    >
                      <span className="relative flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--surface-2)] sm:w-40">
                        {cover ? (
                          <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Film className="text-[var(--muted)]" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                          <Play size={22} fill="white" className="text-white" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-[var(--accent-2)]">
                            {ep.num}
                          </span>
                          <span className="truncate text-sm font-semibold">{ep.title}</span>
                        </span>
                        {ep.plot && (
                          <span className="mt-1 line-clamp-2 block text-xs text-[var(--muted)]">
                            {ep.plot}
                          </span>
                        )}
                      </span>
                      {ep.duration && (
                        <span className="shrink-0 self-start text-xs text-[var(--muted)] sm:self-center">
                          {ep.duration}
                        </span>
                      )}
                    </button>
                  );
                })}
                {activeEpisodes.length === 0 && (
                  <div className="flex items-center gap-2 rounded-2xl bg-white/[0.03] p-5 text-sm text-[var(--muted)]">
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
